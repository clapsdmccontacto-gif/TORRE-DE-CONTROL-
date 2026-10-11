import { maxPayloadKg } from '../../load-planning/domain/vehicle.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import { MasterData } from './master-data.js';
import { MemoryStateStore, type StateStore } from './state-store.port.js';

const make = (store: StateStore = new MemoryStateStore()) =>
  new MasterData({ store, vehicleTypes: DEFAULT_FLEET, maxPayloadKg });

const cement = DEMO_PRODUCTS.find((p) => p.sku === 'CEM-ESP-25')!;
const siteInput = {
  name: 'Edificio Las Araucarias',
  commune: 'Los Ángeles',
  location: { lat: -37.472, lng: -72.356 },
  hasUnloadingEquipment: false,
  notifyEtaMinutes: 15,
};

describe('MasterData', () => {
  it('parte vacío: sin bodega, camiones, productos, obras ni pedidos', async () => {
    const data = make();
    await data.ready;
    expect(data.view()).toMatchObject({
      depot: null,
      vehicles: [],
      products: [],
      sites: [],
      orders: [],
    });
    expect(data.view().vehicleTypes.map((t) => t.code)).toEqual([
      'CAMIONETA',
      'CAMION_3_4',
      'CAMION_PLUMA',
    ]);
  });

  it('guarda cada cambio y lo recupera al reiniciar', async () => {
    const store = new MemoryStateStore();
    const data = make(store);
    await data.saveDepot({ name: 'Bodega Los Ángeles', location: { lat: -37.461, lng: -72.339 } });
    await data.saveVehicle({ plate: 'hjkl-34', vehicleCode: 'CAMION_PLUMA' });
    await data.saveProduct(cement);
    const view = await data.saveSite(siteInput);
    const siteId = view.sites[0].id;
    expect(siteId).toMatch(/^OBRA-/);
    await data.saveOrder({ id: 'NV-1', siteId, lines: [{ sku: cement.sku, quantity: 10 }] });

    const restarted = make(store);
    await restarted.ready;
    const after = restarted.view();
    expect(after.depot?.name).toBe('Bodega Los Ángeles');
    expect(after.vehicles).toEqual([
      { plate: 'HJKL-34', vehicleCode: 'CAMION_PLUMA', vehicleName: 'Camión pluma' },
    ]);
    expect(after.orders[0]).toMatchObject({
      id: 'NV-1',
      siteName: 'Edificio Las Araucarias',
      weightKg: 250,
    });
    expect(restarted.units()[0].vehicle.code).toBe('CAMION_PLUMA');
    expect(restarted.orders()[0].lines[0].product.sku).toBe(cement.sku);
  });

  it('edita por clave y no deja borrar obras o productos que usa un pedido', async () => {
    const data = make();
    await data.saveVehicle({ plate: 'ABCD12', vehicleCode: 'CAMIONETA' });
    await data.saveVehicle({ plate: 'abcd12', vehicleCode: 'CAMION_3_4' });
    expect(data.view().vehicles).toHaveLength(1);
    expect(data.view().vehicles[0].vehicleCode).toBe('CAMION_3_4');

    await data.saveProduct(cement);
    const siteId = (await data.saveSite(siteInput)).sites[0].id;
    await data.saveOrder({ id: 'NV-1', siteId, lines: [{ sku: cement.sku, quantity: 1 }] });
    await expect(data.removeSite(siteId)).rejects.toMatchObject({ code: 'OBRA_CON_PEDIDOS' });
    await expect(data.removeProduct(cement.sku)).rejects.toMatchObject({ code: 'PRODUCTO_EN_USO' });

    await data.removeOrder('nv-1');
    await data.removeSite(siteId);
    await data.removeProduct(cement.sku);
    await data.removeVehicle('ab cd 12');
    expect(data.view()).toMatchObject({ vehicles: [], products: [], sites: [], orders: [] });
  });

  it('no deja que dos productos compartan un código de barra', async () => {
    const data = make();
    await data.saveProduct({ ...cement, barcodes: [{ code: '7802820005455', unitsPerScan: 1 }] });
    const other = DEMO_PRODUCTS.find((p) => p.sku !== cement.sku)!;
    await expect(
      data.saveProduct({ ...other, barcodes: [{ code: '7802820005455', unitsPerScan: 1 }] }),
    ).rejects.toMatchObject({ code: 'CODIGO_DUPLICADO' });
  });

  it('importa productos de una vez; si uno falla no importa ninguno', async () => {
    const store = new MemoryStateStore();
    const data = make(store);
    await data.saveProduct(cement);
    const [, second, third] = DEMO_PRODUCTS;
    const result = await data.importProducts([{ ...cement, name: 'Cemento renombrado' }, second]);
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(result.view.products.find((p) => p.sku === cement.sku)?.name).toBe('Cemento renombrado');

    await expect(
      data.importProducts([third, { ...second, unitWeightKg: -1 }]),
    ).rejects.toMatchObject({
      code: 'IMPORTACION_INVALIDA',
      details: { errors: [{ index: 1, id: second.sku, message: expect.any(String) }] },
    });
    expect(data.view().products.map((p) => p.sku)).not.toContain(third.sku);
  });

  it('importa pedidos con sus obras nuevas y actualiza las existentes', async () => {
    const data = make();
    await data.saveProduct(cement);
    const site = (await data.saveSite(siteInput)).sites[0];
    const result = await data.importOrders({
      sites: [
        { ...site, address: 'Av. Alemania 1234', contactPhone: '+56 9 1234 5678' },
        {
          id: 'OBRA-NUEVA',
          name: 'Casa Pérez',
          commune: 'Nacimiento',
          location: { lat: -37.5, lng: -72.6 },
          hasUnloadingEquipment: false,
          notifyEtaMinutes: 15,
        },
      ],
      orders: [
        {
          id: 'nv-1',
          siteId: site.id,
          lines: [{ sku: cement.sku, quantity: 3 }],
          deliveryDate: '2026-10-20',
        },
        { id: 'NV-2', siteId: 'OBRA-NUEVA', lines: [{ sku: cement.sku, quantity: 1 }] },
      ],
    });
    expect(result).toMatchObject({ created: 2, updated: 0, sitesCreated: 1, sitesUpdated: 1 });
    expect(result.view.sites.find((s) => s.id === site.id)?.address).toBe('Av. Alemania 1234');
    expect(result.view.orders.find((o) => o.id === 'NV-1')).toMatchObject({
      deliveryDate: '2026-10-20',
    });

    await expect(
      data.importOrders({
        sites: [],
        orders: [{ id: 'NV-3', siteId: 'NO-EXISTE', lines: [{ sku: cement.sku, quantity: 1 }] }],
      }),
    ).rejects.toMatchObject({ code: 'IMPORTACION_INVALIDA' });
  });

  it('guarda los cambios en orden aunque lleguen juntos', async () => {
    const saved: number[] = [];
    const store: StateStore = {
      load: async () => null,
      save: async (snapshot) => {
        await new Promise((r) => setTimeout(r, 5));
        saved.push((snapshot as { vehicles: unknown[] }).vehicles.length);
      },
    };
    const data = make(store);
    await Promise.all([
      data.saveVehicle({ plate: 'AAAA11', vehicleCode: 'CAMIONETA' }),
      data.saveVehicle({ plate: 'BBBB22', vehicleCode: 'CAMIONETA' }),
    ]);
    expect(saved).toEqual([1, 2]);
  });
});
