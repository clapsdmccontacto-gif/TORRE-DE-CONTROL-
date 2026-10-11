import { DomainError } from '../../../common/domain-error.js';
import { WriteQueue, type RecordStore } from '../../../common/record-store.js';
import type { Product } from '../../catalog/domain/product.js';
import type { OrderTracker } from '../../fulfillment/application/order-tracker.js';
import type { OrderStatus } from '../../fulfillment/domain/order-status.js';
import type { DeliveryOrder } from '../../routing/domain/delivery.js';
import { DEFAULT_CART_SPECS, type CartType } from '../domain/cart.js';
import { checkCartAddition, type MixViolation } from '../domain/mix-validator.js';
import {
  SHORTAGE_LABEL,
  closePick,
  evaluateScan,
  suggestCart,
  pickList,
  pickProgress,
  type PickLine,
  type PickProgress,
  type ScanRejection,
  type Shortage,
  type ShortageReason,
} from '../domain/pick-task.js';

/** Cada lectura queda registrada (también las rechazadas, para auditar). */
export interface PickEvent {
  /** Generado en el equipo: reintentar no duplica la lectura. */
  id: string;
  at: string;
  operator: string;
  device: string | null;
  code: string;
  sku: string | null;
  /** Unidades que suma (negativas al deshacer; 0 si se rechazó). */
  units: number;
  result: 'OK' | ScanRejection | 'DESHECHO';
  message: string | null;
  /** En un DESHECHO: la lectura que anula. */
  undoes?: string;
}

interface PickRecord {
  orderId: string;
  operator: string | null;
  device: string | null;
  claimedAt: string | null;
  closedAt: string | null;
  cartType: CartType;
  events: PickEvent[];
  shortages: Shortage[];
}

export interface PickQueueItem {
  orderId: string;
  customerName: string | null;
  siteName: string;
  commune: string;
  deliveryDate: string | null;
  /** Camión y orden en el plan publicado (si lo tiene). */
  vehiclePlate: string | null;
  routePosition: number | null;
  status: OrderStatus;
  operator: string | null;
  progress: PickProgress;
  lineCount: number;
}

export type PickAlert = 'ATRASADO' | 'DEMORADO' | 'FALTANTE';

export interface PickMonitorItem extends PickQueueItem {
  claimedAt: string | null;
  closedAt: string | null;
  /** Minutos desde que se tomó (hasta que se cerró). */
  elapsedMin: number | null;
  shortages: (Shortage & { name: string })[];
  alerts: PickAlert[];
}

export interface PickMonitor {
  generatedAt: string;
  orders: PickMonitorItem[];
}

export interface PickView extends PickQueueItem {
  notes: string | null;
  cartType: CartType;
  lines: PickLine[];
  /** Últimas lecturas (más recientes primero). */
  events: PickEvent[];
  shortages: Shortage[];
}

export interface ScanResult {
  event: PickEvent;
  ok: boolean;
  message: string;
  /** Avisos de mezcla o capacidad del carro (reglas de mezcla). */
  mix: MixViolation[];
  view: PickView;
}

export interface PickingDeskDeps {
  /** Pedidos con su obra y productos (incluye códigos de barra y ubicación). */
  orders: () => readonly DeliveryOrder[];
  products: () => readonly Product[];
  tracker: OrderTracker;
  /** Camión y orden de cada pedido en el plan publicado. */
  routeOrder?: () => ReadonlyMap<string, { plate: string; position: number }>;
  store?: RecordStore;
  now?: () => number;
}

const PICKING = 'picking';
const QUEUE_STATUSES: readonly OrderStatus[] = ['PENDIENTE', 'EN_PICKING'];
const MONITOR_STATUSES: readonly OrderStatus[] = [
  'PENDIENTE',
  'EN_PICKING',
  'PICKEADO',
  'PICKEADO_PARCIAL',
];
/** Un picking abierto más que esto se marca «demorado». */
const SLOW_PICK_MIN = 45;
const RECENT_EVENTS = 15;

const sameOperator = (a: string | null, b: string) =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Caso de uso "preparar pedidos" en bodega: tomar un pedido (nadie más lo puede tomar),
 * escanear cada producto, deshacer, liberar y cerrar con faltantes justificados. Cada
 * lectura es un evento guardado. Sin framework: lo usan el backend y el modo local.
 */
