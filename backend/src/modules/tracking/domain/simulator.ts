import { bearingDegrees, distanceMeters, interpolate, type LatLng } from '../../../common/geo.js';
import type { PositionFix } from './tracking.js';

/**
 * Viaje simulado para demostraciones: recorre bodega → obras → bodega a velocidad
 * constante, detenido `dwellMinutes` en cada obra. Al terminar queda en la bodega.
 */
export interface SimulatedTrip {
  /** Bodega, obras en orden de visita y bodega otra vez. */
  path: readonly LatLng[];
  speedKmh: number;
  dwellMinutes: number;
  startedAtMs: number;
}

interface Phase {
  from: LatLng;
  to: LatLng;
  startMs: number;
  endMs: number;
  moving: boolean;
}

function phases(trip: SimulatedTrip): Phase[] {
  const result: Phase[] = [];
  let t = trip.startedAtMs;
  for (let i = 0; i < trip.path.length - 1; i++) {
    const from = trip.path[i];
    const to = trip.path[i + 1];
    const travelMs = (distanceMeters(from, to) / 1000 / trip.speedKmh) * 3_600_000;
    result.push({ from, to, startMs: t, endMs: t + travelMs, moving: true });
    t += travelMs;
    const isIntermediateStop = i + 1 < trip.path.length - 1;
    if (isIntermediateStop) {
      const dwellMs = trip.dwellMinutes * 60_000;
      result.push({ from: to, to, startMs: t, endMs: t + dwellMs, moving: false });
      t += dwellMs;
    }
  }
  return result;
}

export function simulatedTripDurationMs(trip: SimulatedTrip): number {
  const all = phases(trip);
  return all.length > 0 ? all.at(-1)!.endMs - trip.startedAtMs : 0;
}

/** Posición del vehículo simulado en el instante dado. */
export function simulatePosition(trip: SimulatedTrip, atMs: number): PositionFix {
  const all = phases(trip);
  const recordedAt = new Date(atMs).toISOString();
  const first = trip.path[0];
  if (all.length === 0 || atMs <= trip.startedAtMs) {
    return { ...first, accuracyM: 8, speedKmh: 0, headingDeg: null, recordedAt };
  }

  const phase = all.find((p) => atMs < p.endMs) ?? all.at(-1)!;
  if (atMs >= phase.endMs || !phase.moving) {
    const point = atMs >= phase.endMs ? phase.to : phase.from;
    return { ...point, accuracyM: 8, speedKmh: 0, headingDeg: null, recordedAt };
  }
  const t = (atMs - phase.startMs) / (phase.endMs - phase.startMs);
  return {
    ...interpolate(phase.from, phase.to, t),
    accuracyM: 8,
    speedKmh: trip.speedKmh,
    headingDeg: bearingDegrees(phase.from, phase.to),
    recordedAt,
  };
}

/** Lecturas desde el inicio del viaje hasta `untilMs`, una cada `everySec` segundos. */
export function simulateTrack(
  trip: SimulatedTrip,
  untilMs: number,
  everySec: number,
): PositionFix[] {
  const fixes: PositionFix[] = [];
  for (let t = trip.startedAtMs; t <= untilMs; t += everySec * 1000) {
    fixes.push(simulatePosition(trip, t));
  }
  return fixes;
}
