import { maxPayloadKg } from '../../load-planning/domain/vehicle.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../../../../test/fixtures/demo-network.js';
import { toDeliveryRequest, type DeliveryRequest } from './delivery.js';
import { DEFAULT_ROUTING_OPTIONS, optimizeRoutes, type RoutingOptions } from './optimizer.js';

const options: RoutingOptions = { ...DEFAULT_ROUTING_OPTIONS, depot: DEMO_DEPOT.location };
const requests = DEMO_ORDERS.map((o) => toDeliveryRequest(o, DEFAULT_FLEET));

describe('optimizeRoutes con la red de prueba', () => {
  const result = optimizeRoutes(requests, DEMO_UNITS, options);

  it('asigna todas las entregas respetando vehículo permitido y capacidad', () => {
    expect(result.unassigned).toEqual([]);
    expect(
      result.routes
        .flatMap((r) => r.stops)
        .map((s) => s.deliveryId)
        .sort(),
    ).toEqual(requests.map((r) => r.id).sort());
    for (const route of result.routes) {
      const unit = DEMO_UNITS.find((u) => u.plate === route.unitPlate)!;
      expect(route.loadKg).toBeLessThanOrEqual(maxPayloadKg(unit.vehicle));
      for (const stop of route.stops) {
        const request = requests.find((r) => r.id === stop.deliveryId)!;
        expect(request.allowedVehicleCodes).toContain(route.vehicleCode);
      }
    }
    // Los fierros de 6 m sólo caben en el camión pluma.
    const pluma = result.routes.find((r) => r.vehicleCode === 'CAMION_PLUMA')!;
    expect(pluma.stops.map((s) => s.deliveryId)).toEqual(
      expect.arrayContaining(['NV-100232', 'NV-100239']),
    );
  });

  it('consume menos diésel que el despacho manual en orden de llegada', () => {
    expect(result.baseline.unassigned).toBe(0);
    expect(result.totals.fuelLiters).toBeLessThan(result.baseline.fuelLiters);
    expect(result.savings.pct).toBeGreaterThan(0.05);
    expect(result.savings.fuelCostClp).toBe(
      result.baseline.fuelCostClp - result.totals.fuelCostClp,
    );
  });

  it('es determinista y calcula horarios crecientes', () => {
    expect(optimizeRoutes(requests, DEMO_UNITS, options)).toEqual(result);
    for (const route of result.routes) {
      const times = route.stops.flatMap((s) => [s.arrivalMin, s.departureMin]);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(route.path).toHaveLength(route.stops.length + 2);
    }
  });
});

describe('optimizeRoutes en casos chicos', () => {
  const truck = DEMO_UNITS.find((u) => u.vehicle.code === 'CAMION_3_4')!;
  const depot = { lat: -37.0, lng: -72.0 };
  const delivery = (id: string, lat: number, lng: number, weightKg: number): DeliveryRequest => ({
    id,
    site: {
      id,
      name: id,
      commune: 'X',
      location: { lat, lng },
      hasUnloadingEquipment: false,
      notifyEtaMinutes: 15,
    },
    lines: [],
    weightKg,
    volumeM3: 1,
    allowedVehicleCodes: ['CAMION_3_4'],
    serviceMinutes: 20,
  });

  it('descarga primero lo pesado cuando la distancia es la misma en ambos sentidos', () => {
    const result = optimizeRoutes(
      [delivery('LIVIANO', -37.0, -72.1, 50), delivery('PESADO', -37.1, -72.0, 3_000)],
      [truck],
      { ...options, depot },
    );
    expect(result.routes[0].stops.map((s) => s.deliveryId)).toEqual(['PESADO', 'LIVIANO']);
  });

  it('informa lo que no cabe en la flota disponible', () => {
    const result = optimizeRoutes(
      [delivery('A', -37.05, -72.0, 3_000), delivery('B', -37.06, -72.0, 3_000)],
      [truck],
      { ...options, depot },
    );
    expect(result.routes[0].stops).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].reason).toMatch(/segundo viaje/);
  });
});