export class PickingDesk {
  readonly ready: Promise<void>;
  private readonly deps: PickingDeskDeps;
  private readonly records = new Map<string, PickRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly writes = new WriteQueue();

  constructor(deps: PickingDeskDeps) {
    this.deps = deps;
    this.ready = this.restore();
    // Un pedido que avanza fuera de la bodega (despacho, entrega) también cambia el monitor.
    deps.tracker.subscribe(() => this.notify());
  }

  flush(): Promise<void> {
    return this.writes.flush();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pedidos por preparar: por fecha de entrega y orden de la ruta publicada. */
  queue(): PickQueueItem[] {
    const route = this.deps.routeOrder?.() ?? new Map();
    return this.deps
      .orders()
      .filter((o) => QUEUE_STATUSES.includes(this.deps.tracker.status(o.id)))
      .map((o) => this.item(o, route))
      .sort(byPriority);
  }

  view(orderId: string): PickView {
    const order = this.order(orderId);
    const record = this.record(orderId);
    const item = this.item(order, this.deps.routeOrder?.() ?? new Map());
    return {
      ...item,
      notes: order.notes ?? null,
      cartType: record.cartType,
      lines: this.lines(order, record),
      events: [...record.events].reverse().slice(0, RECENT_EVENTS),
      shortages: record.shortages,
    };
  }

  /** Lo pickeado de cada producto (para validar la carga del camión). */
  picked(orderId: string): Map<string, number> {
    return pickedBySku(this.record(orderId));
  }

  claim(input: { orderId: string; operator: string; device?: string | null }): PickView {
    const operator = operatorName(input.operator);
    const order = this.order(input.orderId);
    const record = this.record(order.id);
    const status = this.deps.tracker.status(order.id);
    if (status === 'EN_PICKING' && !sameOperator(record.operator, operator)) {
      throw new DomainError(
        'PEDIDO_TOMADO',
        `${record.operator ?? 'Otro operario'} está preparando el pedido ${order.id}.`,
        { operator: record.operator },
      );
    }
    if (status !== 'PENDIENTE' && status !== 'EN_PICKING') {
      throw new DomainError(
        'PEDIDO_NO_DISPONIBLE',
        `El pedido ${order.id} ya no está por preparar.`,
      );
    }
    this.deps.tracker.transition({ orderId: order.id, to: 'EN_PICKING', actor: operator });
    // El mismo operario desde otro equipo conserva cómo escribió su nombre.
    record.operator = sameOperator(record.operator, operator) ? record.operator : operator;
    record.device = input.device ?? null;
    if (record.events.length === 0) record.cartType = suggestCart(order.lines);
    record.claimedAt ??= this.nowIso();
    this.save(record);
    return this.view(order.id);
  }

  /** Lo deja libre para otro operario (lo escaneado se conserva). La torre puede forzarlo. */
  release(input: { orderId: string; operator: string; force?: boolean }): PickView {
    const record = this.record(input.orderId);
    this.assertOwner(record, input.operator, input.force);
    this.deps.tracker.transition({
      orderId: record.orderId,
      to: 'PENDIENTE',
      actor: input.operator,
      detail: input.force ? 'Liberado por la torre de control' : 'Pedido liberado',
    });
    record.operator = null;
    record.device = null;
    this.save(record);
    return this.view(record.orderId);
  }

  scan(input: {
    id: string;
    orderId: string;
    code: string;
    operator: string;
    device?: string | null;
    cartType?: CartType;
  }): ScanResult {
    const order = this.order(input.orderId);
    const record = this.record(order.id);
    const repeated = record.events.find((e) => e.id === input.id);
    if (repeated) return this.result(order, record, repeated, []);
    this.assertOwner(record, input.operator);
    if (input.cartType && DEFAULT_CART_SPECS[input.cartType]) record.cartType = input.cartType;

    const lines = this.lines(order, record);
    const evaluation = evaluateScan(input.code, this.deps.products(), lines);
    const event: PickEvent = {
      id: input.id,
      at: this.nowIso(),
      operator: operatorName(input.operator),
      device: input.device ?? null,
      code: input.code.trim().slice(0, 60),
      sku: evaluation.sku,
      units: evaluation.ok ? evaluation.units : 0,
      result: evaluation.ok ? 'OK' : evaluation.reason,
      message: evaluation.ok ? null : evaluation.message,
    };
    let mix: MixViolation[] = [];
    if (evaluation.ok) {
      const products = new Map(order.lines.map((l) => [l.product.sku, l.product]));
      const current = [...pickedBySku(record)]
        .filter(([, quantity]) => quantity > 0)
        .map(([sku, quantity]) => ({ product: products.get(sku)!, quantity }))
        .filter((l) => l.product);
      const incoming = { product: products.get(evaluation.sku)!, quantity: evaluation.units };
      mix = checkCartAddition(DEFAULT_CART_SPECS[record.cartType], current, incoming).violations;
    }
    record.events.push(event);
    this.save(record);
    return this.result(order, record, event, mix);
  }

  /** Deshace la última lectura válida (por ejemplo, un producto que se devolvió al estante). */
  undo(input: { orderId: string; operator: string; id: string }): PickView {
    const record = this.record(input.orderId);
    if (record.events.some((e) => e.id === input.id)) return this.view(record.orderId);
    this.assertOwner(record, input.operator);
    const undone = new Set(record.events.map((e) => e.undoes).filter(Boolean));
    const last = [...record.events].reverse().find((e) => e.result === 'OK' && !undone.has(e.id));
    if (!last) throw new DomainError('NADA_QUE_DESHACER', 'No hay lecturas para deshacer.');
    record.events.push({
      id: input.id,
      at: this.nowIso(),
      operator: operatorName(input.operator),
      device: last.device,
      code: last.code,
      sku: last.sku,
      units: -last.units,
      result: 'DESHECHO',
      message: null,
      undoes: last.id,
    });
    this.save(record);
    return this.view(record.orderId);
  }

  close(input: {
    orderId: string;
    operator: string;
    shortages: { sku: string; reason: ShortageReason; note?: string | null }[];
  }): PickView {
    const order = this.order(input.orderId);
    const record = this.record(order.id);
    this.assertOwner(record, input.operator);
    const { status, shortages } = closePick(this.lines(order, record), input.shortages);
    const names = new Map(order.lines.map((l) => [l.product.sku, l.product.name]));
    this.deps.tracker.transition({
      orderId: order.id,
      to: status,
      actor: operatorName(input.operator),
      detail:
        shortages.length === 0
          ? 'Picking completo'
          : `Faltantes: ${shortages.map((s) => `${s.missing} ${names.get(s.sku) ?? s.sku} (${SHORTAGE_LABEL[s.reason]})`).join(', ')}`,
    });
    record.shortages = shortages;
    record.closedAt = this.nowIso();
    this.save(record);
    return this.view(order.id);
  }

  /** Tablero de la torre: lo por preparar, en picking y listo, con alertas. */
  monitor(): PickMonitor {
    const now = this.now();
    const today = chileDate(now);
    const route = this.deps.routeOrder?.() ?? new Map();
    const orders = this.deps
      .orders()
      .filter((o) => MONITOR_STATUSES.includes(this.deps.tracker.status(o.id)))
      .map((order): PickMonitorItem => {
        const item = this.item(order, route);
        const record = this.records.get(order.id) ?? null;
        const names = new Map(order.lines.map((l) => [l.product.sku, l.product.name]));
        const start = record?.claimedAt ? Date.parse(record.claimedAt) : null;
        const end = record?.closedAt ? Date.parse(record.closedAt) : now;
        const elapsedMin = start === null ? null : Math.max(0, Math.round((end - start) / 60_000));
        const shortages = (record?.shortages ?? []).map((s) => ({
          ...s,
          name: names.get(s.sku) ?? s.sku,
        }));
        const alerts: PickAlert[] = [];
        const open = item.status === 'PENDIENTE' || item.status === 'EN_PICKING';
        if (open && item.deliveryDate && item.deliveryDate < today) alerts.push('ATRASADO');
        if (item.status === 'EN_PICKING' && elapsedMin !== null && elapsedMin > SLOW_PICK_MIN) {
          alerts.push('DEMORADO');
        }
        if (item.status === 'PICKEADO_PARCIAL') alerts.push('FALTANTE');
        return {
          ...item,
          claimedAt: record?.claimedAt ?? null,
          closedAt: record?.closedAt ?? null,
          elapsedMin,
          shortages,
          alerts,
        };
      })
      .sort(byPriority);
    return { generatedAt: new Date(now).toISOString(), orders };
  }

  private item(
    order: DeliveryOrder,
    route: ReadonlyMap<string, { plate: string; position: number }>,
  ): PickQueueItem {
    const record = this.records.get(order.id) ?? null;
    const status = this.deps.tracker.status(order.id);
    const lines = this.lines(order, record);
    const stop = route.get(order.id) ?? null;
    return {
      orderId: order.id,
      customerName: order.customerName ?? null,
      siteName: order.site.name,
      commune: order.site.commune,
      deliveryDate: order.deliveryDate ?? null,
      vehiclePlate: stop?.plate ?? null,
      routePosition: stop?.position ?? null,
      status,
      operator: status === 'EN_PICKING' ? (record?.operator ?? null) : null,
      progress: pickProgress(lines),
      lineCount: lines.length,
    };
  }

  private lines(order: DeliveryOrder, record: PickRecord | null): PickLine[] {
    return pickList(order.lines, record ? pickedBySku(record) : new Map());
  }

  private result(
    order: DeliveryOrder,
    record: PickRecord,
    event: PickEvent,
    mix: MixViolation[],
  ): ScanResult {
    const line = this.lines(order, record).find((l) => l.sku === event.sku);
    return {
      event,
      ok: event.result === 'OK',
      message:
        event.result === 'OK' && line
          ? `${line.name}: +${event.units} (${line.picked} de ${line.ordered})`
          : (event.message ?? ''),
      mix,
      view: this.view(order.id),
    };
  }

  private assertOwner(record: PickRecord, operator: string, force = false): void {
    if (this.deps.tracker.status(record.orderId) !== 'EN_PICKING') {
      throw new DomainError(
        'PEDIDO_NO_TOMADO',
        `Tome el pedido ${record.orderId} antes de escanear.`,
      );
    }
    if (!force && !sameOperator(record.operator, operator)) {
      throw new DomainError(
        'PEDIDO_TOMADO',
        `${record.operator ?? 'Otro operario'} está preparando el pedido ${record.orderId}.`,
        { operator: record.operator },
      );
    }
  }

  private order(orderId: string): DeliveryOrder {
    const order = this.deps.orders().find((o) => o.id === orderId);
    if (!order) throw new DomainError('PEDIDO_DESCONOCIDO', `El pedido ${orderId} no existe.`);
    return order;
  }

  private record(orderId: string): PickRecord {
    let record = this.records.get(orderId);
    if (!record) {
      record = {
        orderId,
        operator: null,
        device: null,
        claimedAt: null,
        closedAt: null,
        cartType: 'MODULAR',
        events: [],
        shortages: [],
      };
      this.records.set(orderId, record);
    }
    return record;
  }

  private save(record: PickRecord): void {
    const store = this.deps.store;
    if (store) {
      const saved = structuredClone(record);
      this.writes.enqueue(() => store.put(PICKING, saved.orderId, saved));
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private async restore(): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    for (const { value } of await store.list(PICKING)) {
      const record = value as PickRecord | null;
      if (record?.orderId && Array.isArray(record.events)) this.records.set(record.orderId, record);
    }
  }
}

/** Unidades pickeadas por producto: lecturas válidas menos las deshechas. */
function pickedBySku(record: PickRecord): Map<string, number> {
  const picked = new Map<string, number>();
  for (const event of record.events) {
    if ((event.result === 'OK' || event.result === 'DESHECHO') && event.sku) {
      picked.set(event.sku, (picked.get(event.sku) ?? 0) + event.units);
    }
  }
  return picked;
}

function operatorName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) {
    throw new DomainError('OPERARIO_INVALIDO', 'Escriba su nombre (2 a 60 letras).');
  }
  return name;
}

function byPriority(a: PickQueueItem, b: PickQueueItem): number {
  const date = (x: PickQueueItem) => x.deliveryDate ?? '9999-12-31';
  return (
    date(a).localeCompare(date(b)) ||
    (a.vehiclePlate ?? '~').localeCompare(b.vehiclePlate ?? '~') ||
    (a.routePosition ?? 1e9) - (b.routePosition ?? 1e9) ||
    a.orderId.localeCompare(b.orderId)
  );
}

/** Fecha de hoy en Chile (AAAA-MM-DD), para saber qué pedidos están atrasados. */
function chileDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(now));
}
