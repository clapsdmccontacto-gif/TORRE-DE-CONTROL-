import { MemoryRecordStore } from '../../../common/record-store.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import type { Product } from '../../catalog/domain/product.js';
import { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import type { DeliveryOrder } from '../../routing/domain/delivery.js';
import { PickingDesk } from './picking-desk.js';

const bySku = (sku: string) => DEMO_PRODUCTS.find((p) => p.sku === sku)!;
const cement: Product = {
  ...bySku('CEM-ESP-25'),
  binLocation: 'P1-R1',
  barcodes: [
    { code: '7802820005455', unitsPerScan: 1 },
    { code: '17802820005452', unitsPerScan: 10 },
  ],
};
const drill: Product = {
  ...bySku('MAK-HP1630'),
  binLocation: 'P3-R2',
  barcodes: [{ code: '088381094574', unitsPerScan: 1 }],
};
const tile: Product = { ...bySku('CER-MUR-2540'), binLocation: 'P2-R1', barcodes: [] };
const products = [cement, drill, tile];
const site = {
  id: 'OBRA-1',
  name: 'Edificio Las Rosas',
  commune: 'Los Ángeles',
  location: { lat: -37.46, lng: -72.35 },
  hasUnloadingEquipment: false,
  notifyEtaMinutes: 15,
};
const orders: DeliveryOrder[] = [
  { id: 'NV-2', site, lines: [{ product: tile, quantity: 2 }], deliveryDate: '2026-10-20' },
  {
    id: 'NV-1',
    site,
    lines: [
      { product: cement, quantity: 12 },
      { product: drill, quantity: 1 },
    ],
    deliveryDate: '2026-10-14',
    customerName: 'Constructora Sur',
  },
];

function setup(store?: MemoryRecordStore) {
  let now = Date.parse('2026-10-15T12:00:00Z');
  let n = 0;
  const tracker = new OrderTracker({ store, now: () => now });
  const desk = new PickingDesk({
    orders: () => orders,
    products: () => products,
    tracker,
    store,
    now: () => now,
  });
  return {
    desk,
    tracker,
    id: () => `SCAN-${++n}`,
    advance: (min: number) => (now += min * 60_000),
  };
}

describe('PickingDesk', () => {
  it('lista por preparar por fecha de entrega y reserva el pedido para un operario', () => {
    const { desk, tracker } = setup();
    expect(desk.queue().map((q) => q.orderId)).toEqual(['NV-1', 'NV-2']);
    const view = desk.claim({ orderId: 'NV-1', operator: 'Ana', device: 'PDA-1' });
    expect(view).toMatchObject({ status: 'EN_PICKING', operator: 'Ana' });
    expect(view.lines.map((l) => l.binLocation)).toEqual(['P1-R1', 'P3-R2']);
    expect(tracker.status('NV-1')).toBe('EN_PICKING');
    expect(() => desk.claim({ orderId: 'NV-1', operator: 'Luis' })).toThrow(
      expect.objectContaining({ code: 'PEDIDO_TOMADO', message: expect.stringContaining('Ana') }),
    );
    // El mismo operario puede volver a entrar (otro equipo o recargar).
    expect(desk.claim({ orderId: 'NV-1', operator: ' ana ' }).operator).toBe('Ana');
  });

  it('escanea con reglas, avisa la mezcla prohibida, es idempotente y deshace', () => {
    const { desk, id } = setup();
    desk.claim({ orderId: 'NV-1', operator: 'Ana' });
    expect(() =>
      desk.scan({ id: id(), orderId: 'NV-1', code: '7802820005455', operator: 'Luis' }),
    ).toThrow(expect.objectContaining({ code: 'PEDIDO_TOMADO' }));
    const box = desk.scan({ id: 'S-1', orderId: 'NV-1', code: '17802820005452', operator: 'Ana' });
    expect(box).toMatchObject({ ok: true, message: expect.stringContaining('+10 (10 de 12)') });
    // Reintento sin señal: misma lectura, no suma dos veces.
    expect(
      desk.scan({ id: 'S-1', orderId: 'NV-1', code: '17802820005452', operator: 'Ana' }).view
        .progress.picked,
    ).toBe(10);
    expect(
      desk.scan({ id: id(), orderId: 'NV-1', code: '17802820005452', operator: 'Ana' }),
    ).toMatchObject({
      ok: false,
      event: { result: 'EXCEDE_CANTIDAD' },
    });
    expect(
      desk.scan({ id: id(), orderId: 'NV-1', code: '999999', operator: 'Ana' }).event.result,
    ).toBe('CODIGO_DESCONOCIDO');
    // Taladro con cemento en el carro modular: regla de mezcla.
    const drillScan = desk.scan({
      id: id(),
      orderId: 'NV-1',
      code: '088381094574',
      operator: 'Ana',
    });
    expect(drillScan.ok).toBe(true);
    expect(drillScan.mix.map((v) => v.rule)).toContain('MEZCLA_INCOMPATIBLE');

    const undone = desk.undo({ orderId: 'NV-1', operator: 'Ana', id: id() });
    expect(undone.lines.find((l) => l.sku === drill.sku)?.picked).toBe(0);
    expect(undone.events[0]).toMatchObject({ result: 'DESHECHO', units: -1 });
  });

  it('cierra con faltantes justificados y el monitor muestra avance, tiempo y alertas', () => {
    const { desk, tracker, advance } = setup();
    desk.claim({ orderId: 'NV-1', operator: 'Ana' });
    desk.scan({ id: 'S-1', orderId: 'NV-1', code: '17802820005452', operator: 'Ana' });
    desk.scan({ id: 'S-2', orderId: 'NV-1', code: '7802820005455', operator: 'Ana' });
    desk.scan({ id: 'S-3', orderId: 'NV-1', code: '7802820005455', operator: 'Ana' });
    advance(50);
    let monitor = desk.monitor();
    const open = monitor.orders.find((o) => o.orderId === 'NV-1')!;
    expect(open).toMatchObject({ status: 'EN_PICKING', operator: 'Ana', elapsedMin: 50 });
    expect(open.progress.fraction).toBeCloseTo(12 / 13);
    expect(open.alerts).toEqual(['ATRASADO', 'DEMORADO']);

    expect(() => desk.close({ orderId: 'NV-1', operator: 'Ana', shortages: [] })).toThrow(
      expect.objectContaining({ code: 'FALTAN_PRODUCTOS' }),
    );
    const closed = desk.close({
      orderId: 'NV-1',
      operator: 'Ana',
      shortages: [{ sku: drill.sku, reason: 'SIN_STOCK' }],
    });
    expect(closed.status).toBe('PICKEADO_PARCIAL');
    expect(tracker.track('NV-1').events.at(-1)?.detail).toContain('Faltantes: 1');
    monitor = desk.monitor();
    expect(monitor.orders.find((o) => o.orderId === 'NV-1')).toMatchObject({
      alerts: ['FALTANTE'],
      shortages: [{ sku: drill.sku, missing: 1, reason: 'SIN_STOCK' }],
    });
    expect(desk.queue().map((q) => q.orderId)).toEqual(['NV-2']);
    expect(desk.picked('NV-1').get(cement.sku)).toBe(12);
  });

  it('liberar deja el pedido para otro con lo escaneado; todo queda guardado', async () => {
    const store = new MemoryRecordStore();
    const first = setup(store);
    first.desk.claim({ orderId: 'NV-2', operator: 'Ana' });
    first.desk.scan({ id: 'S-1', orderId: 'NV-2', code: tile.sku, operator: 'Ana' });
    first.desk.release({ orderId: 'NV-2', operator: 'Ana' });
    await first.desk.flush();
    await first.tracker.flush();

    const restarted = setup(store);
    await Promise.all([restarted.desk.ready, restarted.tracker.ready]);
    expect(restarted.tracker.status('NV-2')).toBe('PENDIENTE');
    const view = restarted.desk.claim({ orderId: 'NV-2', operator: 'Luis' });
    expect(view.progress.picked).toBe(1);
    expect(() => restarted.desk.release({ orderId: 'NV-2', operator: 'Ana' })).toThrow(
      expect.objectContaining({ code: 'PEDIDO_TOMADO' }),
    );
    expect(restarted.desk.release({ orderId: 'NV-2', operator: 'Torre', force: true }).status).toBe(
      'PENDIENTE',
    );
  });
});
