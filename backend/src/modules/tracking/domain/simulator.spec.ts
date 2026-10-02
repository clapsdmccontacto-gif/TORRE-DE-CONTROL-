import { distanceMeters } from '../../../common/geo.js';
import {
  simulatePosition,
  simulateTrack,
  simulatedTripDurationMs,
  tripLegs,
  type SimulatedTrip,
} from './simulator.js';

const depot = { lat: -37.0, lng: -72.0 };
const obra = { lat: -37.1, lng: -72.0 }; // ~11,1 km al sur
const trip: SimulatedTrip = {
  legs: [
    [depot, obra],
    [obra, depot],
  ],
  speedKmh: 40,
  dwellMinutes: 20,
  startedAtMs: 0,
};
const legMs = (11.12 / 40) * 3_600_000;

describe('simulatePosition', () => {
  it('parte en bodega, avanza, descarga en la obra y vuelve', () => {
    expect(simulatePosition(trip, 0)).toMatchObject({ lat: depot.lat, speedKmh: 0 });

    const halfway = simulatePosition(trip, legMs / 2);
    expect(distanceMeters(halfway, depot)).toBeCloseTo(5_560, -2);
    expect(halfway).toMatchObject({ speedKmh: 40 });
    expect(halfway.headingDeg).toBeCloseTo(180);

    const unloading = simulatePosition(trip, legMs + 10 * 60_000);
    expect(unloading).toMatchObject({ lat: obra.lat, speedKmh: 0 });

    const done = simulatePosition(trip, simulatedTripDurationMs(trip) + 60_000);
    expect(done).toMatchObject({ lat: depot.lat, speedKmh: 0 });
  });

  it('genera el historial del trayecto a intervalos regulares', () => {
    expect(simulateTrack(trip, 10 * 60_000, 60)).toHaveLength(11);
  });
});

describe('trayecto por calles', () => {
  // Bodega → esquina → obra → esquina → bodega, como un trazado por calles (en "L").
  const corner = { lat: -37.0, lng: -72.1 };
  const site = { lat: -37.1, lng: -72.1 };
  const streetPath = [
    depot,
    { lat: -37.0, lng: -72.05 },
    corner,
    { lat: -37.05, lng: -72.1 },
    site,
    { lat: -37.05, lng: -72.1 },
    corner,
    depot,
  ];

  it('tripLegs corta el trazado en la obra, en su primera pasada', () => {
    const legs = tripLegs(streetPath, [site]);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual(streetPath.slice(0, 5));
    expect(legs[1]).toEqual(streetPath.slice(4));
  });

  it('tripLegs agrega la obra si el trazado pasa cerca pero no encima', () => {
    const near = { lat: -37.1003, lng: -72.1 };
    const legs = tripLegs(streetPath, [near]);
    expect(legs[0].at(-1)).toEqual(near);
    expect(legs[1][0]).toEqual(near);
  });

  it('con la línea recta del plan estimado da un tramo por obra', () => {
    const other = { lat: -37.2, lng: -72.0 };
    expect(tripLegs([depot, obra, other, depot], [obra, other])).toEqual([
      [depot, obra],
      [obra, other],
      [other, depot],
    ]);
  });

  it('el camión simulado sigue las calles y sólo se detiene en la obra', () => {
    const streetTrip: SimulatedTrip = {
      legs: tripLegs(streetPath, [site]),
      speedKmh: 40,
      dwellMinutes: 20,
      startedAtMs: 0,
    };
    const track = simulateTrack(streetTrip, simulatedTripDurationMs(streetTrip), 30);
    // Nunca corta camino en diagonal: cada lectura está sobre una calle del trazado.
    for (const fix of track) {
      expect(Math.abs(fix.lat - -37.0) < 1e-9 || Math.abs(fix.lng - -72.1) < 1e-9).toBe(true);
    }
    const stopped = track.filter((f) => f.speedKmh === 0 && f !== track[0] && f !== track.at(-1));
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((f) => distanceMeters(f, site) < 1)).toBe(true);
  });
});
