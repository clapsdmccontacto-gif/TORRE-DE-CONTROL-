import { distanceMeters, isValidLatLng, type LatLng } from '../../../common/geo.js';

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
}

export type TrackingEventType = 'AVISO_PROXIMIDAD' | 'LLEGADA_OBRA' | 'SALIDA_OBRA';

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

/**
 * Avanza el estado de las paradas con una nueva posición:
 * - ETA a la próxima obra ≤ aviso configurado → AVISO_PROXIMIDAD (una sola vez).
 * - Entra al radio de la obra → LLEGADA_OBRA (EN_OBRA).
 * - Sale del radio después de llegar → SALIDA_OBRA (COMPLETADA) y pasa a la siguiente.
 */
export function progressStops(
  stops: readonly TrackedStop[],
  position: LatLng,
  speedKmh: number | null,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): StopProgress {
  const next = stops.map((s) => ({ ...s }));
  const events: StopEvent[] = [];
  const current = next.find((s) => s.state !== 'COMPLETADA');
  if (!current) return { stops: next, events, nextStopEtaMin: null };

  const inside = distanceMeters(position, current.location) <= policy.geofenceRadiusM;

  if (current.state === 'EN_OBRA') {
    if (inside) return { stops: next, events, nextStopEtaMin: 0 };
    current.state = 'COMPLETADA';
    events.push({
      type: 'SALIDA_OBRA',
      deliveryId: current.deliveryId,
      siteName: current.siteName,
      etaMinutes: null,
    });
    const following = next.find((s) => s.state === 'PENDIENTE');
    return {
      stops: next,
      events,
      nextStopEtaMin: following ? etaMinutes(position, following.location, speedKmh, policy) : null,
    };
  }

  if (inside) {
    current.state = 'EN_OBRA';
    events.push({
      type: 'LLEGADA_OBRA',
      deliveryId: current.deliveryId,
      siteName: current.siteName,
      etaMinutes: 0,
    });
    return { stops: next, events, nextStopEtaMin: 0 };
  }

  const eta = etaMinutes(position, current.location, speedKmh, policy);
  if (!current.proximityNotified && eta <= current.notifyEtaMinutes) {
    current.proximityNotified = true;
    events.push({
      type: 'AVISO_PROXIMIDAD',
      deliveryId: current.deliveryId,
      siteName: current.siteName,
      etaMinutes: eta,
    });
  }
  return { stops: next, events, nextStopEtaMin: eta };
}
