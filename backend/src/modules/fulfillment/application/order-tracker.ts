import { WriteQueue, type RecordStore } from '../../../common/record-store.js';
import {
  applyEvent,
  canTransition,
  newTrack,
  type OrderStatus,
  type OrderTrack,
} from '../domain/order-status.js';

export interface OrderTrackerDeps {
  /** Dónde se guarda el historial de cada pedido (colección `order-tracks`). */
  store?: RecordStore;
  now?: () => number;
}

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: string | null;
  vehiclePlate?: string | null;
  detail?: string | null;
}

const TRACKS = 'order-tracks';

/**
 * Estado e historial de cada pedido (picking, carga, ruta, entrega). Sin framework: lo
 * usan el backend y el modo local. Un pedido sin historial está PENDIENTE.
 */
export class OrderTracker {
  readonly ready: Promise<void>;
  private readonly deps: OrderTrackerDeps;
  private readonly tracks = new Map<string, OrderTrack>();
  private readonly listeners = new Set<(track: OrderTrack) => void>();
  private readonly writes = new WriteQueue();

  constructor(deps: OrderTrackerDeps = {}) {
    this.deps = deps;
    this.ready = this.restore();
  }

  flush(): Promise<void> {
    return this.writes.flush();
  }

  status(orderId: string): OrderStatus {
    return this.tracks.get(orderId)?.status ?? 'PENDIENTE';
  }

  track(orderId: string): OrderTrack {
    return structuredClone(this.tracks.get(orderId) ?? newTrack(orderId));
  }

  all(): OrderTrack[] {
    return [...this.tracks.values()].map((t) => structuredClone(t));
  }

  /** Mueve el pedido (valida la transición). Repetir el mismo estado no hace nada. */
  transition(input: TransitionInput): OrderTrack {
    const current = this.tracks.get(input.orderId) ?? newTrack(input.orderId);
    if (current.status === input.to) return structuredClone(current);
    const next = applyEvent(current, {
      at: new Date(this.now()).toISOString(),
      status: input.to,
      actor: input.actor,
      vehiclePlate: input.vehiclePlate ?? null,
      detail: input.detail ?? null,
    });
    this.tracks.set(next.orderId, next);
    const store = this.deps.store;
    if (store) {
      const saved = structuredClone(next);
      this.writes.enqueue(() => store.put(TRACKS, saved.orderId, saved));
    }
    for (const listener of this.listeners) listener(structuredClone(next));
    return structuredClone(next);
  }

  /** Como `transition`, pero si no corresponde (p. ej. ya entregado) no hace nada. */
  tryTransition(input: TransitionInput): boolean {
    const status = this.status(input.orderId);
    if (status === input.to || !canTransition(status, input.to)) return false;
    this.transition(input);
    return true;
  }

  subscribe(listener: (track: OrderTrack) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async restore(): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    for (const record of await store.list(TRACKS)) {
      const track = record.value as OrderTrack | null;
      if (track?.orderId && track.status && Array.isArray(track.events)) {
        this.tracks.set(track.orderId, track);
      }
    }
  }
}
