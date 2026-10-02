import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import type { RoadRouteRequest } from '../domain/road-route.js';
import { buildCalculateRouteUrl, parseCalculateRoute, TomTomRoadRouter } from './tomtom.js';

const vehicle = (code: string) => DEFAULT_FLEET.find((v) => v.code === code)!;
const depot = { lat: -37.4693, lng: -72.3527 };
const stops = [
  { lat: -37.48, lng: -72.33 },
  { lat: -37.45, lng: -72.37 },
];

const request = (overrides: Partial<RoadRouteRequest> = {}): RoadRouteRequest => ({
  points: [depot, ...stops, depot],
  vehicle: vehicle('CAMION_PLUMA'),
  loadKg: 2_000,
  optimizeOrder: true,
  avoidTolls: false,
  ...overrides,
});

const params = (url: string) => new URL(url).searchParams;

describe('buildCalculateRouteUrl', () => {
  it('pide ruta de camión con tráfico, peajes, instrucciones en español y orden óptimo', () => {
    const url = buildCalculateRouteUrl(request(), 'CLAVE');
    expect(url.startsWith('https://api.tomtom.com/routing/1/calculateRoute/')).toBe(true);
    expect(url).toContain('/-37.469300,-72.352700:-37.480000,-72.330000:');
    const p = params(url);
    expect(p.get('key')).toBe('CLAVE');
    expect(p.get('traffic')).toBe('true');
    expect(p.get('travelMode')).toBe('truck');
    expect(p.get('vehicleCommercial')).toBe('true');
    expect(Number(p.get('vehicleWeight'))).toBeGreaterThan(8_500);
    expect(p.getAll('sectionType')).toEqual(['tollRoad', 'traffic']);
    expect(p.get('language')).toBe('es-ES');
    expect(p.get('computeBestOrder')).toBe('true');
    expect(p.has('avoid')).toBe(false);
  });

  it('la camioneta va como auto y se puede evitar peajes', () => {
    const p = params(
      buildCalculateRouteUrl(
        request({ vehicle: vehicle('CAMIONETA'), avoidTolls: true, optimizeOrder: false }),
        'K',
      ),
    );
    expect(p.get('travelMode')).toBe('car');
    expect(p.has('vehicleWeight')).toBe(false);
    expect(p.get('avoid')).toBe('tollRoads');
    expect(p.has('computeBestOrder')).toBe(false);
  });

  it('no reordena con una sola parada intermedia y exige origen y destino', () => {
    const p = params(buildCalculateRouteUrl(request({ points: [depot, stops[0], depot] }), 'K'));
    expect(p.has('computeBestOrder')).toBe(false);
    expect(() => buildCalculateRouteUrl(request({ points: [depot] }), 'K')).toThrow(
      expect.objectContaining({ code: 'RUTA_INVALIDA' }),
    );
  });
});

/** Respuesta reducida con la forma de TomTom Routing v1. */
const point = (latitude: number, longitude: number) => ({ latitude, longitude });
const tomtomResponse = {
  formatVersion: '0.0.12',
  routes: [
    {
      summary: {
        lengthInMeters: 23_450,
        travelTimeInSeconds: 2_400,
        trafficDelayInSeconds: 300,
        noTrafficTravelTimeInSeconds: 2_100,
        departureTime: '2026-10-02T09:00:00-03:00',
        arrivalTime: '2026-10-02T09:40:00-03:00',
      },
      legs: [
        {
          summary: { lengthInMeters: 9_000, travelTimeInSeconds: 900 },
          points: [point(-37.4693, -72.3527), point(-37.45, -72.37)],
        },
        {
          summary: { lengthInMeters: 6_000, travelTimeInSeconds: 700 },
          points: [point(-37.45, -72.37), point(-37.46, -72.35), point(-37.48, -72.33)],
        },
        {
          summary: { lengthInMeters: 8_450, travelTimeInSeconds: 800 },
          points: [point(-37.48, -72.33), point(-37.4693, -72.3527)],
        },
      ],
      sections: [
        { startPointIndex: 0, endPointIndex: 6, sectionType: 'TRAVEL_MODE', travelMode: 'truck' },
        { startPointIndex: 2, endPointIndex: 4, sectionType: 'TOLL_ROAD' },
        {
          startPointIndex: 3,
          endPointIndex: 4,
          sectionType: 'TRAFFIC',
          simpleCategory: 'JAM',
          effectiveSpeedInKmh: 12,
          delayInSeconds: 240,
          magnitudeOfDelay: 3,
        },
        {
          startPointIndex: 5,
          endPointIndex: 99,
          sectionType: 'TRAFFIC',
          simpleCategory: 'ROAD_CLOSURE',
          magnitudeOfDelay: 4,
        },
      ],
      guidance: {
        instructions: [
          {
            routeOffsetInMeters: 0,
            point: point(-37.4693, -72.3527),
            maneuver: 'DEPART',
            message: 'Salga',
          },
          {
            routeOffsetInMeters: 1_250,
            point: point(-37.46, -72.36),
            maneuver: 'TURN_LEFT',
            street: 'Avenida Alemania',
            message: 'Gire a la izquierda hacia Avenida Alemania',
          },
        ],
      },
    },
  ],
  optimizedWaypoints: [
    { providedIndex: 0, optimizedIndex: 1 },
    { providedIndex: 1, optimizedIndex: 0 },
  ],
};

