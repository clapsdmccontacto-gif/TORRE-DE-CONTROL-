import { distanceMeters } from '../../../common/geo.js';
import {
  simulatePosition,
  simulateTrack,
  simulatedTripDurationMs,
  type SimulatedTrip,
} from './simulator.js';

const depot = { lat: -37.0, lng: -72.0 };
const obra = { lat: -37.1, lng: -72.0 }; // ~11,1 km al sur
const trip: SimulatedTrip = {
  path: [depot, obra, depot],
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
