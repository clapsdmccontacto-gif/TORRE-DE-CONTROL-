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
});
