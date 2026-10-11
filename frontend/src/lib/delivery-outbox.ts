import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { idbAll, idbDelete, idbPut } from '@/lib/idb';
import type { DeliverySubmission } from '@/types/api';

/** Comprobante esperando señal: queda en el teléfono hasta que el servidor lo recibe. */
export interface PendingDelivery {
  submission: DeliverySubmission;
  /** Último error de un reintento (null mientras sólo falta señal). */
  error: string | null;
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const pendingDeliveries = () => idbAll<PendingDelivery>('outbox');

/** Guarda el comprobante en el teléfono (sin señal no se pierde) y trata de enviarlo. */
export async function queueDelivery(submission: DeliverySubmission): Promise<void> {
  await idbPut('outbox', submission.id, { submission, error: null } satisfies PendingDelivery);
  changed();
  await flushOutbox();
}

let flushing: Promise<void> | null = null;

/**
 * Envía lo pendiente. Sin conexión queda para el próximo intento; si el servidor lo
 * rechaza por una regla (422), queda con el motivo para que el conductor lo vea.
 */
export function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (const pending of await pendingDeliveries()) {
        try {
          await api.submitDelivery(pending.submission);
          await idbDelete('outbox', pending.submission.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 422) {
            await idbPut('outbox', pending.submission.id, {
              ...pending,
              error: error.message,
            } satisfies PendingDelivery);
          } else {
            break; // Sin señal: se reintenta después.
          }
        }
      }
    } finally {
      flushing = null;
      changed();
    }
  })();
  return flushing;
}

/** Descarta un comprobante rechazado (para registrarlo de nuevo, corregido). */
export async function discardDelivery(id: string): Promise<void> {
  await idbDelete('outbox', id);
  changed();
}
