import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { newId } from '../../../common/ids.js';
import { roundTo } from '../../../common/math.js';
import type { FleetUnit, PlannedRoute } from '../../routing/domain/optimizer.js';
import type { RoutePlan } from '../../routing/application/route-planner.js';
import {
  DEFAULT_TRACKING_POLICY,
  deviceStatus,
  effectiveSpeedKmh,
  evaluateFix,
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
  type: TrackingEventType | 'INICIO_RUTA' | 'FIN_RUTA';
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
  now?: () => number;
  policy?: TrackingPolicy;
}

interface SessionState {
  session: DriverSession;
  stops: TrackedStop[];
  stopCargo: Map<string, { cargo: CargoLine[]; weightKg: number }>;
  fixes: PositionFix[];
  speedKmh: number | null;
  nextStopEtaMin: number | null;
}

const MAX_TRACK_POINTS = 5_000;
const MAX_EVENTS = 200;
const SNAPSHOT_EVENTS = 30;

/**
 * Caso de uso "rastrear la flota": sesiones de conductores, lecturas GPS, avance de
 * paradas y eventos (aviso al capataz, llegada, salida). Estado en memoria; sin
 * dependencias de framework, de modo que lo usan el backend y el modo local del frontend.
 */
export class TrackingHub {
  private readonly deps: TrackingHubDeps;
  private readonly policy: TrackingPolicy;
  private readonly sessions = new Map<string, SessionState>();
  private events: TrackingEvent[] = [];
  private readonly listeners = new Set<(snapshot: FleetSnapshot) => void>();

  constructor(deps: TrackingHubDeps) {
    this.deps = deps;
    this.policy = deps.policy ?? DEFAULT_TRACKING_POLICY;
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
      }
    }
    const route = this.deps.activePlan()?.routes.find((r) => r.unitPlate === unit.plate) ?? null;
    const state = this.createState(driverName, driverPhone, unit, route);
    this.notify();
    return state.session;
  }

  endSession(sessionId: string): DriverSession {
    const state = this.activeState(sessionId);
    this.end(state, null);
    this.notify();
    return state.session;
  }

  /** Recibe lecturas del teléfono (en lote: el teléfono las acumula si pierde señal). */
  ingest(sessionId: string, fixes: readonly PositionFix[]): IngestResult {
    const state = this.activeState(sessionId);
    const result = this.apply(state, fixes);
    this.notify();
    return result;
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
              : `${plate} salió de ${event.siteName}: descarga terminada.`;
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
