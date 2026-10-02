import { distanceMeters } from '../../../common/geo.js';
import { maxPayloadKg, tareKg } from '../../load-planning/domain/vehicle.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { legLiters } from './fuel.js';
import {
  clusterPoints,
  navigationLinks,
  pathKm,
  remainingPath,
  roadRouteFuelLiters,
  samplePath,
  truckProfile,
} from './road-route.js';

const vehicle = (code: string) => DEFAULT_FLEET.find((v) => v.code === code)!;

describe('truckProfile', () => {
  it('rutea la camioneta como auto y los camiones con restricciones de camión', () => {
    expect(truckProfile(vehicle('CAMIONETA'), 500).travelMode).toBe('car');
    expect(truckProfile(vehicle('CAMION_3_4'), 500).travelMode).toBe('truck');
    expect(truckProfile(vehicle('CAMION_PLUMA'), 500).travelMode).toBe('truck');
  });

  it('informa el peso bruto con la carga, sin pasar la carga útil máxima', () => {
    const pluma = vehicle('CAMION_PLUMA');
    expect(truckProfile(pluma, 3_000).grossWeightKg).toBe(Math.round(tareKg(pluma) + 3_000));
    expect(truckProfile(pluma, 999_999).grossWeightKg).toBe(
      Math.round(tareKg(pluma) + maxPayloadKg(pluma)),
    );
    expect(truckProfile(pluma, -10).grossWeightKg).toBe(Math.round(tareKg(pluma)));
  });
});

describe('roadRouteFuelLiters', () => {
  const truck = vehicle('CAMION_3_4');
  const legs = [
    { distanceKm: 10, durationMin: 15 },
    { distanceKm: 5, durationMin: 8 },
    { distanceKm: 12, durationMin: 18 },
  ];

  it('calcula cada tramo con la carga que va a bordo', () => {
    const payload = maxPayloadKg(truck);
    const expected =
      legLiters(10, truck.fuel, 3_000, payload) +
      legLiters(5, truck.fuel, 1_000, payload) +
      legLiters(12, truck.fuel, 0, payload);
    expect(roadRouteFuelLiters({ legs }, truck, [2_000, 1_000])).toBeCloseTo(expected, 1);
  });

  it('entregar primero lo más pesado gasta menos', () => {
    expect(roadRouteFuelLiters({ legs }, truck, [2_500, 200])).toBeLessThan(
      roadRouteFuelLiters({ legs }, truck, [200, 2_500]),
    );
  });
});

describe('utilidades de trazado', () => {
  const line = Array.from({ length: 500 }, (_, i) => ({ lat: -37.47 + i * 0.0001, lng: -72.35 }));

  it('samplePath conserva origen y destino y respeta el máximo', () => {
    const sample = samplePath(line, 80);
    expect(sample).toHaveLength(80);
    expect(sample[0]).toEqual(line[0]);
    expect(sample.at(-1)).toEqual(line.at(-1));
    expect(samplePath(line.slice(0, 10), 80)).toHaveLength(10);
  });

  it('pathKm suma los tramos', () => {
    expect(pathKm(line)).toBeCloseTo(distanceMeters(line[0], line.at(-1)!) / 1000, 2);
    expect(pathKm([])).toBe(0);
  });

  it('clusterPoints junta los semáforos de una misma esquina', () => {
    const corner = { lat: -37.4693, lng: -72.3527 };
    const points = [
      corner,
      { lat: corner.lat + 0.0001, lng: corner.lng },
      { lat: corner.lat, lng: corner.lng + 0.0002 },
      { lat: -37.48, lng: -72.36 },
    ];
    const clusters = clusterPoints(points, 40);
    expect(clusters).toHaveLength(2);
    expect(distanceMeters(clusters[0], corner)).toBeLessThan(20);
  });
});

it('navigationLinks arma enlaces de Waze y Google Maps al destino', () => {
  const links = navigationLinks({ lat: -37.4693, lng: -72.3527 });
  expect(links.waze).toBe('https://waze.com/ul?ll=-37.469300,-72.352700&navigate=yes');
  expect(links.googleMaps).toContain('destination=-37.469300,-72.352700');
});

it('remainingPath parte en la posición actual y sigue desde el punto más cercano', () => {
  const path = [
    { lat: -37.0, lng: -72.0 },
    { lat: -37.0, lng: -72.1 },
    { lat: -37.1, lng: -72.1 },
    { lat: -37.1, lng: -72.2 },
  ];
  const position = { lat: -37.001, lng: -72.098 };
  expect(remainingPath(path, position)).toEqual([position, path[2], path[3]]);
  expect(remainingPath([], position)).toEqual([]);
});
