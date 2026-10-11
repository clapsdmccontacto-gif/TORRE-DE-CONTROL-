import { DomainError } from '../../../common/domain-error.js';
import { newId } from '../../../common/ids.js';
import type { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import { DELIVERED_STATUSES } from '../../fulfillment/domain/order-status.js';
import {
  buildProof,
  type DeliveryProof,
  type DeliverySubmission,
  type OrderForProof,
} from '../domain/delivery-proof.js';
import type { ProofFilter, ProofStore, StoredImage } from './proof-store.port.js';

export interface RouteForProof {
  vehiclePlate: string;
  driverName: string;
  /** Pedidos de la ruta de ese conductor. */
  deliveryIds: string[];
}

export interface DeliveryRegistryDeps {
  store: ProofStore;
  order: (orderId: string) => OrderForProof | null;
  route: (sessionId: string) => RouteForProof | null;
  tracker: OrderTracker;
  /** Ya guardado: marca la parada en la ruta del conductor y en el mapa. */
  onDelivered?: (proof: DeliveryProof) => void | Promise<void>;
  now?: () => number;
}

/**
 * Caso de uso "registrar la entrega" (e-POD): valida el comprobante contra el pedido y la
 * ruta, lo guarda con sus imágenes y deja el pedido en ENTREGADO, ENTREGA_PARCIAL o
 * RECHAZADO. Reenviar el mismo comprobante (sin señal) devuelve el ya guardado. Sin
 * framework: lo usan el backend y el modo local.
 */
export class DeliveryRegistry {
  private readonly deps: DeliveryRegistryDeps;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: DeliveryRegistryDeps) {
    this.deps = deps;
  }

  register(input: DeliverySubmission): Promise<DeliveryProof> {
    // Uno a la vez: dos reintentos simultáneos del mismo comprobante no lo duplican.
    const run = this.queue.then(() => this.registerNow(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  list(filter: ProofFilter = {}): Promise<DeliveryProof[]> {
    return this.deps.store.list(filter);
  }

  async get(id: string): Promise<DeliveryProof> {
    const proof = await this.deps.store.find(id);
    if (!proof) throw new DomainError('COMPROBANTE_DESCONOCIDO', 'El comprobante no existe.');
    return proof;
  }

  async image(proofId: string, imageId: string): Promise<StoredImage> {
    const image = await this.deps.store.image(proofId, imageId);
    if (!image) throw new DomainError('IMAGEN_DESCONOCIDA', 'La imagen no existe.');
    return image;
  }

  private async registerNow(input: DeliverySubmission): Promise<DeliveryProof> {
    const existing = await this.deps.store.find(input.id);
    if (existing) return existing;

    const route = this.deps.route(input.sessionId);
    if (!route) {
      throw new DomainError('RUTA_DESCONOCIDA', 'La ruta del conductor no existe en el servidor.');
    }
    if (!route.deliveryIds.includes(input.orderId)) {
      throw new DomainError(
        'PEDIDO_FUERA_DE_RUTA',
        `El pedido ${input.orderId} no está en la ruta de ${route.vehiclePlate}.`,
      );
    }
    const order = this.deps.order(input.orderId);
    if (!order)
      throw new DomainError('PEDIDO_DESCONOCIDO', `El pedido ${input.orderId} no existe.`);
    const status = this.deps.tracker.status(order.id);
    if (DELIVERED_STATUSES.includes(status)) {
      throw new DomainError(
        'PEDIDO_YA_ENTREGADO',
        `El pedido ${order.id} ya tiene su entrega registrada.`,
      );
    }

    const { proof, images } = buildProof(input, order, {
      vehiclePlate: route.vehiclePlate,
      driverName: route.driverName,
      receivedAt: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
      imageIds: [newId('IMG'), newId('IMG'), newId('IMG')],
    });
    await this.deps.store.save(
      proof,
      images.map((image, i) => ({ ...image, id: proof.images[i].id, proofId: proof.id })),
    );
    const actor = route.driverName;
    this.deps.tracker.tryTransition({
      orderId: order.id,
      to: 'EN_RUTA',
      actor,
      vehiclePlate: route.vehiclePlate,
    });
    this.deps.tracker.transition({
      orderId: order.id,
      to: proof.outcome,
      actor,
      vehiclePlate: route.vehiclePlate,
      detail:
        proof.outcome === 'RECHAZADO'
          ? `Motivo: ${proof.reason}`
          : `Recibió ${proof.receiverName}${proof.reason ? ` · ${proof.reason}` : ''}`,
    });
    await this.deps.tracker.flush();
    await this.deps.onDelivered?.(proof);
    return proof;
  }
}
