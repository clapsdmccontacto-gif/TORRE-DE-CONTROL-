import { DomainError } from '../../../common/domain-error.js';
import { distanceMeters, isValidLatLng, type LatLng } from '../../../common/geo.js';
import type { DeliveryOutcome } from '../../epod/domain/delivery-proof.js';

/** Lectura GPS enviada por el teléfono del conductor. */
export interface PositionFix {
  lat: number;
  lng: number;
  /** Precisión informada por el GPS (metros); null si el dispositivo no la entrega. */
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  /** Instante de la lectura en el dispositivo (ISO 8601). */
  recordedAt: string;
}

export interface TrackingPolicy {
  /** Lecturas menos precisas que esto se descartan (GPS dentro de bodega, arranque en frío). */
  maxAccuracyM: number;
  /** Un salto que implique más velocidad que esto es ruido del GPS, no un camión. */
  maxPlausibleSpeedKmh: number;
  /** Bajo esta velocidad el vehículo se considera detenido. */
  stoppedBelowKmh: number;
  /** Sin lecturas durante este tiempo, el dispositivo pasa a "sin señal". */
  signalLostAfterSec: number;
  /** Radio alrededor del punto de descarga que cuenta como "en obra". */
  geofenceRadiusM: number;
  /** Distancia por calle ≈ línea recta × este factor (sin motor de ruteo). */
  circuityFactor: number;
  /** Velocidad para estimar ETA cuando el vehículo va lento o detenido. */
  typicalSpeedKmh: number;
}

export const DEFAULT_TRACKING_POLICY: TrackingPolicy = {
  maxAccuracyM: 100,
  maxPlausibleSpeedKmh: 150,
  stoppedBelowKmh: 3,
  signalLostAfterSec: 120,
  geofenceRadiusM: 150,
  circuityFactor: 1.3,
  typicalSpeedKmh: 40,
};

export type FixRejection =
  'COORDENADA_INVALIDA' | 'PRECISION_BAJA' | 'FUERA_DE_ORDEN' | 'SALTO_IMPOSIBLE';

export type FixEvaluation = { accepted: true } | { accepted: false; reason: FixRejection };

/** Filtra el ruido típico del GPS de un teléfono antes de guardar la lectura. */
export function evaluateFix(
  previous: PositionFix | null,
  next: PositionFix,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): FixEvaluation {
  if (!isValidLatLng(next) || Number.isNaN(Date.parse(next.recordedAt))) {
    return { accepted: false, reason: 'COORDENADA_INVALIDA' };
  }
  if (next.accuracyM !== null && next.accuracyM > policy.maxAccuracyM) {
    return { accepted: false, reason: 'PRECISION_BAJA' };
  }
  if (!previous) return { accepted: true };

  const seconds = (Date.parse(next.recordedAt) - Date.parse(previous.recordedAt)) / 1000;
  if (seconds <= 0) return { accepted: false, reason: 'FUERA_DE_ORDEN' };

  const impliedKmh = (distanceMeters(previous, next) / seconds) * 3.6;
  if (impliedKmh > policy.maxPlausibleSpeedKmh) {
    return { accepted: false, reason: 'SALTO_IMPOSIBLE' };
  }
  return { accepted: true };
}

/** Velocidad informada por el GPS o, si no viene, la calculada entre dos lecturas. */
export function effectiveSpeedKmh(previous: PositionFix | null, next: PositionFix): number | null {
  if (next.speedKmh !== null) return next.speedKmh;
  if (!previous) return null;
  const seconds = (Date.parse(next.recordedAt) - Date.parse(previous.recordedAt)) / 1000;
  return seconds > 0 ? (distanceMeters(previous, next) / seconds) * 3.6 : null;
}

export type DeviceStatus = 'EN_MOVIMIENTO' | 'DETENIDO' | 'SIN_SENAL';

export function deviceStatus(
  last: PositionFix | null,
  speedKmh: number | null,
  nowMs: number,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): DeviceStatus {
  if (!last || nowMs - Date.parse(last.recordedAt) > policy.signalLostAfterSec * 1000) {
    return 'SIN_SENAL';
  }
  return (speedKmh ?? 0) < policy.stoppedBelowKmh ? 'DETENIDO' : 'EN_MOVIMIENTO';
}

export interface TrackSummary {
  distanceKm: number;
  durationMin: number;
  maxSpeedKmh: number;
}

export function summarizeTrack(fixes: readonly PositionFix[]): TrackSummary {
  let meters = 0;
  let maxSpeedKmh = 0;
  for (let i = 1; i < fixes.length; i++) {
    meters += distanceMeters(fixes[i - 1], fixes[i]);
    maxSpeedKmh = Math.max(maxSpeedKmh, effectiveSpeedKmh(fixes[i - 1], fixes[i]) ?? 0);
  }
  const durationMs =
    fixes.length > 1 ? Date.parse(fixes.at(-1)!.recordedAt) - Date.parse(fixes[0].recordedAt) : 0;
  return { distanceKm: meters / 1000, durationMin: durationMs / 60_000, maxSpeedKmh };
}

