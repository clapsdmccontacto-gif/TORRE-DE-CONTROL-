import { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import type { DeliverySubmission, OrderForProof } from '../domain/delivery-proof.js';
import { DeliveryRegistry } from './delivery-registry.js';
import { MemoryProofStore } from './proof-store.port.js';

const IMAGE = `data:image/jpeg;base64,${'A'.repeat(800)}`;
const order: OrderForProof = {
  id: 'NV-801',
  customerName: null,
  siteName: 'Edificio Las Rosas',
  siteAddress: null,
  commune: 'Los Ángeles',
  siteLocation: { lat: -37.4651, lng: -72.3509 },
  lines: [{ sku: 'CEM-25', name: 'Cemento', quantity: 40 }],
};
const submission: DeliverySubmission = {
  id: 'POD-AAAAAAAAAA',
  orderId: 'NV-801',
  sessionId: 'RUTA-1',
  receiverName: 'Juan Pérez',
  receiverRut: '12.345.678-5',
  lines: [{ sku: 'CEM-25', delivered: 40 }],
  reason: null,
  signature: IMAGE,
  photos: [IMAGE],
  position: null,
  capturedAt: '2026-10-15T17:00:00.000Z',
};

function setup() {
  const tracker = new OrderTracker();
  const delivered: string[] = [];
  const registry = new DeliveryRegistry({
    store: new MemoryProofStore(),
    order: (id) => (id === order.id ? order : null),
    route: (id) =>
      id === 'RUTA-1'
        ? { vehiclePlate: 'LXCD21', driverName: 'Pedro', deliveryIds: ['NV-801', 'NV-802'] }
        : null,
    tracker,
    onDelivered: (proof) => {
      delivered.push(`${proof.orderId}:${proof.outcome}`);
    },
  });
  return { registry, tracker, delivered };
}

describe('DeliveryRegistry', () => {
  it('guarda el comprobante, deja el pedido entregado y marca la parada', async () => {
    const { registry, tracker, delivered } = setup();
    const proof = await registry.register(submission);
    expect(proof).toMatchObject({
      outcome: 'ENTREGADO',
      vehiclePlate: 'LXCD21',
      driverName: 'Pedro',
    });
    expect(tracker.track('NV-801')).toMatchObject({
      status: 'ENTREGADO',
      events: [{ status: 'EN_RUTA' }, { status: 'ENTREGADO', detail: 'Recibió Juan Pérez' }],
    });
    expect(delivered).toEqual(['NV-801:ENTREGADO']);
    const image = await registry.image(proof.id, proof.images[1].id);
    expect(image.kind).toBe('FOTO');
    expect((await registry.list({ outcome: 'ENTREGADO' })).map((p) => p.id)).toEqual([proof.id]);
  });

  it('reenviar el mismo comprobante (sin señal) no lo duplica', async () => {
    const { registry, delivered } = setup();
    const [first, second] = await Promise.all([
      registry.register(submission),
      registry.register(submission),
    ]);
    expect(second.id).toBe(first.id);
    expect(await registry.list()).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });

  it('rechaza pedidos de otra ruta, rutas desconocidas y entregas repetidas', async () => {
    const { registry } = setup();
    await expect(registry.register({ ...submission, sessionId: 'RUTA-X' })).rejects.toMatchObject({
      code: 'RUTA_DESCONOCIDA',
    });
    await expect(registry.register({ ...submission, orderId: 'NV-900' })).rejects.toMatchObject({
      code: 'PEDIDO_FUERA_DE_RUTA',
    });
    await registry.register(submission);
    await expect(registry.register({ ...submission, id: 'POD-BBBBBBBBBB' })).rejects.toMatchObject({
      code: 'PEDIDO_YA_ENTREGADO',
    });
  });

  it('un comprobante inválido no mueve el pedido', async () => {
    const { registry, tracker } = setup();
    await expect(registry.register({ ...submission, receiverRut: '1-1' })).rejects.toMatchObject({
      code: 'COMPROBANTE_INVALIDO',
    });
    expect(tracker.status('NV-801')).toBe('PENDIENTE');
  });
});
