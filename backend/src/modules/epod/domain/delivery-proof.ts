import { DomainError } from '../../../common/domain-error.js';
import { distanceMeters, isValidLatLng, type LatLng } from '../../../common/geo.js';
import type { DeliveryOrder } from '../../routing/domain/delivery.js';
import { canonicalRut } from './rut.js';

/** Resultado de la entrega (son también los estados finales del pedido). */
export type DeliveryOutcome = 'ENTREGADO' | 'ENTREGA_PARCIAL' | 'RECHAZADO';

/** Más lejos que esto de la obra, el comprobante queda marcado para revisar. */
export const FAR_FROM_SITE_M = 300;
/** Tamaño máximo de cada imagen (foto o firma) que acepta el servidor. */
export const MAX_IMAGE_BYTES = 1_000_000;
export const MAX_PHOTOS = 2;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type ImageKind = 'FIRMA' | 'FOTO';

/** Lo que envía el teléfono del conductor al entregar (las imágenes como data URL). */
export interface DeliverySubmission {
  /** Generado en el teléfono: reintentar sin señal no duplica el comprobante. */
  id: string;
  orderId: string;
  sessionId: string;
  receiverName: string | null;
  receiverRut: string | null;
  lines: { sku: string; delivered: number }[];
  /** Motivo de la entrega parcial o del rechazo. */
  reason: string | null;
  signature: string | null;
  photos: string[];
  position: { lat: number; lng: number; accuracyM: number | null } | null;
  /** Hora del teléfono al entregar (ISO 8601). */
  capturedAt: string;
}

export interface ProofLine {
  sku: string;
  name: string;
  ordered: number;
  delivered: number;
}

/** Comprobante guardado (sin las imágenes, que van aparte). */
export interface DeliveryProof {
  id: string;
  orderId: string;
  sessionId: string;
  vehiclePlate: string;
  driverName: string;
  customerName: string | null;
  siteName: string;
  siteAddress: string | null;
  commune: string;
  siteLocation: LatLng;
  outcome: DeliveryOutcome;
  reason: string | null;
  receiverName: string | null;
  receiverRut: string | null;
  lines: ProofLine[];
  position: { lat: number; lng: number; accuracyM: number | null } | null;
  /** Metros entre donde se entregó y la obra (null sin GPS). */
  distanceM: number | null;
  farFromSite: boolean;
  capturedAt: string;
  receivedAt: string;
  images: { id: string; kind: ImageKind }[];
}

/** Imagen ya validada: tipo y contenido en base64 (sin el prefijo data:). */
export interface ProofImage {
  kind: ImageKind;
  mime: string;
  base64: string;
}

export interface OrderForProof {
  id: string;
  customerName: string | null;
  siteName: string;
  siteAddress: string | null;
  commune: string;
  siteLocation: LatLng;
  lines: { sku: string; name: string; quantity: number }[];
}

const invalid = (message: string) => new DomainError('COMPROBANTE_INVALIDO', message);

/** Entregado si llegó todo, rechazado si no llegó nada, parcial en otro caso. */
export function deliveryOutcome(lines: readonly ProofLine[]): DeliveryOutcome {
  const delivered = lines.reduce((sum, l) => sum + l.delivered, 0);
  if (delivered === 0) return 'RECHAZADO';
  return lines.every((l) => l.delivered === l.ordered) ? 'ENTREGADO' : 'ENTREGA_PARCIAL';
}

/** Distancia de la entrega a la obra y si está demasiado lejos para darla por buena. */
export function deliveryDistance(
  position: LatLng | null,
  site: LatLng,
): { distanceM: number | null; farFromSite: boolean } {
  if (!position) return { distanceM: null, farFromSite: false };
  const distanceM = Math.round(distanceMeters(position, site));
  return { distanceM, farFromSite: distanceM > FAR_FROM_SITE_M };
}

/**
 * «data:image/jpeg;base64,…» → tipo y contenido. Valida tipo y tamaño (el tamaño real se
 * calcula del largo del base64, sin decodificar: sirve igual en el navegador).
 */
export function parseImageDataUrl(dataUrl: string, kind: ImageKind): ProofImage {
  const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  const label = kind === 'FIRMA' ? 'La firma' : 'La foto';
  if (!match || !IMAGE_TYPES.includes(match[1])) {
    throw invalid(`${label} no es una imagen JPEG, PNG o WebP.`);
  }
  const base64 = match[2];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes > MAX_IMAGE_BYTES) {
    throw invalid(`${label} pesa ${Math.round(bytes / 1000)} kB: el máximo es 1 MB.`);
  }
  if (bytes < 100) throw invalid(`${label} está vacía.`);
  return { kind, mime: match[1], base64 };
}

