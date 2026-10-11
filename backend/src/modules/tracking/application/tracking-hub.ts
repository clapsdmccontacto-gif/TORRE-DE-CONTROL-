import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { newId } from '../../../common/ids.js';
import { roundTo } from '../../../common/math.js';
import { WriteQueue, type RecordStore } from '../../../common/record-store.js';
import type { FleetUnit, PlannedRoute } from '../../routing/domain/optimizer.js';
import type { RoutePlan } from '../../routing/application/route-planner.js';
import {
  DEFAULT_TRACKING_POLICY,
  completeStop,
  deviceStatus,
  effectiveSpeedKmh,
  evaluateFix,
  nextStopEta,
  progressStops,
  summarizeTrack,
  type DeviceStatus,
  type FixRejection,
  type PositionFix,
  type StopState,
  type TrackedStop,
  type TrackingEventType,
  type TrackingPolicy,
} from '../domain/tracking.js';

export interface CargoLine {
  sku: string;
  name: string;
  quantity: number;
}

export interface DriverSessionInput {
  driverName: string;
  /** Opcional: para que la torre pueda llamar al conductor. */
  driverPhone?: string | null;
  vehiclePlate: string;
}

export interface DriverSession {
  id: string;
  driverName: string;
  driverPhone: string | null;
  vehiclePlate: string;
  vehicleName: string;
  startedAt: string;
  endedAt: string | null;
  /** Paradas de su ruta en el plan publicado (vacío si no tiene ruta asignada). */
  stops: LiveStop[];
}

export interface LiveStop {
  deliveryId: string;
  siteName: string;
  location: LatLng;
  state: StopState;
  cargo: CargoLine[];
  weightKg: number;
}

export interface LiveDevice {
  sessionId: string;
  driverName: string;
  driverPhone: string | null;
  vehiclePlate: string;
  vehicleName: string;
  status: DeviceStatus;
  position: PositionFix | null;
  speedKmh: number | null;
  /** Lo que todavía va a bordo (paradas no completadas). */
  cargo: CargoLine[];
  cargoWeightKg: number;
  stops: LiveStop[];
  nextStop: { siteName: string; etaMin: number | null } | null;
  distanceKm: number;
  startedAt: string;
}

export interface TrackingEvent {
  id: string;
  at: string;
  sessionId: string;
  vehiclePlate: string;
  type: TrackingEventType | 'INICIO_RUTA' | 'FIN_RUTA' | 'RUTA_ASIGNADA';
  siteName: string | null;
  message: string;
}

export interface FleetSnapshot {
  generatedAt: string;
  devices: LiveDevice[];
  events: TrackingEvent[];
}

export interface IngestResult {
  accepted: number;
  rejected: { recordedAt: string; reason: FixRejection }[];
}

export interface TrackingHubDeps {
  /** Camiones registrados por la empresa. */
  units: () => readonly FleetUnit[];
  activePlan: () => RoutePlan | null;
  /** Dónde se guardan las rutas y su avance para retomarlas tras un reinicio del servidor. */
  store?: RecordStore;
  now?: () => number;
  policy?: TrackingPolicy;
}

type StopCargo = { cargo: CargoLine[]; weightKg: number };

interface SessionState {
  session: DriverSession;
  stops: TrackedStop[];
  stopCargo: Map<string, StopCargo>;
  fixes: PositionFix[];
  speedKmh: number | null;
  nextStopEtaMin: number | null;
  /** Último guardado (las lecturas GPS se guardan cada cierto tiempo, no una por una). */
  savedAt: number;
  dirty: boolean;
}

/** Lo que se guarda de cada ruta (la ETA se recalcula al cargar). */
interface StoredSession {
  session: DriverSession;
  stops: TrackedStop[];
  stopCargo: [string, StopCargo][];
  fixes: PositionFix[];
  speedKmh: number | null;
}

