import pg from 'pg';
import type { RecordStore, StoredRecord } from '../../../common/record-store.js';

/**
 * Registros de la operación en PostgreSQL (tabla `ops_records`, migración 005). Crea la
 * tabla si no existe, como `app_state`, para funcionar también en una base nueva (por
 * ejemplo, la gratuita de Render). Las escrituras de un mismo registro salen en orden.
 */
export class PostgresRecordStore implements RecordStore {
  private readonly pool: pg.Pool;
  private schemaReady: Promise<void> | null = null;
  private readonly pending = new Map<string, Promise<void>>();

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async list(collection: string): Promise<StoredRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ id: string; value: unknown }>(
      'SELECT id, value FROM ops_records WHERE collection = $1 ORDER BY updated_at',
      [collection],
    );
    return result.rows;
  }

  put(collection: string, id: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    return this.inOrder(collection, id, () =>
      this.pool.query(
        `INSERT INTO ops_records (collection, id, value, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (collection, id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [collection, id, json],
      ),
    );
  }

  remove(collection: string, id: string): Promise<void> {
    return this.inOrder(collection, id, () =>
      this.pool.query('DELETE FROM ops_records WHERE collection = $1 AND id = $2', [
        collection,
        id,
      ]),
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.pending.values());
    await this.pool.end();
  }

  private inOrder(collection: string, id: string, write: () => Promise<unknown>): Promise<void> {
    const key = `${collection}\u0000${id}`;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.ensureSchema())
      .then(write)
      .then(() => undefined);
    this.pending.set(key, next);
    const cleanup = () => {
      if (this.pending.get(key) === next) this.pending.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS ops_records (
           collection text NOT NULL,
           id         text NOT NULL,
           value      jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (collection, id)
         )`,
      )
      .then(
        () => undefined,
        (error: unknown) => {
          // Varios almacenes creando la tabla a la vez en una base nueva (ver app_state).
          const code = (error as { code?: string } | null)?.code;
          if (code === '23505' || code === '42P07') return;
          this.schemaReady = null;
          throw error;
        },
      );
    return this.schemaReady;
  }
}
