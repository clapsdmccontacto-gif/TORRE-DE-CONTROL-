import { MemoryRecordStore } from '../../../common/record-store.js';
import { OrderTracker } from './order-tracker.js';

describe('OrderTracker', () => {
  it('lleva el estado y el historial de cada pedido y lo recupera al reiniciar', async () => {
    const store = new MemoryRecordStore();
    let now = Date.parse('2026-10-15T12:00:00Z');
    const tracker = new OrderTracker({ store, now: () => now });
    await tracker.ready;
    expect(tracker.status('NV-1')).toBe('PENDIENTE');
    const seen: string[] = [];
    tracker.subscribe((t) => seen.push(`${t.orderId}:${t.status}`));

    tracker.transition({ orderId: 'NV-1', to: 'EN_RUTA', actor: 'Pedro', vehiclePlate: 'LXCD21' });
    now += 60_000;
    tracker.transition({
      orderId: 'NV-1',
      to: 'ENTREGADO',
      actor: 'Pedro',
      detail: 'Recibió Juan',
    });
    expect(
      tracker.transition({ orderId: 'NV-1', to: 'ENTREGADO', actor: 'Pedro' }).events,
    ).toHaveLength(2);
    expect(seen).toEqual(['NV-1:EN_RUTA', 'NV-1:ENTREGADO']);
    await tracker.flush();

    const restarted = new OrderTracker({ store });
    await restarted.ready;
    expect(restarted.track('NV-1')).toMatchObject({
      status: 'ENTREGADO',
      vehiclePlate: 'LXCD21',
      events: [
        { status: 'EN_RUTA', at: '2026-10-15T12:00:00.000Z', actor: 'Pedro' },
        { status: 'ENTREGADO', at: '2026-10-15T12:01:00.000Z', detail: 'Recibió Juan' },
      ],
    });
  });

  it('tryTransition no falla si el pedido ya avanzó', () => {
    const tracker = new OrderTracker();
    tracker.transition({ orderId: 'NV-2', to: 'EN_RUTA', actor: null });
    tracker.transition({ orderId: 'NV-2', to: 'RECHAZADO', actor: null });
    expect(tracker.tryTransition({ orderId: 'NV-2', to: 'EN_RUTA', actor: null })).toBe(false);
    expect(() => tracker.transition({ orderId: 'NV-2', to: 'EN_RUTA', actor: null })).toThrow(
      expect.objectContaining({ code: 'TRANSICION_INVALIDA' }),
    );
  });
});