const MAX_TRACK_POINTS = 5_000;
const MAX_STORED_POINTS = 1_000;
const MAX_EVENTS = 200;
const SNAPSHOT_EVENTS = 30;
/** Las lecturas GPS sin cambios de parada se guardan a lo más cada 15 s por ruta. */
const SAVE_EVERY_MS = 15_000;
/** Una ruta sin lecturas por 12 h se cierra sola (el teléfono se apagó sin terminarla). */
const STALE_AFTER_MS = 12 * 3_600_000;
/** Las rutas terminadas se conservan 2 días (trayecto en el mapa) y después se borran. */
const KEEP_ENDED_MS = 48 * 3_600_000;
const SESSIONS = 'driver-sessions';
const TRACKING = 'tracking';
const EVENTS = 'events';

/**
 * Caso de uso "rastrear la flota": sesiones de conductores, lecturas GPS, avance de
 * paradas y eventos (aviso al capataz, llegada, entrega). Sin dependencias de framework,
 * de modo que lo usan el backend y el modo local del frontend. Con `store`, las rutas y su
 * avance sobreviven a un reinicio: el teléfono sigue enviando a la misma ruta.
 */
export class TrackingHub {
  /** Rutas guardadas ya cargadas. */
  readonly ready: Promise<void>;
  private readonly deps: TrackingHubDeps;
  private readonly policy: TrackingPolicy;
  private readonly sessions = new Map<string, SessionState>();
  private events: TrackingEvent[] = [];
  private readonly listeners = new Set<(snapshot: FleetSnapshot) => void>();
  private readonly writes = new WriteQueue();

  constructor(deps: TrackingHubDeps) {
    this.deps = deps;
    this.policy = deps.policy ?? DEFAULT_TRACKING_POLICY;
    this.ready = this.restore();
  }

  /** Guarda lo pendiente (lecturas GPS acumuladas) y espera a que termine. */
  flush(): Promise<void> {
    for (const state of this.sessions.values()) {
      if (state.dirty) this.saveSession(state);
    }
    return this.writes.flush();
  }

  /** Inicia la ruta de un conductor. Reemplaza otra sesión activa del mismo vehículo. */
  startSession(input: DriverSessionInput): DriverSession {
    const driverName = input.driverName.trim().replace(/\s+/g, ' ');
    if (driverName.length < 2) {
      throw new DomainError('CONDUCTOR_INVALIDO', 'Ingrese el nombre del conductor.');
    }
    const driverPhone = input.driverPhone?.trim() || null;
    if (driverPhone && !/^\+?[\d\s-]{8,20}$/.test(driverPhone)) {
      throw new DomainError(
        'TELEFONO_INVALIDO',
        'Ingrese el teléfono con sólo números (ej. +56 9 1234 5678).',
      );
    }
    const unit = this.unit(input.vehiclePlate);
    for (const state of this.sessions.values()) {
      if (state.session.vehiclePlate === unit.plate && !state.session.endedAt) {
        this.end(state, 'Otro dispositivo tomó el vehículo.');
        this.saveSession(state);
      }
    }
    this.pruneEnded();
    const route = this.deps.activePlan()?.routes.find((r) => r.unitPlate === unit.plate) ?? null;
    const state = this.createState(driverName, driverPhone, unit, route);
    this.saveSession(state);
    this.notify();
    return state.session;
  }

  endSession(sessionId: string): DriverSession {
    const state = this.activeState(sessionId);
    this.end(state, null);
    this.saveSession(state);
    this.notify();
    return state.session;
  }

  /** Recibe lecturas del teléfono (en lote: el teléfono las acumula si pierde señal). */
  ingest(sessionId: string, fixes: readonly PositionFix[]): IngestResult {
    const state = this.activeState(sessionId);
    const before = state.stops.map((s) => s.state).join();
    const result = this.apply(state, fixes);
    const stopsChanged = state.stops.map((s) => s.state).join() !== before;
    if (result.accepted > 0) state.dirty = true;
    if (stopsChanged || (state.dirty && this.now() - state.savedAt >= SAVE_EVERY_MS)) {
      this.saveSession(state);
    }
    this.notify();
    return result;
  }

  /** El conductor registró la entrega del pedido en la obra. */
  completeStop(sessionId: string, deliveryId: string): DriverSession {
    const state = this.activeState(sessionId);
    const { stops, event } = completeStop(state.stops, deliveryId);
    state.stops = stops;
    if (event) {
      const message = `${state.session.driverName} registró la entrega en ${event.siteName} (${state.session.vehiclePlate}).`;
      this.record(state, event.type, event.siteName, message, new Date(this.now()).toISOString());
    }
    state.nextStopEtaMin = nextStopEta(
      state.stops,
      state.fixes.at(-1) ?? null,
      state.speedKmh,
      this.policy,
    );
    state.session.stops = this.liveStops(state);
    this.saveSession(state);
    this.notify();
    return state.session;
  }

