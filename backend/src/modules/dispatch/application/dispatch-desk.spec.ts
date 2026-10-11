import { MemoryRecordStore } from '../../../common/record-store.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import type { Product } from '../../catalog/domain/product.js';
import { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import type { DeliveryOrder } from '../../routing/domain/delivery.js';
import { DispatchDesk } from './dispatch-desk.js';

const cement: Product = {
  ...DEMO_PRODUCTS.find((p) => p.sku === 'CEM-ESP-25')!,
  barcodes: [{ code: '7802820005455', unitsPerScan: 1 }],
};
const tile: Product = { ...DEMO_PRODUCTS.find((p) => p.sku === 'CER-MUR-2540')!, barcodes: [] };
const site = {
  id: 'OBRA-1',
  name: 'Edificio Las Rosas',
  commune: 'Los Ángeles',
  location: { lat: -37.46, lng: -72.35 },
  hasUnloadingEquipment: false,
  notifyEtaMinutes: 15,
};
const orders: DeliveryOrder[] = [
  { id: 'NV-1', site, lines: [{ product: cement, quantity: 4 }] },
  {
    id: 'NV-2',
    site,
    lines: [
      { product: cement, quantity: 2 },
      { product: tile, quantity: 1 },
    ],
  },
  { id: 'NV-3', site, lines: [{ product: tile, quantity: 2 }] },
  { id: 'NV-4', site, lines: [{ product: tile, quantity: 1 }] },
];
const units = [
  { plate: 'LXCD21', vehicle: DEFAULT_FLEET[1] },
  { plate: 'ABCD12', vehicle: DEFAULT_FLEET[2] },
];

function setup(store?: MemoryRecordStore) {
  const tracker = new OrderTracker({ store });
  const picked = new Map<string, Map<string, number>>([
    ['NV-1', new Map([[cement.sku, 4]])],
    [
      'NV-2',
      new Map([
        [cement.sku, 2],
        [tile.sku, 1],
      ]),
    ],
    ['NV-3', new Map([[tile.sku, 2]])],
    ['NV-4', new Map([[tile.sku, 1]])],
  ]);
  for (const id of ['NV-1', 'NV-2', 'NV-3', 'NV-4']) {
    tracker.transition({ orderId: id, to: 'EN_PICKING', actor: 'Ana' });
    tracker.transition({ orderId: id, to: 'PICKEADO', actor: 'Ana' });
  }
  const assigned: string[] = [];
  const desk = new DispatchDesk({
    orders: () => orders,
    products: () => [cement, tile],
    units: () => units,
    tracker,
    picked: (id) => picked.get(id) ?? new Map(),
    routeOrder: () =>
      new Map([
        ['NV-1', { plate: 'LXCD21', position: 1 }],
        ['NV-2', { plate: 'LXCD21', position: 2 }],
        ['NV-3', { plate: 'ABCD12', position: 1 }],
      ]),
    store,
  });
  desk.onAssigned((plate) => assigned.push(plate));
  return { desk, tracker, assigned };
}

describe('DispatchDesk', () => {
  it('muestra los pedidos del camión en orden de carga y los sin camión para asignar', () => {
    const { desk } = setup();
    const view = desk.truck('LXCD21');
    expect(view.loadOrders.map((o) => o.orderId)).toEqual(['NV-2', 'NV-1']);
    expect(view.unassigned.map((o) => o.orderId)).toEqual(['NV-4']);
    expect(desk.summaries().find((s) => s.plate === 'ABCD12')).toMatchObject({
      orders: 1,
      ready: 1,
    });
  });

  it('escanea al subir, avisa el camión correcto, deshace y es idempotente', () => {
    const { desk } = setup();
    expect(
      desk.scan({ id: 'L-1', plate: 'LXCD21', code: '7802820005455', operator: 'Luis' }),
    ).toMatchObject({
      ok: true,
      event: { orderId: 'NV-2' },
    });
    expect(
      desk.scan({ id: 'L-1', plate: 'LXCD21', code: '7802820005455', operator: 'Luis' }).view
        .progress.loaded,
    ).toBe(1);
    expect(desk.scan({ id: 'L-2', plate: 'LXCD21', code: 'NV-3', operator: 'Luis' })).toMatchObject(
      {
        ok: false,
        message: expect.stringContaining('ABCD12'),
      },
    );
    const box = desk.scan({ id: 'L-3', plate: 'LXCD21', code: 'NV-1', operator: 'Luis' });
    expect(box).toMatchObject({ ok: true, event: { kind: 'BULTO' } });
    expect(box.view.progress).toEqual({ loaded: 5, picked: 7 });
    const undone = desk.undo({ plate: 'LXCD21', operator: 'Luis', id: 'U-1' });
    expect(undone.progress.loaded).toBe(1);
  });

  it('cierra la carga: CARGADO con camión, operario y faltantes justificados', async () => {
    const store = new MemoryRecordStore();
    const { desk, tracker } = setup(store);
    desk.scan({ id: 'L-1', plate: 'LXCD21', code: 'NV-1', operator: 'Luis' });
    desk.scan({ id: 'L-2', plate: 'LXCD21', code: '7802820005455', operator: 'Luis' });
    desk.scan({ id: 'L-3', plate: 'LXCD21', code: '7802820005455', operator: 'Luis' });
    expect(() => desk.close({ plate: 'LXCD21', operator: 'Luis', shortages: [] })).toThrow(
      expect.objectContaining({ code: 'CARGA_INCOMPLETA' }),
    );
    const view = desk.close({
      plate: 'LXCD21',
      operator: 'Luis',
      shortages: [{ orderId: 'NV-2', sku: tile.sku, reason: 'SIN_ESPACIO' }],
    });
    expect(view.loaded).toBe(2);
    expect(tracker.track('NV-1')).toMatchObject({ status: 'CARGADO', vehiclePlate: 'LXCD21' });
    expect(tracker.track('NV-2').events.at(-1)).toMatchObject({
      actor: 'Luis',
      detail: expect.stringContaining('no subió: 1'),
    });
    await desk.flush();
    expect((await store.list('dispatch-loads')).length).toBe(1);
  });

  it('asigna a mano un pedido sin plan y el conductor lo recibe como parada', async () => {
    const store = new MemoryRecordStore();
    const { desk, assigned } = setup(store);
    expect(() => desk.assign({ orderId: 'NV-3', plate: 'LXCD21', operator: 'Luis' })).toThrow(
      expect.objectContaining({ code: 'PEDIDO_EN_PLAN' }),
    );
    const view = desk.assign({ orderId: 'NV-4', plate: 'LXCD21', operator: 'Luis' });
    expect(view.loadOrders.find((o) => o.orderId === 'NV-4')).toMatchObject({
      manual: true,
      routePosition: null,
    });
    expect(assigned).toEqual(['LXCD21']);
    expect(desk.manualStops('LXCD21').map((s) => s.deliveryId)).toEqual(['NV-4']);
    await desk.flush();
    const restarted = setup(store).desk;
    await restarted.ready;
    expect(restarted.manualStops('LXCD21').map((s) => s.deliveryId)).toEqual(['NV-4']);
  });
});
