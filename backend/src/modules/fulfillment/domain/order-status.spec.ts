import {
  ORDER_STATUSES,
  applyEvent,
  canTransition,
  isFinal,
  newTrack,
  type OrderStatus,
} from './order-status.js';

const event = (status: OrderStatus, vehiclePlate: string | null = null) => ({
  at: '2026-10-15T12:00:00.000Z',
  status,
  actor: 'Ana',
  vehiclePlate,
  detail: null,
});

describe('estados del pedido', () => {
  it('recorre el camino completo: picking, carga, ruta y entrega', () => {
    let track = newTrack('NV-1');
    for (const status of ['EN_PICKING', 'PICKEADO', 'CARGADO', 'EN_RUTA', 'ENTREGADO'] as const) {
      track = applyEvent(track, event(status, status === 'CARGADO' ? 'LXCD21' : null));
    }
    expect(track.status).toBe('ENTREGADO');
    expect(track.vehiclePlate).toBe('LXCD21');
    expect(track.events.map((e) => e.status)).toEqual([
      'EN_PICKING',
      'PICKEADO',
      'CARGADO',
      'EN_RUTA',
      'ENTREGADO',
    ]);
  });

  it('permite liberar el picking, bajar del camión y salir sin escaneo de bodega', () => {
    expect(canTransition('EN_PICKING', 'PENDIENTE')).toBe(true);
    expect(canTransition('CARGADO', 'PICKEADO')).toBe(true);
    expect(canTransition('PENDIENTE', 'EN_RUTA')).toBe(true);
    expect(canTransition('PICKEADO_PARCIAL', 'EN_RUTA')).toBe(true);
    // Liberar el pedido le quita el camión.
    const loaded = applyEvent(
      applyEvent(applyEvent(newTrack('NV-2'), event('EN_PICKING')), event('PICKEADO')),
      event('CARGADO', 'ABCD12'),
    );
    expect(applyEvent(loaded, event('PICKEADO')).vehiclePlate).toBe('ABCD12');
  });

  it('rechaza saltos imposibles y no se mueve después de entregado', () => {
    expect(canTransition('PENDIENTE', 'ENTREGADO')).toBe(false);
    expect(canTransition('PENDIENTE', 'CARGADO')).toBe(false);
    expect(canTransition('EN_PICKING', 'EN_RUTA')).toBe(false);
    expect(() => applyEvent(newTrack('NV-3'), event('ENTREGADO'))).toThrow(
      expect.objectContaining({ code: 'TRANSICION_INVALIDA' }),
    );
    for (const final of ['ENTREGADO', 'ENTREGA_PARCIAL', 'RECHAZADO'] as const) {
      expect(isFinal(final)).toBe(true);
      expect(ORDER_STATUSES.some((s) => canTransition(final, s))).toBe(false);
    }
  });
});