describe('parseCalculateRoute', () => {
  const route = parseCalculateRoute(tomtomResponse, request());

  it('entrega trazado continuo, tramos, tiempos con tráfico y orden de paradas', () => {
    expect(route.path).toHaveLength(7);
    expect(route.path[0]).toEqual({ lat: -37.4693, lng: -72.3527 });
    expect(route.legs).toEqual([
      { distanceKm: 9, durationMin: 15 },
      { distanceKm: 6, durationMin: 12 },
      { distanceKm: 8.5, durationMin: 13 },
    ]);
    expect(route.distanceKm).toBe(23.5);
    expect(route.durationMin).toBe(40);
    expect(route.durationNoTrafficMin).toBe(35);
    expect(route.trafficDelayMin).toBe(5);
    expect(route.arrivalAt).toBe('2026-10-02T09:40:00-03:00');
    expect(route.stopOrder).toEqual([1, 0]);
  });

  it('separa tramos con peaje, congestión e instrucciones', () => {
    expect(route.tollPaths).toEqual([route.path.slice(2, 5)]);
    expect(route.tollKm).toBeGreaterThan(0);
    expect(route.traffic).toEqual([
      {
        path: route.path.slice(3, 5),
        severity: 'ALTA',
        category: 'Congestión',
        delayMin: 4,
        speedKmh: 12,
      },
      {
        path: route.path.slice(5, 7),
        severity: 'CERRADO',
        category: 'Vía cerrada',
        delayMin: 0,
        speedKmh: null,
      },
    ]);
    expect(route.instructions[1]).toEqual({
      message: 'Gire a la izquierda hacia Avenida Alemania',
      street: 'Avenida Alemania',
      maneuver: 'TURN_LEFT',
      point: { lat: -37.46, lng: -72.36 },
      offsetKm: 1.3,
    });
  });

  it('sin reordenar mantiene el orden pedido', () => {
    const { optimizedWaypoints: _, ...plain } = tomtomResponse;
    expect(parseCalculateRoute(plain, request()).stopOrder).toEqual([0, 1]);
    expect(() => parseCalculateRoute({ routes: [] }, request())).toThrow(
      expect.objectContaining({ code: 'RUTA_NO_ENCONTRADA' }),
    );
  });
});

describe('TomTomRoadRouter', () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  it('consulta TomTom y devuelve la ruta', async () => {
    const calls: string[] = [];
    const router = new TomTomRoadRouter(' CLAVE ', async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(tomtomResponse), { status: 200 });
    });
    const route = await router.route(request());
    expect(route.distanceKm).toBe(23.5);
    expect(params(calls[0]).get('key')).toBe('CLAVE');
  });

  it.each([
    [403, { detailedError: { message: 'Forbidden' } }, 'CLAVE_MAPA_INVALIDA'],
    [429, {}, 'LIMITE_MAPAS'],
    [400, { error: { description: 'Engine error' } }, 'RUTA_NO_ENCONTRADA'],
  ])('traduce la respuesta %i a un error con código', async (status, body, code) => {
    const router = new TomTomRoadRouter('K', respond(status, body));
    await expect(router.route(request())).rejects.toMatchObject({ code });
  });

  it('avisa si falta la clave o no hay conexión', async () => {
    await expect(
      new TomTomRoadRouter('  ', respond(200, {})).route(request()),
    ).rejects.toMatchObject({ code: 'CLAVE_MAPA_FALTANTE' });
    const offline = new TomTomRoadRouter('K', () => Promise.reject(new TypeError('fetch failed')));
    await expect(offline.route(request())).rejects.toMatchObject({ code: 'SIN_CONEXION_MAPAS' });
  });
});
