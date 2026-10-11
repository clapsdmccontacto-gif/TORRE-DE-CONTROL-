import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { WriteQueue, type RecordStore } from '../../../common/record-store.js';
import type { Product } from '../../catalog/domain/product.js';
import type { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import { DELIVERED_STATUSES, type OrderStatus } from '../../fulfillment/domain/order-status.js';
import type { DeliveryOrder } from '../../routing/domain/delivery.js';
import type { FleetUnit } from '../../routing/domain/optimizer.js';
import {
  LOAD_SHORTAGE_LABEL,
  closeLoad,
  evaluateLoadScan,
  loadingOrder,
  type LoadLine,
  type LoadOrder,
  type LoadRejection,
  type LoadShortage,
  type LoadShortageReason,
} from '../domain/dispatch.js';

export interface LoadEvent {
  /** Generado en el equipo: reintentar no duplica la lectura. */
  id: string;
  at: string;
  operator: string;
  device: string | null;
  code: string;
  result: 'OK' | LoadRejection | 'DESHECHO';
  kind: 'PRODUCTO' | 'BULTO' | null;
  orderId: string | null;
  /** Unidades subidas (negativas al deshacer). */
  units: { sku: string; quantity: number }[];
  message: string | null;
  undoes?: string;
}

interface TruckRecord {
  plate: string;
  operator: string | null;
  startedAt: string | null;
  /** Lecturas de la carga en curso (al cerrar se archivan). */
  events: LoadEvent[];
}

interface Assignment {
  orderId: string;
  plate: string;
  by: string;
  at: string;
}

const READY: readonly OrderStatus[] = ['PICKEADO', 'PICKEADO_PARCIAL'];
const VISIBLE: readonly OrderStatus[] = ['PENDIENTE', 'EN_PICKING', ...READY, 'CARGADO'];
const TRUCKS = 'dispatch-trucks';
const ASSIGNMENTS = 'dispatch-assignments';
const LOADS = 'dispatch-loads';
const RECENT = 15;

export interface LoadOrderView extends LoadOrder {
  siteName: string;
  customerName: string | null;
  status: OrderStatus;
  /** Asignado a mano desde despacho (sin plan publicado). */
  manual: boolean;
  lines: (LoadLine & { ordered: number })[];
}

export interface TruckSummary {
  plate: string;
  vehicleName: string;
  orders: number;
  ready: number;
  loaded: number;
  /** Unidades subidas / pickeadas de los pedidos listos. */
  progress: { loaded: number; picked: number };
}

export interface TruckLoadView extends TruckSummary {
  /** En orden de carga (lo último que se entrega, primero). */
  loadOrders: LoadOrderView[];
  /** Pedidos pickeados sin camión (sin plan publicado): se pueden asignar a mano. */
  unassigned: {
    orderId: string;
    siteName: string;
    customerName: string | null;
    status: OrderStatus;
  }[];
  events: LoadEvent[];
}

export interface LoadScanResult {
  event: LoadEvent;
  ok: boolean;
  message: string;
  view: TruckLoadView;
}

/** Parada para la ruta del conductor de un pedido asignado a mano. */
export interface ManualStop {
  deliveryId: string;
  siteName: string;
  location: LatLng;
  notifyEtaMinutes: number;
  lines: { sku: string; name: string; quantity: number }[];
  weightKg: number;
}

export interface DispatchDeskDeps {
  orders: () => readonly DeliveryOrder[];
  products: () => readonly Product[];
  units: () => readonly FleetUnit[];
  tracker: OrderTracker;
  /** Lo pickeado de cada producto del pedido (bodega). */
  picked: (orderId: string) => ReadonlyMap<string, number>;
  /** Camión y orden de cada pedido en el plan publicado. */
  routeOrder: () => ReadonlyMap<string, { plate: string; position: number }>;
  store?: RecordStore;
  now?: () => number;
}

/**
 * Caso de uso "despachar": por camión, sus pedidos en orden de carga; cada producto (o la
 * etiqueta del pedido) se escanea al subir, validando que sea de ese camión y que no pase
 * de lo pickeado. Al cerrar, los pedidos quedan CARGADO con camión, operario y hora. Sin
 * framework: lo usan el backend y el modo local.
 */
export class DispatchDesk {
  readonly ready: Promise<void>;
  private readonly deps: DispatchDeskDeps;
  private readonly trucks = new Map<string, TruckRecord>();
  private readonly assignments = new Map<string, Assignment>();
  private readonly assignListeners = new Set<(plate: string) => void>();
  private readonly writes = new WriteQueue();

  constructor(deps: DispatchDeskDeps) {
    this.deps = deps;
    this.ready = this.restore();
  }

  flush(): Promise<void> {
    return this.writes.flush();
  }

  /** Se asignó un pedido a mano: el conductor de ese camión lo recibe en su ruta. */
  onAssigned(listener: (plate: string) => void): () => void {
    this.assignListeners.add(listener);
    return () => this.assignListeners.delete(listener);
  }

  summaries(): TruckSummary[] {
    return this.deps.units().map((unit) => this.summary(unit));
  }

  truck(plate: string): TruckLoadView {
    const unit = this.unit(plate);
    const route = this.deps.routeOrder();
    const record = this.record(unit.plate);
    return {
      ...this.summary(unit),
      loadOrders: loadingOrder(this.ordersOf(unit.plate)),
      unassigned: this.deps
        .orders()
        .filter((o) => !route.has(o.id) && !this.assignments.has(o.id))
        .filter((o) => READY.includes(this.deps.tracker.status(o.id)))
        .map((o) => ({
          orderId: o.id,
          siteName: o.site.name,
          customerName: o.customerName ?? null,
          status: this.deps.tracker.status(o.id),
        })),
      events: [...record.events].reverse().slice(0, RECENT),
    };
  }

  /** Pedido sin plan publicado: se asigna a un camión (queda registrado quién). */
  assign(input: { orderId: string; plate: string; operator: string }): TruckLoadView {
    const unit = this.unit(input.plate);
    const order = this.order(input.orderId);
    const planned = this.deps.routeOrder().get(order.id);
    if (planned) {
      throw new DomainError(
        'PEDIDO_EN_PLAN',
        `El pedido ${order.id} va en el camión ${planned.plate} según el plan publicado.`,
      );
    }
    const status = this.deps.tracker.status(order.id);
    if (status === 'EN_RUTA' || DELIVERED_STATUSES.includes(status)) {
      throw new DomainError('PEDIDO_NO_DISPONIBLE', `El pedido ${order.id} ya salió de bodega.`);
    }
    const assignment = {
      orderId: order.id,
      plate: unit.plate,
      by: operatorName(input.operator),
      at: this.nowIso(),
    };
    this.assignments.set(order.id, assignment);
    const store = this.deps.store;
    if (store) this.writes.enqueue(() => store.put(ASSIGNMENTS, order.id, assignment));
    for (const listener of this.assignListeners) listener(unit.plate);
    return this.truck(unit.plate);
  }

  scan(input: {
    id: string;
    plate: string;
    code: string;
    operator: string;
    device?: string | null;
  }): LoadScanResult {
    const unit = this.unit(input.plate);
    const record = this.record(unit.plate);
    const repeated = record.events.find((e) => e.id === input.id);
    if (repeated) return this.result(unit.plate, repeated);
    const operator = operatorName(input.operator);
    const orders = this.ordersOf(unit.plate).filter((o) => READY.includes(o.status));
    const evaluation = evaluateLoadScan(input.code, {
      plate: unit.plate,
      products: this.deps.products(),
      orders,
      elsewhere: this.elsewhere(unit.plate),
    });
    const event: LoadEvent = {
      id: input.id,
      at: this.nowIso(),
      operator,
      device: input.device ?? null,
      code: input.code.trim().slice(0, 60),
      result: evaluation.ok ? 'OK' : evaluation.reason,
      kind: evaluation.ok ? evaluation.kind : null,
      orderId: evaluation.ok ? evaluation.orderId : null,
      units: evaluation.ok ? evaluation.units : [],
      message: evaluation.message,
    };
    record.operator = operator;
    record.startedAt ??= event.at;
    record.events.push(event);
    this.saveTruck(record);
    return this.result(unit.plate, event);
  }

  undo(input: { plate: string; operator: string; id: string }): TruckLoadView {
    const record = this.record(this.unit(input.plate).plate);
    if (record.events.some((e) => e.id === input.id)) return this.truck(record.plate);
    const undone = new Set(record.events.map((e) => e.undoes).filter(Boolean));
    const last = [...record.events].reverse().find((e) => e.result === 'OK' && !undone.has(e.id));
    if (!last) throw new DomainError('NADA_QUE_DESHACER', 'No hay lecturas para deshacer.');
    record.events.push({
      ...last,
      id: input.id,
      at: this.nowIso(),
      operator: operatorName(input.operator),
      result: 'DESHECHO',
      units: last.units.map((u) => ({ sku: u.sku, quantity: -u.quantity })),
      message: null,
      undoes: last.id,
    });
    this.saveTruck(record);
    return this.truck(record.plate);
  }

  /** Cierra la carga: lo que tiene algo a bordo queda CARGADO en este camión. */
  close(input: {
    plate: string;
    operator: string;
    shortages: { orderId: string; sku: string; reason: LoadShortageReason; note?: string | null }[];
  }): TruckLoadView {
    const unit = this.unit(input.plate);
    const operator = operatorName(input.operator);
    const ready = this.ordersOf(unit.plate).filter((o) => READY.includes(o.status));
    const { loaded, shortages } = closeLoad(ready, input.shortages);
    const names = new Map(this.deps.products().map((p) => [p.sku, p.name]));
    for (const orderId of loaded) {
      const missing = shortages.filter((s) => s.orderId === orderId);
      this.deps.tracker.transition({
        orderId,
        to: 'CARGADO',
        actor: operator,
        vehiclePlate: unit.plate,
        detail:
          missing.length === 0
            ? `Cargado completo en ${unit.plate}`
            : `Cargado en ${unit.plate}; no subió: ${missing.map((s) => describe(s, names)).join(', ')}`,
      });
    }
    const record = this.record(unit.plate);
    const closedAt = this.nowIso();
    const store = this.deps.store;
    if (store) {
      const archived = {
        ...structuredClone(record),
        closedAt,
        closedBy: operator,
        loaded,
        shortages,
      };
      this.writes.enqueue(() => store.put(LOADS, `${unit.plate}-${closedAt}`, archived));
    }
    record.events = record.events.filter((e) => e.orderId !== null && !loaded.includes(e.orderId));
    record.startedAt = record.events.length > 0 ? record.startedAt : null;
    this.saveTruck(record);
    return this.truck(unit.plate);
  }

  /** Pedidos asignados a mano a un camión, como paradas para la ruta del conductor. */
  manualStops(plate: string): ManualStop[] {
    return [...this.assignments.values()]
      .filter((a) => a.plate === plate)
      .flatMap((a) => {
        const order = this.deps.orders().find((o) => o.id === a.orderId);
        const status = this.deps.tracker.status(a.orderId);
        if (!order || DELIVERED_STATUSES.includes(status)) return [];
        return [
          {
            deliveryId: order.id,
            siteName: order.site.name,
            location: order.site.location,
            notifyEtaMinutes: order.site.notifyEtaMinutes,
            lines: order.lines.map((l) => ({
              sku: l.product.sku,
              name: l.product.name,
              quantity: l.quantity,
            })),
            weightKg:
              Math.round(
                order.lines.reduce((s, l) => s + l.product.unitWeightKg * l.quantity, 0) * 10,
              ) / 10,
          },
        ];
      });
  }

  private summary(unit: FleetUnit): TruckSummary {
    const orders = this.ordersOf(unit.plate);
    const ready = orders.filter((o) => READY.includes(o.status));
    const sum = (key: 'loaded' | 'picked') =>
      ready.reduce((total, o) => total + o.lines.reduce((s, l) => s + l[key], 0), 0);
    return {
      plate: unit.plate,
      vehicleName: unit.vehicle.name,
      orders: orders.length,
      ready: ready.length,
      loaded: orders.filter((o) => o.status === 'CARGADO').length,
      progress: { loaded: sum('loaded'), picked: sum('picked') },
    };
  }

  /** Pedidos del camión (plan publicado o asignados a mano) que todavía no salieron. */
  private ordersOf(plate: string): LoadOrderView[] {
    const route = this.deps.routeOrder();
    const loaded = loadedByOrder(this.record(plate));
    return this.deps.orders().flatMap((order): LoadOrderView[] => {
      const planned = route.get(order.id);
      const manual = this.assignments.get(order.id);
      const truck = planned?.plate ?? manual?.plate;
      const status = this.deps.tracker.status(order.id);
      if (truck !== plate || !VISIBLE.includes(status)) return [];
      const picked = this.deps.picked(order.id);
      const onBoard = loaded.get(order.id) ?? new Map<string, number>();
      return [
        {
          orderId: order.id,
          routePosition: planned?.position ?? null,
          siteName: order.site.name,
          customerName: order.customerName ?? null,
          status,
          manual: !planned && manual !== undefined,
          lines: order.lines.map((l) => {
            const pickedQty = picked.get(l.product.sku) ?? 0;
            return {
              sku: l.product.sku,
              name: l.product.name,
              ordered: l.quantity,
              picked: pickedQty,
              loaded: status === 'CARGADO' ? pickedQty : (onBoard.get(l.product.sku) ?? 0),
            };
          }),
        },
      ];
    });
  }

  /** Pedidos listos de los otros camiones, para avisar «va en el camión X». */
  private elsewhere(plate: string): Map<string, { plate: string; skus: string[] }> {
    const map = new Map<string, { plate: string; skus: string[] }>();
    for (const unit of this.deps.units()) {
      if (unit.plate === plate) continue;
      for (const order of this.ordersOf(unit.plate)) {
        map.set(order.orderId, { plate: unit.plate, skus: order.lines.map((l) => l.sku) });
      }
    }
    return map;
  }

  private result(plate: string, event: LoadEvent): LoadScanResult {
    return {
      event,
      ok: event.result === 'OK',
      message: event.message ?? '',
      view: this.truck(plate),
    };
  }

  private unit(plate: string): FleetUnit {
    const key = plate.trim().toUpperCase();
    const unit = this.deps.units().find((u) => u.plate === key);
    if (!unit)
      throw new DomainError('VEHICULO_DESCONOCIDO', `El camión ${plate} no está en la flota.`);
    return unit;
  }

  private order(orderId: string): DeliveryOrder {
    const order = this.deps.orders().find((o) => o.id === orderId);
    if (!order) throw new DomainError('PEDIDO_DESCONOCIDO', `El pedido ${orderId} no existe.`);
    return order;
  }

  private record(plate: string): TruckRecord {
    let record = this.trucks.get(plate);
    if (!record) {
      record = { plate, operator: null, startedAt: null, events: [] };
      this.trucks.set(plate, record);
    }
    return record;
  }

  private saveTruck(record: TruckRecord): void {
    const store = this.deps.store;
    if (!store) return;
    const saved = structuredClone(record);
    this.writes.enqueue(() => store.put(TRUCKS, saved.plate, saved));
  }

  private nowIso(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString();
  }

  private async restore(): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    const [trucks, assignments] = await Promise.all([store.list(TRUCKS), store.list(ASSIGNMENTS)]);
    for (const { value } of trucks) {
      const record = value as TruckRecord | null;
      if (record?.plate && Array.isArray(record.events)) this.trucks.set(record.plate, record);
    }
    for (const { value } of assignments) {
      const assignment = value as Assignment | null;
      if (assignment?.orderId) this.assignments.set(assignment.orderId, assignment);
    }
  }
}

/** Lo subido de cada pedido y producto: lecturas válidas menos las deshechas. */
function loadedByOrder(record: TruckRecord): Map<string, Map<string, number>> {
  const loaded = new Map<string, Map<string, number>>();
  for (const event of record.events) {
    if ((event.result !== 'OK' && event.result !== 'DESHECHO') || !event.orderId) continue;
    const order = loaded.get(event.orderId) ?? new Map<string, number>();
    for (const unit of event.units) order.set(unit.sku, (order.get(unit.sku) ?? 0) + unit.quantity);
    loaded.set(event.orderId, order);
  }
  return loaded;
}

function describe(shortage: LoadShortage, names: ReadonlyMap<string, string>): string {
  const why = shortage.note
    ? `${LOAD_SHORTAGE_LABEL[shortage.reason]}: ${shortage.note}`
    : LOAD_SHORTAGE_LABEL[shortage.reason];
  return `${shortage.missing} ${names.get(shortage.sku) ?? shortage.sku} (${why})`;
}

function operatorName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) {
    throw new DomainError('OPERARIO_INVALIDO', 'Escriba su nombre (2 a 60 letras).');
  }
  return name;
}
