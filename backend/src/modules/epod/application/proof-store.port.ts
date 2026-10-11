import type { DeliveryOutcome, DeliveryProof, ProofImage } from '../domain/delivery-proof.js';

export interface StoredImage extends ProofImage {
  id: string;
  proofId: string;
}

export interface ProofFilter {
  /** Desde / hasta (ISO 8601) según la hora de la entrega. */
  from?: string;
  to?: string;
  vehiclePlate?: string;
  outcome?: DeliveryOutcome;
  orderId?: string;
}

/** Dónde se guardan comprobantes e imágenes (PostgreSQL, memoria o el navegador). */
export interface ProofStore {
  save(proof: DeliveryProof, images: StoredImage[]): Promise<void>;
  find(id: string): Promise<DeliveryProof | null>;
  /** Más recientes primero. */
  list(filter: ProofFilter): Promise<DeliveryProof[]>;
  image(proofId: string, imageId: string): Promise<StoredImage | null>;
}

export function matchesFilter(proof: DeliveryProof, filter: ProofFilter): boolean {
  const at = Date.parse(proof.capturedAt);
  return (
    (!filter.from || at >= Date.parse(filter.from)) &&
    (!filter.to || at < Date.parse(filter.to)) &&
    (!filter.vehiclePlate || proof.vehiclePlate === filter.vehiclePlate) &&
    (!filter.outcome || proof.outcome === filter.outcome) &&
    (!filter.orderId || proof.orderId === filter.orderId)
  );
}

export const byNewest = (a: DeliveryProof, b: DeliveryProof) =>
  Date.parse(b.capturedAt) - Date.parse(a.capturedAt);

/** Sin persistencia: se pierde al reiniciar (desarrollo y tests). */
export class MemoryProofStore implements ProofStore {
  private readonly proofs = new Map<string, DeliveryProof>();
  private readonly images = new Map<string, StoredImage>();

  async save(proof: DeliveryProof, images: StoredImage[]): Promise<void> {
    this.proofs.set(proof.id, structuredClone(proof));
    for (const image of images) this.images.set(image.id, { ...image });
  }

  async find(id: string): Promise<DeliveryProof | null> {
    const proof = this.proofs.get(id);
    return proof ? structuredClone(proof) : null;
  }

  async list(filter: ProofFilter): Promise<DeliveryProof[]> {
    return [...this.proofs.values()]
      .filter((p) => matchesFilter(p, filter))
      .sort(byNewest)
      .map((p) => structuredClone(p));
  }

  async image(proofId: string, imageId: string): Promise<StoredImage | null> {
    const image = this.images.get(imageId);
    return image && image.proofId === proofId ? { ...image } : null;
  }
}