/**
 * Valida lo que envió el conductor contra el pedido y arma el comprobante. Reglas:
 * cada producto del pedido con su cantidad entregada (0 a lo pedido); motivo si no se
 * entregó todo; nombre, RUT válido y firma de quien recibe si se entregó algo; al menos
 * una foto del lugar (hasta dos).
 */
export function buildProof(
  input: DeliverySubmission,
  order: OrderForProof,
  context: { vehiclePlate: string; driverName: string; receivedAt: string; imageIds: string[] },
): { proof: DeliveryProof; images: ProofImage[] } {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.id))
    throw invalid('Identificador de comprobante inválido.');
  if (Number.isNaN(Date.parse(input.capturedAt))) throw invalid('Hora de la entrega inválida.');

  const sent = new Map<string, number>();
  for (const line of input.lines) {
    const sku = line.sku.trim().toUpperCase();
    if (sent.has(sku)) throw invalid(`El producto ${sku} viene dos veces.`);
    sent.set(sku, line.delivered);
  }
  const lines: ProofLine[] = order.lines.map((l) => {
    const delivered = sent.get(l.sku);
    if (delivered === undefined) throw invalid(`Falta la cantidad entregada de ${l.name}.`);
    if (!Number.isFinite(delivered) || delivered < 0 || delivered > l.quantity) {
      throw invalid(`${l.name}: la cantidad entregada debe estar entre 0 y ${l.quantity}.`);
    }
    sent.delete(l.sku);
    return { sku: l.sku, name: l.name, ordered: l.quantity, delivered };
  });
  if (sent.size > 0) throw invalid(`El pedido no tiene ${[...sent.keys()].join(', ')}.`);

  const outcome = deliveryOutcome(lines);
  const reason = input.reason?.trim().replace(/\s+/g, ' ') || null;
  if (outcome !== 'ENTREGADO' && (!reason || reason.length < 3)) {
    throw invalid(
      outcome === 'RECHAZADO'
        ? 'Indique el motivo del rechazo.'
        : 'Indique el motivo de la entrega parcial.',
    );
  }
  if (reason && reason.length > 300) throw invalid('El motivo admite hasta 300 caracteres.');

  const receiverName = input.receiverName?.trim().replace(/\s+/g, ' ') || null;
  const rutText = input.receiverRut?.trim() || '';
  const receiverRut = rutText ? canonicalRut(rutText) : null;
  if (rutText && !receiverRut) throw invalid('El RUT de quien recibe no es válido.');
  if (outcome !== 'RECHAZADO') {
    if (!receiverName || receiverName.length < 2)
      throw invalid('Escriba el nombre de quien recibe.');
    if (!receiverRut) throw invalid('Escriba el RUT de quien recibe.');
    if (!input.signature) throw invalid('Falta la firma de quien recibe.');
  }
  if (receiverName && receiverName.length > 100)
    throw invalid('Nombre de quien recibe: hasta 100 caracteres.');

  if (input.photos.length === 0) throw invalid('Falta la foto del lugar de entrega.');
  if (input.photos.length > MAX_PHOTOS) throw invalid(`Se admiten hasta ${MAX_PHOTOS} fotos.`);
  const images = [
    ...(input.signature ? [parseImageDataUrl(input.signature, 'FIRMA')] : []),
    ...input.photos.map((photo) => parseImageDataUrl(photo, 'FOTO')),
  ];

  const position =
    input.position && isValidLatLng(input.position)
      ? {
          lat: input.position.lat,
          lng: input.position.lng,
          accuracyM: input.position.accuracyM ?? null,
        }
      : null;
  return {
    proof: {
      id: input.id,
      orderId: order.id,
      sessionId: input.sessionId,
      vehiclePlate: context.vehiclePlate,
      driverName: context.driverName,
      customerName: order.customerName,
      siteName: order.siteName,
      siteAddress: order.siteAddress,
      commune: order.commune,
      siteLocation: order.siteLocation,
      outcome,
      reason,
      receiverName,
      receiverRut,
      lines,
      position,
      ...deliveryDistance(position, order.siteLocation),
      capturedAt: new Date(input.capturedAt).toISOString(),
      receivedAt: context.receivedAt,
      images: images.map((image, i) => ({ id: context.imageIds[i], kind: image.kind })),
    },
    images,
  };
}

/** El pedido (con su obra y productos) en la forma que necesita el comprobante. */
export function proofOrderOf(order: DeliveryOrder): OrderForProof {
  return {
    id: order.id,
    customerName: order.customerName ?? null,
    siteName: order.site.name,
    siteAddress: order.site.address ?? null,
    commune: order.site.commune,
    siteLocation: order.site.location,
    lines: order.lines.map((l) => ({
      sku: l.product.sku,
      name: l.product.name,
      quantity: l.quantity,
    })),
  };
}
