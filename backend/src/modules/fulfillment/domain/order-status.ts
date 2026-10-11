import { DomainError } from '../../../common/domain-error.js';

/** Estados de un pedido, de punta a punta (valores de negocio en español). */
export const ORDER_STATUSES = [
  'PENDIENTE',
  'EN_PICKING',
  'PICKEADO',
  'PICKEADO_PARCIAL',
  'CARGADO',
  'EN_RUTA',
  'ENTREGADO',
  'ENTREGA_PARCIAL',
  'RECHAZADO',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_PICKING: 'En picking',
  PICKEADO: 'Pickeado',
  PICKEADO_PARCIAL: 'Pickeado con faltantes',
  CARGADO: 'Cargado en camión',
  EN_RUTA: 'En ruta',
  ENTREGADO: 'Entregado',
  ENTREGA_PARCIAL: 'Entrega parcial',
  RECHAZADO: 'Rechazado',
};

/**
 * Transiciones válidas. El camino completo es PENDIENTE → EN_PICKING → PICKEADO(_PARCIAL)
 * → CARGADO → EN_RUTA → entregado. Si la bodega no escanea el picking o la carga, el pedido
 * puede salir a ruta directamente (queda registrado en su historial). Los estados de
 * entrega son finales.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDIENTE: ['EN_PICKING', 'EN_RUTA'],
  EN_PICKING: ['PENDIENTE', 'PICKEADO', 'PICKEADO_PARCIAL'],
  PICKEADO: ['EN_PICKING', 'CARGADO', 'EN_RUTA'],
  PICKEADO_PARCIAL: ['EN_PICKING', 'CARGADO', 'EN_RUTA'],
  CARGADO: ['PICKEADO', 'EN_RUTA'],
  EN_RUTA: ['CARGADO', 'ENTREGADO', 'ENTREGA_PARCIAL', 'RECHAZADO'],
  ENTREGADO: [],
  ENTREGA_PARCIAL: [],
  RECHAZADO: [],
};

export const DELIVERED_STATUSES: readonly OrderStatus[] = [
  'ENTREGADO',
  'ENTREGA_PARCIAL',
  'RECHAZADO',
];

/** Se puede planificar (optimizador): todavía no salió a ruta ni se entregó. */
export function isPlannable(status: OrderStatus): boolean {
  return status !== 'EN_RUTA' && !DELIVERED_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Un hito del pedido: quién lo movió, cuándo y con qué (camión, faltante, comprobante…). */
export interface OrderEvent {
  at: string;
  status: OrderStatus;
  /** Operario, conductor o «Torre de control». */
  actor: string | null;
  vehiclePlate: string | null;
  detail: string | null;
}

export interface OrderTrack {
  orderId: string;
  status: OrderStatus;
  /** Camión que lo lleva (desde que se carga o sale a ruta). */
  vehiclePlate: string | null;
  events: OrderEvent[];
}

export function newTrack(orderId: string): OrderTrack {
  return { orderId, status: 'PENDIENTE', vehiclePlate: null, events: [] };
}

/** Aplica un hito: valida la transición y lo agrega al historial. */
export function applyEvent(track: OrderTrack, event: OrderEvent): OrderTrack {
  if (!canTransition(track.status, event.status)) {
    throw new DomainError(
      'TRANSICION_INVALIDA',
      `El pedido ${track.orderId} está «${ORDER_STATUS_LABEL[track.status]}» y no puede pasar a «${ORDER_STATUS_LABEL[event.status]}».`,
      { orderId: track.orderId, from: track.status, to: event.status },
    );
  }
  const vehiclePlate =
    event.status === 'PENDIENTE' || event.status === 'EN_PICKING'
      ? null
      : (event.vehiclePlate ?? track.vehiclePlate);
  return {
    orderId: track.orderId,
    status: event.status,
    vehiclePlate,
    events: [...track.events, event],
  };
}
