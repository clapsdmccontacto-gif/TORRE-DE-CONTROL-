import { DomainError } from '../../../common/domain-error.js';
import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { RoutePlanner } from '../../routing/application/route-planner.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from '../../../../test/fixtures/demo-network.js';
import type { PositionFix } from '../domain/tracking.js';
import { TrackingHub } from './tracking-hub.js';

function setup() {
  let now = Date.parse('2026-10-02T12:00:00Z');
  let units = [...DEMO_UNITS];
  const planner = new RoutePlanner({
    depot: () => DEMO_DEPOT,
    orders: () => DEMO_ORDERS,
    fleet: DEFAULT_FLEET,
    units: () => units,
    now: () => now,
  });
  const plan = planner.optimize({
    deliveryIds: DEMO_ORDERS.map((o) => o.id),
    dieselPriceClp: 1_050,
  });
  planner.publish(plan.id);
  const hub = new TrackingHub({
    units: () => units,
    activePlan: () => planner.activePlan(),
    now: () => now,
  });
  return {
    hub,
    plan,
    setUnits: (next: typeof units) => (units = next),
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

  it('guarda el teléfono del conductor y lo muestra en la flota en vivo', () => {
    const { hub } = setup();
    const session = hub.startSession({
      driverName: '  Pedro   Muñoz ',
      driverPhone: '+56 9 1234 5678',
      vehiclePlate: 'DEMO-02',
    });
    expect(session.driverName).toBe('Pedro Muñoz');
    expect(hub.snapshot().devices[0]).toMatchObject({
      driverPhone: '+56 9 1234 5678',
      vehiclePlate: 'DEMO-02',
    });
    expect(() =>
      hub.startSession({ driverName: 'Ana', driverPhone: 'llámame', vehiclePlate: 'DEMO-01' }),
    ).toThrow(expect.objectContaining({ code: 'TELEFONO_INVALIDO' }));
  });

  it('sólo acepta camiones registrados, también los agregados después', () => {
    const { hub, setUnits } = setup();
    expect(() => hub.startSession({ driverName: 'Ana', vehiclePlate: 'ABCD12' })).toThrow(
      expect.objectContaining({ code: 'VEHICULO_DESCONOCIDO' }),
    );
    setUnits([...DEMO_UNITS, { plate: 'ABCD12', vehicle: DEFAULT_FLEET[1] }]);
    expect(hub.startSession({ driverName: 'Ana', vehiclePlate: 'ABCD12' }).stops).toEqual([]);
  });

  it('distingue una ruta terminada de una que el servidor ya no conoce (reinicio)', () => {
    const { hub, at } = setup();
    const session = hub.startSession({ driverName: 'Ana', vehiclePlate: 'DEMO-01' });
    hub.endSession(session.id);
    expect(() => hub.ingest(session.id, [fixAt(-37.46, -72.34, at(1))])).toThrow(
      expect.objectContaining({ code: 'SESION_NO_ACTIVA' }),
    );
    expect(() => hub.ingest('RUTA-perdida', [fixAt(-37.46, -72.34, at(1))])).toThrow(
      expect.objectContaining({ code: 'SESION_DESCONOCIDA' }),
    );
  });

  it('refresh avisa la foto sólo si hay rutas activas', () => {
    const { hub } = setup();
    const snapshots: number[] = [];
    hub.subscribe((s) => snapshots.push(s.devices.length));
    hub.refresh();
    expect(snapshots).toEqual([]);
    hub.startSession({ driverName: 'Ana', vehiclePlate: 'DEMO-01' });
    hub.refresh();
    expect(snapshots).toEqual([1, 1]);
  });
});
