import pg from 'pg';
import { PostgresRecordStore } from './postgres-record-store.js';

// Prueba de integración: corre sólo con TEST_DATABASE_URL (una base desechable).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgresRecordStore', () => {
  it('crea la tabla en una base nueva, guarda en orden, lee por colección y borra', async () => {
    const admin = new pg.Pool({ connectionString: url! });
    await admin.query('DROP TABLE IF EXISTS ops_records');
    await admin.end();
    const store = new PostgresRecordStore(url!);
    try {
      // Muchas escrituras seguidas del mismo registro: queda la última.
      await Promise.all(
        Array.from({ length: 20 }, (_, n) => store.put('driver-sessions', 'RUTA-1', { n })),
      );
      await store.put('route-plans', 'PLAN-1', { id: 'PLAN-1', routes: [] });
      const reopened = new PostgresRecordStore(url!);
      expect(await reopened.list('driver-sessions')).toEqual([
        { id: 'RUTA-1', value: { n: 19 } },
      ]);
      await reopened.remove('route-plans', 'PLAN-1');
      expect(await reopened.list('route-plans')).toEqual([]);
      await reopened.close();
    } finally {
      await store.close();
    }
  });
});
