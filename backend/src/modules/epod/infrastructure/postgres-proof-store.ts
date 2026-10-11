import pg from 'pg';
import type { DeliveryProof } from '../domain/delivery-proof.js';
import type { ProofFilter, ProofStore, StoredImage } from '../application/proof-store.port.js';

/**
 * Comprobantes de entrega en PostgreSQL (migración 006): `delivery_proofs` con el
 * comprobante en JSON y columnas para filtrar, y `delivery_images` con firma y fotos en
 * `bytea` (nunca dentro de `app_state`). Crea las tablas si no existen.
 */
export class PostgresProofStore implements ProofStore {
  private readonly pool: pg.Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 3 });
  }

  async save(proof: DeliveryProof, images: StoredImage[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO delivery_proofs (id, order_id, vehicle_plate, outcome, captured_at, data)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [
          proof.id,
          proof.orderId,
          proof.vehiclePlate,
          proof.outcome,
          proof.capturedAt,
          JSON.stringify(proof),
        ],
      );
      for (const image of images) {
        await client.query(
          `INSERT INTO delivery_images (id, proof_id, kind, mime, bytes) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [image.id, proof.id, image.kind, image.mime, Buffer.from(image.base64, 'base64')],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async find(id: string): Promise<DeliveryProof | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ data: DeliveryProof }>(
      'SELECT data FROM delivery_proofs WHERE id = $1',
      [id],
    );
    return result.rows[0]?.data ?? null;
  }

  async list(filter: ProofFilter): Promise<DeliveryProof[]> {
    await this.ensureSchema();
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.from) add('captured_at >= ?', filter.from);
    if (filter.to) add('captured_at < ?', filter.to);
    if (filter.vehiclePlate) add('vehicle_plate = ?', filter.vehiclePlate);
    if (filter.outcome) add('outcome = ?', filter.outcome);
    if (filter.orderId) add('order_id = ?', filter.orderId);
    const result = await this.pool.query<{ data: DeliveryProof }>(
      `SELECT data FROM delivery_proofs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY captured_at DESC LIMIT 1000`,
      params,
    );
    return result.rows.map((r) => r.data);
  }

  async image(proofId: string, imageId: string): Promise<StoredImage | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ kind: 'FIRMA' | 'FOTO'; mime: string; bytes: Buffer }>(
      'SELECT kind, mime, bytes FROM delivery_images WHERE id = $1 AND proof_id = $2',
      [imageId, proofId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: imageId,
          proofId,
          kind: row.kind,
          mime: row.mime,
          base64: row.bytes.toString('base64'),
        }
      : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS delivery_proofs (
           id            text PRIMARY KEY,
           order_id      text NOT NULL,
           vehicle_plate text NOT NULL,
           outcome       text NOT NULL,
           captured_at   timestamptz NOT NULL,
           data          jsonb NOT NULL,
           created_at    timestamptz NOT NULL DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS delivery_proofs_captured_at ON delivery_proofs (captured_at);
         CREATE INDEX IF NOT EXISTS delivery_proofs_order ON delivery_proofs (order_id);
         CREATE TABLE IF NOT EXISTS delivery_images (
           id         text PRIMARY KEY,
           proof_id   text NOT NULL REFERENCES delivery_proofs (id) ON DELETE CASCADE,
           kind       text NOT NULL,
           mime       text NOT NULL,
           bytes      bytea NOT NULL,
           created_at timestamptz NOT NULL DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS delivery_images_proof ON delivery_images (proof_id);`,
      )
      .then(
        () => undefined,
        (error: unknown) => {
          const code = (error as { code?: string } | null)?.code;
          if (code === '23505' || code === '42P07') return;
          this.schemaReady = null;
          throw error;
        },
      );
    return this.schemaReady;
  }
}
