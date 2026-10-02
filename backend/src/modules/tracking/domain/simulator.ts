import { bearingDegrees, distanceMeters, interpolate, type LatLng } from '../../../common/geo.js';
import type { PositionFix } from './tracking.js';

/**
 * Viaje simulado para demostraciones: recorre bodega → obras → bodega a velocidad
 * constante siguiendo el trazado (por calles si la ruta fue ajustada), detenido
 * `dwellMinutes` en cada obra. Al terminar queda en la bodega.
 */
export interface SimulatedTrip {
  /** Tramos bodega → obra → … → bodega; cada uno es un trazado de dos o más puntos. */
  legs: readonly (readonly LatLng[])[];
  speedKmh: number;
  dwellMinutes: number;
  startedAtMs: number;
}

/** Tolerancia para elegir la primera pasada del trazado junto a una obra. */
const STOP_MATCH_SLACK_M = 30;

/**
 * Corta el trazado de una ruta (bodega → obras → bodega) en un tramo por obra. Sirve para
 * la línea recta del plan estimado y para el trazado por calles, que no trae los cortes.
 */
export function tripLegs(path: readonly LatLng[], stops: readonly LatLng[]): LatLng[][] {
  if (path.length < 2) return [];
  const legs: LatLng[][] = [];
  let from = 0;
  let leg: LatLng[] = [path[0]];
  for (const stop of stops) {
    let best = Infinity;
    for (let i = from; i < path.length; i++) best = Math.min(best, distanceMeters(path[i], stop));
    // La primera vez que el trazado pasa junto a la obra (una ruta puede volver por la misma calle).
    let at = from;
    while (distanceMeters(path[at], stop) > best + STOP_MATCH_SLACK_M) at++;
    leg.push(...path.slice(from + 1, at + 1));
    if (distanceMeters(leg.at(-1)!, stop) > 1) leg.push(stop);
    legs.push(leg);
    leg = [stop];
    from = at;
  }
  leg.push(...path.slice(from + 1));
  legs.push(leg);
  return legs;
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
  trip.legs.forEach((leg, legIndex) => {
    for (let i = 0; i < leg.length - 1; i++) {
      const from = leg[i];
      const to = leg[i + 1];
      const travelMs = (distanceMeters(from, to) / 1000 / trip.speedKmh) * 3_600_000;
      if (travelMs === 0) continue;
      result.push({ from, to, startMs: t, endMs: t + travelMs, moving: true });
      t += travelMs;
    }
    // Descarga en cada obra (todas menos el regreso a bodega).
    if (legIndex < trip.legs.length - 1) {
      const at = leg.at(-1)!;
      const dwellMs = trip.dwellMinutes * 60_000;
      result.push({ from: at, to: at, startMs: t, endMs: t + dwellMs, moving: false });
      t += dwellMs;
    }
  });
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
  const first = trip.legs[0]?.[0] ?? { lat: 0, lng: 0 };
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
