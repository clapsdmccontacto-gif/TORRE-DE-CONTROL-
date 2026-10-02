import { PostgresStateStore } from './postgres-state-store.js';

// Prueba de integración: corre sólo con TEST_DATABASE_URL (una base desechable).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgresStateStore', () => {
  it('crea la tabla, guarda y vuelve a leer el documento', async () => {
    const store = new PostgresStateStore(url!);
    try {
      await store.save({ version: 1, vehicles: [{ plate: 'ABCD12', vehicleCode: 'CAMIONETA' }] });
      await store.save({
        version: 1,
        vehicles: [{ plate: 'HJKL34', vehicleCode: 'CAMION_PLUMA' }],
      });
      const reopened = new PostgresStateStore(url!);
      expect(await reopened.load()).toEqual({
        version: 1,
        vehicles: [{ plate: 'HJKL34', vehicleCode: 'CAMION_PLUMA' }],
      });
      await reopened.close();
    } finally {
      await store.close();
    }
  });
});
