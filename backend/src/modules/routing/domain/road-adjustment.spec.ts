import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../infrastructure/demo-network.js';
import { toDeliveryRequest } from './delivery.js';
import { DEFAULT_ROUTING_OPTIONS, optimizeRoutes, planTotals } from './optimizer.js';
import { applyRoadAdjustment, type RoadAdjustment } from './road-adjustment.js';
import { roadRouteFuelLiters } from './road-route.js';

const result = optimizeRoutes(
  DEMO_ORDERS.map((o) => toDeliveryRequest(o, DEFAULT_FLEET)),
  DEMO_UNITS,
  { ...DEFAULT_ROUTING_OPTIONS, depot: DEMO_DEPOT.location },
);
const route = result.routes.find((r) => r.stops.length >= 3)!;
const vehicle = DEMO_UNITS.find((u) => u.plate === route.unitPlate)!.vehicle;
const n = route.stops.length;
const reversed = route.stops.map((_, i) => n - 1 - i);

const adjustment = (overrides: Partial<RoadAdjustment> = {}): RoadAdjustment => ({
  stopOrder: reversed,
  legs: Array.from({ length: n + 1 }, (_, i) => ({ distanceKm: 4 + i, durationMin: 10 })),
  path: [DEMO_DEPOT.location, route.stops[0].location, DEMO_DEPOT.location],
  trafficDelayMin: 7,
  tollKm: 0,
  ...overrides,
});

describe('applyRoadAdjustment', () => {
  it('reordena paradas y recalcula horarios, km y diésel con los tramos por calles', () => {
    const adjusted = applyRoadAdjustment(route, adjustment(), vehicle, 1_000);
    expect(adjusted.stops.map((s) => s.deliveryId)).toEqual(
      reversed.map((i) => route.stops[i].deliveryId),
    );
    const first = route.stops[n - 1];
    expect(adjusted.stops[0].arrivalMin).toBe(10);
    expect(adjusted.stops[0].departureMin).toBe(10 + first.departureMin - first.arrivalMin);
    const service = route.stops.reduce((sum, s) => sum + s.departureMin - s.arrivalMin, 0);
    expect(adjusted.durationMin).toBe((n + 1) * 10 + service);
    expect(adjusted.distanceKm).toBe(
      Array.from({ length: n + 1 }, (_, i) => 4 + i).reduce((a, b) => a + b, 0),
    );
    expect(adjusted.fuelLiters).toBe(
      roadRouteFuelLiters(
        adjustment(),
        vehicle,
        adjusted.stops.map((s) => s.weightKg),
      ),
    );
    expect(adjusted.fuelCostClp).toBe(Math.round(adjusted.fuelLiters * 1_000));
    expect(adjusted.road).toEqual({ trafficDelayMin: 7, tollKm: 0 });
    expect(adjusted.path).toHaveLength(3);
    // El resto de la ruta no cambia.
    expect(adjusted.loadKg).toBe(route.loadKg);
    expect(route.road).toBeNull();
  });

  it('rechaza órdenes o tramos que no corresponden a la ruta', () => {
    const invalid = [
      adjustment({ stopOrder: [0, 0, ...reversed.slice(2)] }),
      adjustment({ stopOrder: reversed.slice(1) }),
      adjustment({ stopOrder: [...reversed.slice(1), n] }),
      adjustment({ legs: adjustment().legs.slice(1) }),
      adjustment({ path: [] }),
    ];
    for (const a of invalid) {
      expect(() => applyRoadAdjustment(route, a, vehicle, 1_000)).toThrow(
        expect.objectContaining({ code: 'AJUSTE_INVALIDO' }),
      );
    }
  });
});

it('planTotals suma las rutas del plan', () => {
  expect(planTotals(result.routes)).toEqual(result.totals);
});