  /**
   * Se publicó un plan: las rutas en curso reciben sus paradas (sin perder lo ya entregado),
   * así el conductor que inició antes de la publicación las ve sin reiniciar.
   */
  planPublished(plan: RoutePlan): void {
    let changed = false;
    for (const state of this.sessions.values()) {
      if (state.session.endedAt) continue;
      const route = plan.routes.find((r) => r.unitPlate === state.session.vehiclePlate) ?? null;
      const previous = new Map(state.stops.map((s) => [s.deliveryId, s]));
      const planned = (route?.stops ?? []).map(
        (s): TrackedStop => ({
          deliveryId: s.deliveryId,
          siteName: s.siteName,
          location: s.location,
          notifyEtaMinutes: s.notifyEtaMinutes,
          state: previous.get(s.deliveryId)?.state ?? 'PENDIENTE',
          proximityNotified: previous.get(s.deliveryId)?.proximityNotified ?? false,
        }),
      );
      const plannedIds = new Set(planned.map((s) => s.deliveryId));
      const delivered = state.stops.filter(
        (s) => s.state === 'COMPLETADA' && !plannedIds.has(s.deliveryId),
      );
      const stops = [...delivered, ...planned];
      if (JSON.stringify(stops) === JSON.stringify(state.stops)) continue;
      state.stops = stops;
      for (const s of route?.stops ?? []) {
        state.stopCargo.set(s.deliveryId, { cargo: s.lines, weightKg: s.weightKg });
      }
      state.nextStopEtaMin = nextStopEta(
        stops,
        state.fixes.at(-1) ?? null,
        state.speedKmh,
        this.policy,
      );
      state.session.stops = this.liveStops(state);
      const pending = planned.filter((s) => s.state !== 'COMPLETADA').length;
      this.record(
        state,
        'RUTA_ASIGNADA',
        null,
        `${state.session.vehiclePlate} recibió su ruta: ${pending} ${pending === 1 ? 'parada pendiente' : 'paradas pendientes'}.`,
        new Date(this.now()).toISOString(),
      );
      this.saveSession(state);
      changed = true;
    }
    if (changed) this.notify();
  }

  track(sessionId: string): { fixes: PositionFix[]; summary: ReturnType<typeof summarizeTrack> } {
    const state = this.sessions.get(sessionId);
    if (!state) throw unknownSession();
    return { fixes: [...state.fixes], summary: summarizeTrack(state.fixes) };
  }

  snapshot(): FleetSnapshot {
    const now = this.now();
    const devices = [...this.sessions.values()]
      .filter((s) => !s.session.endedAt)
      .map((s) => this.describe(s, now))
      .sort((a, b) => a.vehiclePlate.localeCompare(b.vehiclePlate));
    return {
      generatedAt: new Date(now).toISOString(),
      devices,
      events: this.events.slice(-SNAPSHOT_EVENTS).reverse(),
    };
  }

  /** Vuelve a avisar la foto de la flota (p. ej. para pasar a "sin señal" a quien dejó de reportar). */
  refresh(): void {
    if ([...this.sessions.values()].some((s) => !s.session.endedAt)) this.notify();
  }

