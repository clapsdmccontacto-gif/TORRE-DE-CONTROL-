import { MemoryStateStore } from '../../master-data/application/state-store.port.js';
import { AccessControl } from './access-control.js';

describe('AccessControl', () => {
  it('guarda sólo la derivación, verifica la clave y la mantiene al reiniciar', async () => {
    const store = new MemoryStateStore();
    const access = new AccessControl(store);
    await access.ready;
    expect(access.isClaimed()).toBe(false);
    expect(access.canClaim()).toBe(true);
    await expect(access.claim('123')).rejects.toMatchObject({ code: 'CLAVE_INVALIDA' });
    await access.claim(' bodega-2026 ');
    expect(access.isClaimed()).toBe(true);
    expect(JSON.stringify(await store.load())).not.toContain('bodega-2026');
    expect(access.verify('bodega-2026')).toBe(true);
    expect(access.verify('otra-clave')).toBe(false);

    const restarted = new AccessControl(store);
    await restarted.ready;
    expect(restarted.verify('bodega-2026')).toBe(true);
  });

  it('no distingue mayúsculas ni espacios (el celular pone la primera en mayúscula)', async () => {
    const access = new AccessControl(new MemoryStateStore());
    await access.claim('Bodega-Ñuble');
    expect(access.verify('bodega-ñuble')).toBe(true);
    expect(access.verify(' BODEGA-ÑUBLE ')).toBe(true);
    expect(access.verify('bodega-nuble')).toBe(false);
  });

  it('se puede crear otra clave mientras la nube no tiene datos; con datos queda fija', async () => {
    let empty = true;
    const access = new AccessControl(new MemoryStateStore(), { canReplace: () => empty });
    await access.claim('primera-clave');
    expect(access.canClaim()).toBe(true);
    await access.claim('segunda-clave');
    expect(access.verify('primera-clave')).toBe(false);
    expect(access.verify('segunda-clave')).toBe(true);

    empty = false;
    expect(access.canClaim()).toBe(false);
    await expect(access.claim('tercera-clave')).rejects.toMatchObject({
      code: 'NUBE_YA_CONFIGURADA',
    });
    expect(access.verify('segunda-clave')).toBe(true);
  });

  it('ACCESS_KEY del servidor reemplaza la clave guardada (recuperación)', async () => {
    const store = new MemoryStateStore();
    const original = new AccessControl(store);
    await original.claim('clave-olvidada');

    const recovered = new AccessControl(store, { fixedKey: 'Clave-Recuperada' });
    await recovered.ready;
    expect(recovered.isClaimed()).toBe(true);
    expect(recovered.canClaim()).toBe(false);
    expect(recovered.verify('clave-recuperada')).toBe(true);
    expect(recovered.verify('clave-olvidada')).toBe(false);
  });
});
