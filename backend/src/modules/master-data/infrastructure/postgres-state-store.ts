import pg from 'pg';
import type { StateStore } from '../application/state-store.port.js';

const KEY = 'master-data';

/**
 * Datos maestros en PostgreSQL (tabla `app_state`, migración 004). Crea la tabla si no
 * existe para funcionar también en una base nueva (por ejemplo, la gratuita de Render).
 */
export class PostgresStateStore implements StateStore {
  private readonly pool: pg.Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 3 });
  }

  async load(): Promise<unknown> {
    await this.ensureSchema();
    const result = await this.pool.query<{ value: unknown }>(
      'SELECT value FROM app_state WHERE key = $1',
      [KEY],
    );
    return result.rows[0]?.value ?? null;
  }

  async save(snapshot: unknown): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [KEY, JSON.stringify(snapshot)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS app_state (
           key        text PRIMARY KEY,
           value      jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      )
      .then(
        () => undefined,
        (error: unknown) => {
          this.schemaReady = null; // Se reintenta en la próxima operación.
          throw error;
        },
      );
    return this.schemaReady;
  }
}
