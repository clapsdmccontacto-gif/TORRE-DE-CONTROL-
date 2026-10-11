import pg from 'pg';
import type { DeliveryProof } from '../domain/delivery-proof.js';
import { PostgresProofStore } from './postgres-proof-store.js';

// Prueba de integración: corre sólo con TEST_DATABASE_URL (una base desechable).
const url = process.env.TEST_DATABASE_URL;

const proof = (
  id: string,
  capturedAt: string,
  outcome: DeliveryProof['outcome'],
): DeliveryProof => ({
  id,
  orderId: `NV-${id}`,
  sessionId: 'RUTA-1',
  vehiclePlate: 'LXCD21',
  driverName: 'Pedro',
  customerName: null,
  siteName: 'Obra',
  siteAddress: null,
  commune: 'Los Ángeles',
  siteLocation: { lat: -37.46, lng: -72.35 },
  outcome,
  reason: null,
  receiverName: 'Juan',
  receiverRut: '12345678-5',
  lines: [],
  position: null,
  distanceM: null,
  farFromSite: false,
  capturedAt,
  receivedAt: capturedAt,
  images: [{ id: `IMG-${id}`, kind: 'FOTO' }],
});

describe.skipIf(!url)('PostgresProofStore', () => {
  it('guarda comprobante e imagen (bytea), filtra por fecha y resultado, y no duplica', async () => {
    const admin = new pg.Pool({ connectionString: url! });
    await admin.query('DROP TABLE IF EXISTS delivery_images; DROP TABLE IF EXISTS delivery_proofs');
    await admin.end();
    const store = new PostgresProofStore(url!);
    try {
      const bytes = Buffer.from('foto-de-prueba-'.repeat(20)).toString('base64');
      await store.save(proof('A1', '2026-10-15T15:00:00.000Z', 'ENTREGADO'), [
        { id: 'IMG-A1', proofId: 'A1', kind: 'FOTO', mime: 'image/jpeg', base64: bytes },
      ]);
      await store.save(proof('A1', '2026-10-15T15:00:00.000Z', 'ENTREGADO'), []);
      await store.save(proof('B2', '2026-10-16T15:00:00.000Z', 'RECHAZADO'), []);
      expect((await store.list({})).map((p) => p.id)).toEqual(['B2', 'A1']);
      expect(
        (await store.list({ from: '2026-10-15T03:00:00Z', to: '2026-10-16T03:00:00Z' })).map(
          (p) => p.id,
        ),
      ).toEqual(['A1']);
      expect((await store.list({ outcome: 'RECHAZADO' })).map((p) => p.id)).toEqual(['B2']);
      expect((await store.find('A1'))?.receiverRut).toBe('12345678-5');
      expect(await store.image('A1', 'IMG-A1')).toMatchObject({
        mime: 'image/jpeg',
        base64: bytes,
      });
      expect(await store.image('B2', 'IMG-A1')).toBeNull();
    } finally {
      await store.close();
    }
  });
});
