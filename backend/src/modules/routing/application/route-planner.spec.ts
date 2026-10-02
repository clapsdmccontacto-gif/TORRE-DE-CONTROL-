import { DomainError } from '../../../common/domain-error.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../infrastructure/demo-network.js';
import { RoutePlanner } from './route-planner.js';

const planner = () =>
  new RoutePlanner({
    depot: DEMO_DEPOT,
    orders: () => DEMO_ORDERS,
    fleet: DEFAULT_FLEET,
    units: DEMO_UNITS,
  });

describe('RoutePlanner', () => {
  it('lista los pedidos con su carga y vehículos posibles', () => {
    const deliveries = planner().deliveries();
    expect(deliveries).toHaveLength(DEMO_ORDERS.length);
    expect(deliveries.find((d) => d.id === 'NV-100232')).toMatchObject({
      siteName: 'Condominio Santa Bárbara',
      allowedVehicleCodes: ['CAMION_PLUMA'],
    });
  });

  it('optimiza, publica y avisa a quien escucha', () => {
    const p = planner();
    const published: string[] = [];
    p.onPublish((plan) => published.push(plan.id));

    const plan = p.optimize({ deliveryIds: ['NV-100231', 'NV-100235'], dieselPriceClp: 1_000 });
    expect(plan.routes.flatMap((r) => r.stops)).toHaveLength(2);
    expect(p.activePlan()).toBeNull();

    p.publish(plan.id);
    expect(p.activePlan()?.id).toBe(plan.id);
    expect(p.activePlan()?.publishedAt).not.toBeNull();
    expect(published).toEqual([plan.id]);
  });

  it('rechaza pedidos o planes inexistentes', () => {
    const p = planner();
    expect(() => p.optimize({ deliveryIds: ['NV-1'], dieselPriceClp: 1_000 })).toThrow(DomainError);
    expect(() => p.optimize({ deliveryIds: [], dieselPriceClp: 1_000 })).toThrow(DomainError);
    expect(() => p.publish('PLAN-x')).toThrow(DomainError);
  });

  it('aplica la ruta por calles a una ruta del plan antes de publicar', () => {
    const p = planner();
    const plan = p.optimize({ deliveryIds: DEMO_ORDERS.map((o) => o.id), dieselPriceClp: 1_000 });
    const route = plan.routes.find((r) => r.stops.length >= 2)!;
    const n = route.stops.length;
    const adjustment = {
      stopOrder: route.stops.map((_, i) => n - 1 - i),
      legs: Array.from({ length: n + 1 }, () => ({ distanceKm: 5, durationMin: 9 })),
      path: [DEMO_DEPOT.location, route.stops[0].location, DEMO_DEPOT.location],
      trafficDelayMin: 3,
      tollKm: 0,
    };
    const adjusted = p.applyRoadAdjustment(plan.id, route.unitPlate, adjustment);
    const updated = adjusted.routes.find((r) => r.unitPlate === route.unitPlate)!;
    expect(updated.distanceKm).toBe(5 * (n + 1));
    expect(updated.stops[0].deliveryId).toBe(route.stops[n - 1].deliveryId);
    expect(updated.road).toEqual({ trafficDelayMin: 3, tollKm: 0 });
    expect(adjusted.totals.distanceKm).toBeCloseTo(
      adjusted.routes.reduce((sum, r) => sum + r.distanceKm, 0),
      1,
    );
    expect(adjusted.savings).toEqual(plan.savings);

    expect(() => p.applyRoadAdjustment(plan.id, 'NO-EXISTE', adjustment)).toThrow(
      expect.objectContaining({ code: 'RUTA_DESCONOCIDA' }),
    );
    p.publish(plan.id);
    expect(
      p.activePlan()?.routes.find((r) => r.unitPlate === route.unitPlate)?.road,
    ).not.toBeNull();
    expect(() => p.applyRoadAdjustment(plan.id, route.unitPlate, adjustment)).toThrow(
      expect.objectContaining({ code: 'PLAN_PUBLICADO' }),
    );
  });
});
