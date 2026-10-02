import { DomainError } from '../../../common/domain-error.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { RoutePlanner } from '../../routing/application/route-planner.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../../routing/infrastructure/demo-network.js';
import type { PositionFix } from '../domain/tracking.js';
import { TrackingHub } from './tracking-hub.js';

function setup() {
  let now = Date.parse('2026-10-02T12:00:00Z');
  const planner = new RoutePlanner({
    depot: DEMO_DEPOT,
    orders: () => DEMO_ORDERS,
    fleet: DEFAULT_FLEET,
    units: DEMO_UNITS,
    now: () => now,
  });
  const plan = planner.optimize({
    deliveryIds: DEMO_ORDERS.map((o) => o.id),
    dieselPriceClp: 1_050,
  });
  planner.publish(plan.id);
  const hub = new TrackingHub({
    units: DEMO_UNITS,
    activePlan: () => planner.activePlan(),
    now: () => now,
  });
  return {
    hub,
    plan,
    advance: (ms: number) => (now += ms),
    at: (offsetSec: number) => new Date(now + offsetSec * 1000).toISOString(),
  };
}

const fixAt = (lat: number, lng: number, recordedAt: string): PositionFix => ({
  lat,
  lng,
  accuracyM: 12,
  speedKmh: null,
  headingDeg: null,
  recordedAt,
});

describe('TrackingHub', () => {
  it('toma la ruta del plan publicado y avanza las paradas con el GPS del teléfono', () => {
    const { hub, plan, at } = setup();
    const route = plan.routes.find((r) => r.unitPlate === 'DEMO-03')!;
    const first = route.stops[0];

    const session = hub.startSession({ driverName: 'Juan Pérez', vehiclePlate: 'DEMO-03' });
    expect(session.stops.map((s) => s.deliveryId)).toEqual(route.stops.map((s) => s.deliveryId));

    const result = hub.ingest(session.id, [
      fixAt(DEMO_DEPOT.location.lat, DEMO_DEPOT.location.lng, at(-300)),
      fixAt(first.location.lat + 0.0005, first.location.lng, at(-60)),
      fixAt(first.location.lat + 0.0005, first.location.lng, at(-10)),
      fixAt(Number.NaN, 0, at(-5)),
    ]);
    expect(result).toMatchObject({ accepted: 3, rejected: [{ reason: 'COORDENADA_INVALIDA' }] });

    const device = hub.snapshot().devices.find((d) => d.sessionId === session.id)!;
    expect(device).toMatchObject({
      driverName: 'Juan Pérez',
      simulated: false,
      status: 'DETENIDO',
    });
    expect(device.stops[0].state).toBe('EN_OBRA');
    expect(device.cargo.length).toBeGreaterThan(0);
    expect(hub.snapshot().events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['INICIO_RUTA', 'LLEGADA_OBRA']),
    );
    expect(hub.track(session.id).fixes).toHaveLength(3);
  });

  it('marca "sin señal" cuando el teléfono deja de reportar', () => {
    const { hub, at, advance } = setup();
    const session = hub.startSession({ driverName: 'Ana Soto', vehiclePlate: 'DEMO-01' });
    hub.ingest(session.id, [fixAt(-37.46, -72.34, at(0))]);
    advance(5 * 60_000);
    expect(hub.snapshot().devices[0].status).toBe('SIN_SENAL');
  });

  it('reemplaza la sesión anterior del mismo vehículo y cierra rutas', () => {
    const { hub } = setup();
    const first = hub.startSession({ driverName: 'Ana Soto', vehiclePlate: 'DEMO-01' });
    const second = hub.startSession({ driverName: 'Luis Rojas', vehiclePlate: 'DEMO-01' });
    expect(hub.snapshot().devices.map((d) => d.sessionId)).toEqual([second.id]);
    expect(() => hub.ingest(first.id, [])).toThrow(DomainError);

    hub.endSession(second.id);
    expect(hub.snapshot().devices).toEqual([]);
  });

  it('valida conductor y vehículo', () => {
    const { hub } = setup();
    expect(() => hub.startSession({ driverName: ' ', vehiclePlate: 'DEMO-01' })).toThrow(
      DomainError,
    );
    expect(() => hub.startSession({ driverName: 'Ana', vehiclePlate: 'XX-99' })).toThrow(
      DomainError,
    );
  });

  it('simula un camión por ruta del plan y los hace avanzar', () => {
    const { hub, plan, advance } = setup();
    const updates: number[] = [];
    hub.subscribe((s) => updates.push(s.devices.length));

    hub.startSimulation(plan);
    const before = hub.snapshot().devices;
    expect(before).toHaveLength(plan.routes.length);
    expect(before.every((d) => d.simulated && d.position !== null)).toBe(true);

    advance(60_000);
    hub.tick();
    const after = hub.snapshot().devices;
    const moved = after.filter((d, i) => d.position!.recordedAt !== before[i].position!.recordedAt);
    expect(moved.length).toBe(plan.routes.length);
    expect(updates.at(-1)).toBe(plan.routes.length);
  });

  it('un conductor real desplaza al camión simulado de su vehículo', () => {
    const { hub, plan } = setup();
    hub.startSimulation(plan);
    const plate = plan.routes[0].unitPlate;
    hub.startSession({ driverName: 'Pedro Muñoz', vehiclePlate: plate });
    const devices = hub.snapshot().devices.filter((d) => d.vehiclePlate === plate);
    expect(devices).toHaveLength(1);
    expect(devices[0].simulated).toBe(false);
  });
});
