import { bearingDegrees, distanceMeters, interpolate, isValidLatLng } from './geo.js';

describe('geo', () => {
  it('mide 1° de latitud como ~111 km', () => {
    expect(distanceMeters({ lat: -37, lng: -72 }, { lat: -38, lng: -72 })).toBeCloseTo(111_195, -2);
  });

  it('calcula el rumbo hacia el norte y el este', () => {
    expect(bearingDegrees({ lat: -37.5, lng: -72.3 }, { lat: -37.4, lng: -72.3 })).toBeCloseTo(0);
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90);
  });

  it('interpola y valida coordenadas', () => {
    expect(interpolate({ lat: 0, lng: 0 }, { lat: 2, lng: 4 }, 0.5)).toEqual({ lat: 1, lng: 2 });
    expect(isValidLatLng({ lat: -37.46, lng: -72.34 })).toBe(true);
    expect(isValidLatLng({ lat: 95, lng: 0 })).toBe(false);
  });
});