  subscribe(listener: (snapshot: FleetSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private createState(
    driverName: string,
    driverPhone: string | null,
    unit: FleetUnit,
    route: PlannedRoute | null,
  ): SessionState {
    const stops: TrackedStop[] = (route?.stops ?? []).map((s) => ({
      deliveryId: s.deliveryId,
      siteName: s.siteName,
      location: s.location,
      notifyEtaMinutes: s.notifyEtaMinutes,
      state: 'PENDIENTE',
      proximityNotified: false,
    }));
    const stopCargo = new Map(
      (route?.stops ?? []).map((s) => [s.deliveryId, { cargo: s.lines, weightKg: s.weightKg }]),
    );
    const session: DriverSession = {
      id: newId('RUTA'),
      driverName,
      driverPhone,
      vehiclePlate: unit.plate,
      vehicleName: unit.vehicle.name,
      startedAt: new Date(this.now()).toISOString(),
      endedAt: null,
      stops: [],
    };
    const state: SessionState = {
      session,
      stops,
      stopCargo,
      fixes: [],
      speedKmh: null,
      nextStopEtaMin: null,
      savedAt: 0,
      dirty: false,
    };
    session.stops = this.liveStops(state);
    this.sessions.set(session.id, state);
    this.record(
      state,
      'INICIO_RUTA',
      null,
      `${driverName} inició ruta con ${unit.plate} (${stops.length} ${stops.length === 1 ? 'parada' : 'paradas'}).`,
      session.startedAt,
    );
    return state;
  }

  private apply(state: SessionState, fixes: readonly PositionFix[]): IngestResult {
    const result: IngestResult = { accepted: 0, rejected: [] };
    const ordered = [...fixes].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    for (const fix of ordered) {
      const previous = state.fixes.at(-1) ?? null;
      const evaluation = evaluateFix(previous, fix, this.policy);
      if (!evaluation.accepted) {
        result.rejected.push({ recordedAt: fix.recordedAt, reason: evaluation.reason });
        continue;
      }
      state.speedKmh = effectiveSpeedKmh(previous, fix);
      state.fixes.push(fix);
      result.accepted++;

      const progress = progressStops(state.stops, fix, state.speedKmh, this.policy);
      state.stops = progress.stops;
      state.nextStopEtaMin = progress.nextStopEtaMin;
      for (const event of progress.events) {
        const plate = state.session.vehiclePlate;
        const message =
          event.type === 'AVISO_PROXIMIDAD'
            ? `${plate} a ~${Math.round(event.etaMinutes ?? 0)} min de ${event.siteName}: avisar al capataz.`
            : event.type === 'LLEGADA_OBRA'
              ? `${plate} llegó a ${event.siteName}.`
              : `${plate} salió de ${event.siteName} sin registrar la entrega.`;
        this.record(state, event.type, event.siteName, message, fix.recordedAt);
      }
    }
    if (state.fixes.length > MAX_TRACK_POINTS)
      state.fixes.splice(0, state.fixes.length - MAX_TRACK_POINTS);
    state.session.stops = this.liveStops(state);
    return result;
  }

  private describe(state: SessionState, now: number): LiveDevice {
    const position = state.fixes.at(-1) ?? null;
    const stops = this.liveStops(state);
    const remaining = stops.filter((s) => s.state !== 'COMPLETADA');
    const next = remaining[0] ?? null;
    return {
      sessionId: state.session.id,
      driverName: state.session.driverName,
      driverPhone: state.session.driverPhone,
      vehiclePlate: state.session.vehiclePlate,
      vehicleName: state.session.vehicleName,
      status: deviceStatus(position, state.speedKmh, now, this.policy),
      position,
      speedKmh: state.speedKmh === null ? null : roundTo(state.speedKmh, 0),
      cargo: mergeCargo(remaining.flatMap((s) => s.cargo)),
      cargoWeightKg: roundTo(
        remaining.reduce((sum, s) => sum + s.weightKg, 0),
        1,
      ),
      stops,
      nextStop: next
        ? {
            siteName: next.siteName,
            etaMin: state.nextStopEtaMin === null ? null : Math.round(state.nextStopEtaMin),
          }
        : null,
      distanceKm: roundTo(summarizeTrack(state.fixes).distanceKm, 1),
      startedAt: state.session.startedAt,
    };
  }

  private liveStops(state: SessionState): LiveStop[] {
    return state.stops.map((s) => ({
      deliveryId: s.deliveryId,
      siteName: s.siteName,
      location: s.location,
      state: s.state,
      cargo: state.stopCargo.get(s.deliveryId)?.cargo ?? [],
      weightKg: state.stopCargo.get(s.deliveryId)?.weightKg ?? 0,
    }));
  }

  private end(state: SessionState, reason: string | null): void {
    state.session.endedAt = new Date(this.now()).toISOString();
    const message = `${state.session.driverName} terminó la ruta de ${state.session.vehiclePlate}.`;
    this.record(
      state,
      'FIN_RUTA',
      null,
      reason ? `${message} ${reason}` : message,
      state.session.endedAt,
    );
  }

  private record(
    state: SessionState,
    type: TrackingEvent['type'],
    siteName: string | null,
    message: string,
    at: string,
  ): void {
    this.events.push({
      id: newId('EV'),
      at,
      sessionId: state.session.id,
      vehiclePlate: state.session.vehiclePlate,
      type,
      siteName,
      message,
    });
    this.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const store = this.deps.store;
    if (store) {
      const events = [...this.events];
      this.writes.enqueue(() => store.put(TRACKING, EVENTS, events));
    }
  }

  private saveSession(state: SessionState): void {
    state.savedAt = this.now();
    state.dirty = false;
    const store = this.deps.store;
    if (!store) return;
    const stored: StoredSession = {
      session: structuredClone(state.session),
      stops: state.stops.map((s) => ({ ...s })),
      stopCargo: [...state.stopCargo],
      fixes: state.fixes.slice(-MAX_STORED_POINTS),
      speedKmh: state.speedKmh,
    };
    this.writes.enqueue(() => store.put(SESSIONS, state.session.id, stored));
  }

  /** Borra las rutas terminadas hace más de 2 días. */
  private pruneEnded(): void {
    const limit = this.now() - KEEP_ENDED_MS;
    for (const [id, state] of this.sessions) {
      const endedAt = state.session.endedAt ? Date.parse(state.session.endedAt) : null;
      if (endedAt === null || endedAt > limit) continue;
      this.sessions.delete(id);
      const store = this.deps.store;
      if (store) this.writes.enqueue(() => store.remove(SESSIONS, id));
    }
  }

  private async restore(): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    const [sessions, tracking] = await Promise.all([store.list(SESSIONS), store.list(TRACKING)]);
    const events = tracking.find((r) => r.id === EVENTS)?.value;
    if (Array.isArray(events)) this.events = events as TrackingEvent[];
    for (const record of sessions) {
      const stored = record.value as StoredSession | null;
      if (!stored?.session?.id || !Array.isArray(stored.stops)) continue;
      const fixes = Array.isArray(stored.fixes) ? stored.fixes : [];
      const state: SessionState = {
        session: stored.session,
        stops: stored.stops,
        stopCargo: new Map(stored.stopCargo ?? []),
        fixes,
        speedKmh: stored.speedKmh ?? null,
        nextStopEtaMin: nextStopEta(
          stored.stops,
          fixes.at(-1) ?? null,
          stored.speedKmh ?? null,
          this.policy,
        ),
        savedAt: this.now(),
        dirty: false,
      };
      state.session.stops = this.liveStops(state);
      this.sessions.set(state.session.id, state);
      const lastSeen = Date.parse(fixes.at(-1)?.recordedAt ?? state.session.startedAt);
      if (!state.session.endedAt && this.now() - lastSeen > STALE_AFTER_MS) {
        this.end(state, 'Se cerró sola tras 12 horas sin señal.');
        this.saveSession(state);
      }
    }
    this.pruneEnded();
  }

  private activeState(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    // Desconocida = el servidor se reinició: el teléfono puede reanudar la ruta solo.
    if (!state) throw unknownSession();
    if (state.session.endedAt) {
      throw new DomainError('SESION_NO_ACTIVA', 'La ruta no está activa; iníciela de nuevo.');
    }
    return state;
  }

  private unit(plate: string): FleetUnit {
    const unit = this.deps.units().find((u) => u.plate === plate);
    if (!unit) {
      throw new DomainError(
        'VEHICULO_DESCONOCIDO',
        `El vehículo ${plate} no está en la flota: agréguelo en «Flota y bodega».`,
      );
    }
    return unit;
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function unknownSession(): DomainError {
  return new DomainError('SESION_DESCONOCIDA', 'La sesión de ruta no existe en el servidor.');
}

function mergeCargo(lines: readonly CargoLine[]): CargoLine[] {
  const bySku = new Map<string, CargoLine>();
  for (const line of lines) {
    const existing = bySku.get(line.sku);
    bySku.set(
      line.sku,
      existing ? { ...existing, quantity: existing.quantity + line.quantity } : { ...line },
    );
  }
  return [...bySku.values()];
}