/** ETA por distancia en línea recta × factor de recorrido y una velocidad realista. */
export function etaMinutes(
  from: LatLng,
  to: LatLng,
  speedKmh: number | null,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): number {
  const km = (distanceMeters(from, to) * policy.circuityFactor) / 1000;
  const speed = Math.max(speedKmh ?? 0, policy.typicalSpeedKmh);
  return (km / speed) * 60;
}

export type StopState = 'PENDIENTE' | 'EN_OBRA' | 'COMPLETADA';

export interface TrackedStop {
  deliveryId: string;
  siteName: string;
  location: LatLng;
  /** Minutos de ETA a los que se avisa al capataz. */
  notifyEtaMinutes: number;
  state: StopState;
  proximityNotified: boolean;
  /** Resultado registrado por el conductor (sólo en paradas COMPLETADA). */
  outcome?: DeliveryOutcome | null;
}

export type TrackingEventType =
  'AVISO_PROXIMIDAD' | 'LLEGADA_OBRA' | 'SALIDA_OBRA' | 'ENTREGA_REGISTRADA';

export interface StopEvent {
  type: TrackingEventType;
  deliveryId: string;
  siteName: string;
  etaMinutes: number | null;
}

export interface StopProgress {
  stops: TrackedStop[];
  events: StopEvent[];
  /** ETA a la próxima parada pendiente (o a la obra en curso: 0). */
  nextStopEtaMin: number | null;
}

/** Metros más allá del radio para dar por salida (evita que el ruido del GPS entre y salga). */
const GEOFENCE_EXIT_MARGIN_M = 100;

/**
 * Avanza el estado de las paradas con una nueva posición. La geocerca sólo **sugiere**: la
 * entrega la registra el conductor (`completeStop`), nunca se marca sola.
 * - Entra al radio de una obra pendiente → LLEGADA_OBRA (EN_OBRA: «Llegó a la obra»).
 * - Sale (radio + margen) sin registrar la entrega → SALIDA_OBRA y vuelve a PENDIENTE.
 * - ETA a la próxima obra ≤ aviso configurado → AVISO_PROXIMIDAD (una sola vez).
 */
export function progressStops(
  stops: readonly TrackedStop[],
  position: LatLng,
  speedKmh: number | null,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): StopProgress {
  const next = stops.map((s) => ({ ...s }));
  const events: StopEvent[] = [];
  for (const stop of next) {
    if (stop.state === 'COMPLETADA') continue;
    const meters = distanceMeters(position, stop.location);
    if (stop.state === 'PENDIENTE' && meters <= policy.geofenceRadiusM) {
      stop.state = 'EN_OBRA';
      stop.proximityNotified = true; // Ya llegó: no tiene sentido avisar después.
      events.push(stopEvent('LLEGADA_OBRA', stop, 0));
    } else if (
      stop.state === 'EN_OBRA' &&
      meters > policy.geofenceRadiusM + GEOFENCE_EXIT_MARGIN_M
    ) {
      stop.state = 'PENDIENTE';
      events.push(stopEvent('SALIDA_OBRA', stop, null));
    }
  }

  const target = targetStop(next);
  if (target?.state === 'PENDIENTE') {
    const eta = etaMinutes(position, target.location, speedKmh, policy);
    if (!target.proximityNotified && eta <= target.notifyEtaMinutes) {
      target.proximityNotified = true;
      events.push(stopEvent('AVISO_PROXIMIDAD', target, eta));
    }
  }
  return { stops: next, events, nextStopEtaMin: nextStopEta(next, position, speedKmh, policy) };
}

/** El conductor registró la entrega: la parada queda COMPLETADA (repetirlo no hace nada). */
export function completeStop(
  stops: readonly TrackedStop[],
  deliveryId: string,
  outcome: DeliveryOutcome = 'ENTREGADO',
): { stops: TrackedStop[]; event: StopEvent | null } {
  const index = stops.findIndex((s) => s.deliveryId === deliveryId);
  if (index === -1) {
    throw new DomainError('PARADA_DESCONOCIDA', `La ruta no tiene el pedido ${deliveryId}.`);
  }
  if (stops[index].state === 'COMPLETADA') return { stops: [...stops], event: null };
  const next = stops.map((s, i) =>
    i === index ? { ...s, state: 'COMPLETADA' as const, outcome } : s,
  );
  return { stops: next, event: stopEvent('ENTREGA_REGISTRADA', next[index], null) };
}

/** Próxima parada: la obra donde está el camión o, si no, la primera pendiente de la ruta. */
export function targetStop<T extends { state: StopState }>(stops: readonly T[]): T | null {
  return (
    stops.find((s) => s.state === 'EN_OBRA') ?? stops.find((s) => s.state === 'PENDIENTE') ?? null
  );
}

/** Minutos a la próxima parada (0 si ya está en la obra; null sin paradas o sin posición). */
export function nextStopEta(
  stops: readonly TrackedStop[],
  position: LatLng | null,
  speedKmh: number | null,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): number | null {
  const target = targetStop(stops);
  if (!target) return null;
  if (target.state === 'EN_OBRA') return 0;
  return position ? etaMinutes(position, target.location, speedKmh, policy) : null;
}

function stopEvent(
  type: TrackingEventType,
  stop: TrackedStop,
  etaMinutes: number | null,
): StopEvent {
  return { type, deliveryId: stop.deliveryId, siteName: stop.siteName, etaMinutes };
}
