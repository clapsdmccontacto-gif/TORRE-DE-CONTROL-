import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import type { PlannedRoute, PlannedStop } from '../domain/optimizer.js';
import type { RoadRoute, RoadRouteRequest } from '../domain/road-route.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../infrastructure/demo-network.js';
import { optimizeWithStreets, refineWithRoads, toRoadAdjustment } from './road-refinement.js';
import { RoutePlanner } from './route-planner.js';
import type { RoadRouter } from './road-router.port.js';

const truck = DEFAULT_FLEET.find((v) => v.code === 'CAMION_3_4')!;
const depot = { lat: -37.4693, lng: -72.3527 };

const stop = (deliveryId: string, weightKg: number, lat: number): PlannedStop => ({
  deliveryId,
  siteName: deliveryId,
  commune: 'Los Ángeles',
  location: { lat, lng: -72.35 },
  notifyEtaMinutes: 30,
  arrivalMin: 0,
  departureMin: 0,
  weightKg,
  lines: [],
});

const plan = (stops: PlannedStop[]): PlannedRoute => ({
  unitPlate: 'TC-0001',
  vehicleCode: truck.code,
  vehicleName: truck.name,
  stops,
  path: [],
  loadKg: stops.reduce((s, x) => s + x.weightKg, 0),
  weightUtilization: 0.5,
  distanceKm: 0,
  durationMin: 0,
  fuelLiters: 0,
  fuelCostClp: 0,
  co2Kg: 0,
  road: null,
});

const roadRoute = (legsKm: number[], stopOrder: number[], durationMin = 60): RoadRoute => ({
  path: [depot, depot],
  legs: legsKm.map((distanceKm) => ({ distanceKm, durationMin: 10 })),
  distanceKm: legsKm.reduce((a, b) => a + b, 0),
  durationMin,
  durationNoTrafficMin: null,
  trafficDelayMin: 0,
  departureAt: null,
  arrivalAt: null,
  traffic: [],
  tollPaths: [],
  tollKm: 0,
  instructions: [],
  stopOrder,
});

class FakeRouter implements RoadRouter {
  readonly requests: RoadRouteRequest[] = [];
  private readonly planned: RoadRoute;
  private readonly optimized: RoadRoute;

  constructor(planned: RoadRoute, optimized: RoadRoute) {
    this.planned = planned;
    this.optimized = optimized;
  }

  async route(request: RoadRouteRequest): Promise<RoadRoute> {
    this.requests.push(request);
    return request.optimizeOrder ? this.optimized : this.planned;
  }
}

describe('refineWithRoads', () => {
  const route = plan([stop('A', 300, -37.48), stop('B', 2_500, -37.45)]);

  it('se queda con el orden por calles cuando gasta menos diésel', async () => {
    // Mismos km, pero el reordenado entrega primero lo pesado.
    const router = new FakeRouter(roadRoute([8, 6, 8], [0, 1]), roadRoute([8, 6, 8], [1, 0]));
    const refined = await refineWithRoads(route, depot, truck, router, 1_000);
    expect(router.requests.map((r) => r.optimizeOrder)).toEqual([false, true]);
    expect(router.requests[0].points).toEqual([
      depot,
      route.stops[0].location,
      route.stops[1].location,
      depot,
    ]);
    expect(router.requests[0].loadKg).toBe(2_800);
    expect(refined.stopOrder).toEqual([1, 0]);
    expect(refined.reordered).toBe(true);
    expect(refined.fuelCostClp).toBe(Math.round(refined.fuelLiters * 1_000));
    expect(refined.co2Kg).toBeCloseTo(refined.fuelLiters * 2.68, 1);
  });

  it('mantiene el orden del plan si reordenar no ahorra', async () => {
    const router = new FakeRouter(roadRoute([8, 6, 8], [0, 1]), roadRoute([9, 9, 9], [1, 0]));
    const refined = await refineWithRoads(route, depot, truck, router, 1_000);
    expect(refined.reordered).toBe(false);
    expect(refined.roadRoute.distanceKm).toBe(22);
  });

  it('con una sola parada consulta una vez', async () => {
    const router = new FakeRouter(roadRoute([8, 8], [0]), roadRoute([1, 1], [0]));
    const refined = await refineWithRoads(
      plan([stop('A', 300, -37.48)]),
      depot,
      truck,
      router,
      1_000,
    );
    expect(router.requests).toHaveLength(1);
    expect(refined.roadRoute.distanceKm).toBe(16);
  });
});

it('toRoadAdjustment reduce el trazado para guardarlo en el plan', async () => {
  const long = {
    ...roadRoute([8, 8], [0]),
    path: Array.from({ length: 3_000 }, (_, i) => ({ lat: -37.4 - i * 1e-5, lng: -72.3 })),
  };
  const router = new FakeRouter(long, long);
  const refined = await refineWithRoads(
    plan([stop('A', 300, -37.48)]),
    depot,
    truck,
    router,
    1_000,
  );
  const adjustment = toRoadAdjustment(refined);
  expect(adjustment.path).toHaveLength(800);
  expect(adjustment.path[0]).toEqual(long.path[0]);
  expect(adjustment.legs).toBe(long.legs);
  expect(adjustment.stopOrder).toEqual([0]);
});

it('optimizeWithStreets deja todas las rutas del plan por calles, una consulta por ruta', async () => {
  const planner = new RoutePlanner({
    depot: DEMO_DEPOT,
    orders: () => DEMO_ORDERS,
    fleet: DEFAULT_FLEET,
    units: DEMO_UNITS,
  });
  const requests: RoadRouteRequest[] = [];
  const router: RoadRouter = {
    route: async (request) => {
      requests.push(request);
      const stops = request.points.length - 2;
      return {
        ...roadRoute(
          Array.from({ length: stops + 1 }, () => 5),
          Array.from({ length: stops }, (_, i) => i),
        ),
        path: request.points,
      };
    },
  };
  const plan = await optimizeWithStreets(
    planner,
    { deliveryIds: DEMO_ORDERS.map((o) => o.id), dieselPriceClp: 1_000 },
    router,
  );
  expect(requests).toHaveLength(plan.routes.length);
  expect(requests.every((r) => !r.optimizeOrder)).toBe(true);
  expect(plan.publishedAt).toBeNull();
  expect(plan.routes.every((r) => r.road !== null)).toBe(true);
  expect(plan.routes[0].distanceKm).toBe(5 * (plan.routes[0].stops.length + 1));
});
