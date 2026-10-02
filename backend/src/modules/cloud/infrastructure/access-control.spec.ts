import { MemoryStateStore } from '../../master-data/application/state-store.port.js';
import { AccessControl } from './access-control.js';

describe('AccessControl', () => {
  it('se crea una sola vez, guarda sólo la derivación y verifica la clave', async () => {
    const store = new MemoryStateStore();
    const access = new AccessControl(store);
    await access.ready;
    expect(access.isClaimed()).toBe(false);
    await expect(access.claim('123')).rejects.toMatchObject({ code: 'CLAVE_INVALIDA' });
    await access.claim(' bodega-2026 ');
    expect(access.isClaimed()).toBe(true);
    expect(JSON.stringify(await store.load())).not.toContain('bodega-2026');
    expect(access.verify('bodega-2026')).toBe(true);
    expect(access.verify('otra-clave')).toBe(false);
    await expect(access.claim('nueva-clave')).rejects.toMatchObject({
      code: 'NUBE_YA_CONFIGURADA',
    });

    const restarted = new AccessControl(store);
    await restarted.ready;
    expect(restarted.verify('bodega-2026')).toBe(true);
  });
});
