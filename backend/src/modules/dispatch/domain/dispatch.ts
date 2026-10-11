import { DomainError } from '../../../common/domain-error.js';
import { normalizeBarcode } from '../../catalog/domain/barcode.js';
import type { Product } from '../../catalog/domain/product.js';
import { resolveCode } from '../../picking/domain/pick-task.js';

/** Un pedido en la carga de un camión: lo pickeado de cada producto y lo ya subido. */
export interface LoadOrder {
  orderId: string;
  /** Posición en la ruta (1 = primera entrega); null si se asignó a mano sin plan. */
  routePosition: number | null;
  lines: LoadLine[];
}

export interface LoadLine {
  sku: string;
  name: string;
  /** Lo que salió del picking (lo que se puede subir). */
  picked: number;
  loaded: number;
}

export type LoadRejection =
  'CODIGO_DESCONOCIDO' | 'OTRO_CAMION' | 'NO_ESTA_EN_CAMION' | 'YA_CARGADO';

export type LoadEvaluation =
  | {
      ok: true;
      /** BULTO: la etiqueta del pedido sube todo lo pickeado que falta de ese pedido. */
      kind: 'PRODUCTO' | 'BULTO';
      orderId: string;
      units: { sku: string; quantity: number }[];
      message: string;
    }
  | { ok: false; reason: LoadRejection; message: string };

/**
 * Orden de carga: lo que se entrega último va primero (al fondo del camión); los pedidos
 * asignados a mano, al final de la carga.
 */
export function loadingOrder<T extends { routePosition: number | null; orderId: string }>(
  orders: readonly T[],
): T[] {
  return [...orders].sort(
    (a, b) =>
      (b.routePosition ?? -1) - (a.routePosition ?? -1) || a.orderId.localeCompare(b.orderId),
  );
}

const remaining = (line: LoadLine) => Math.max(0, line.picked - line.loaded);

/**
 * ¿Lo que se escaneó sube a este camión? Acepta la etiqueta de un pedido del camión (sube
 * todo lo pickeado que falta) o un producto de sus pedidos sin pasarse de lo pickeado.
 * Si es de otro camión, dice cuál.
 */
export function evaluateLoadScan(
  code: string,
  context: {
    plate: string;
    products: readonly Product[];
    orders: readonly LoadOrder[];
    /** Pedidos de los otros camiones (para avisar dónde va). */
    elsewhere: ReadonlyMap<string, { plate: string; skus: readonly string[] }>;
  },
): LoadEvaluation {
  const clean = normalizeBarcode(code);
  const label = context.orders.find((o) => o.orderId === clean);
  if (label) {
    const units = label.lines
      .map((l) => ({ sku: l.sku, quantity: remaining(l) }))
      .filter((u) => u.quantity > 0);
    if (units.length === 0) {
      return {
        ok: false,
        reason: 'YA_CARGADO',
        message: `El pedido ${label.orderId} ya está cargado completo.`,
      };
    }
    const total = units.reduce((sum, u) => sum + u.quantity, 0);
    return {
      ok: true,
      kind: 'BULTO',
      orderId: label.orderId,
      units,
      message: `Pedido ${label.orderId} completo: ${total} ${total === 1 ? 'unidad' : 'unidades'} a bordo.`,
    };
  }
  const labelElsewhere = context.elsewhere.get(clean);
  if (labelElsewhere) {
    return {
      ok: false,
      reason: 'OTRO_CAMION',
      message: `El pedido ${clean} va en el camión ${labelElsewhere.plate}, no en ${context.plate}.`,
    };
  }

  const found = resolveCode(code, context.products);
  if (!found) {
    return {
      ok: false,
      reason: 'CODIGO_DESCONOCIDO',
      message: `El código ${clean || '(vacío)'} no es de ningún producto ni pedido.`,
    };
  }
  const { product, units } = found;
  const candidates = loadingOrder(context.orders)
    .map((order) => ({ order, line: order.lines.find((l) => l.sku === product.sku) }))
    .filter((c): c is { order: LoadOrder; line: LoadLine } => c.line !== undefined);
  const target = candidates.find((c) => remaining(c.line) >= units);
  if (target) {
    return {
      ok: true,
      kind: 'PRODUCTO',
      orderId: target.order.orderId,
      units: [{ sku: product.sku, quantity: units }],
      message: `${product.name}: +${units} al pedido ${target.order.orderId} (${target.line.loaded + units} de ${target.line.picked}).`,
    };
  }
  if (candidates.length > 0) {
    return {
      ok: false,
      reason: 'YA_CARGADO',
      message:
        units > 1
          ? `La caja trae ${units} y en ${context.plate} faltan menos de ${product.name}: suba unidades sueltas.`
          : `Ya subió todo lo pickeado de ${product.name} para ${context.plate}.`,
    };
  }
  const other = [...context.elsewhere.entries()].find(([, o]) => o.skus.includes(product.sku));
  if (other) {
    return {
      ok: false,
      reason: 'OTRO_CAMION',
      message: `${product.name} va en el camión ${other[1].plate} (pedido ${other[0]}), no en ${context.plate}.`,
    };
  }
  return {
    ok: false,
    reason: 'NO_ESTA_EN_CAMION',
    message: `${product.name} no está en ningún pedido de ${context.plate}.`,
  };
}

export const LOAD_SHORTAGE_REASONS = ['SIN_ESPACIO', 'DANADO', 'OTRO'] as const;
export type LoadShortageReason = (typeof LOAD_SHORTAGE_REASONS)[number];

export const LOAD_SHORTAGE_LABEL: Record<LoadShortageReason, string> = {
  SIN_ESPACIO: 'No cupo en el camión',
  DANADO: 'Producto dañado',
  OTRO: 'Otro motivo',
};

export interface LoadShortage {
  orderId: string;
  sku: string;
  missing: number;
  reason: LoadShortageReason;
  note: string | null;
}

/**
 * Cierre de la carga: cada pedido con algo a bordo queda CARGADO; lo pickeado que no subió
 * necesita motivo. Un pedido sin nada a bordo queda en bodega (no se cierra).
 */
export function closeLoad(
  orders: readonly LoadOrder[],
  reasons: readonly {
    orderId: string;
    sku: string;
    reason: LoadShortageReason;
    note?: string | null;
  }[],
): { loaded: string[]; left: string[]; shortages: LoadShortage[] } {
  const loaded: string[] = [];
  const left: string[] = [];
  const shortages: LoadShortage[] = [];
  for (const order of orders) {
    const onBoard = order.lines.reduce((sum, l) => sum + l.loaded, 0);
    if (onBoard === 0) {
      left.push(order.orderId);
      continue;
    }
    for (const line of order.lines) {
      const missing = remaining(line);
      if (missing === 0) continue;
      const reason = reasons.find((r) => r.orderId === order.orderId && r.sku === line.sku);
      if (!reason || !LOAD_SHORTAGE_REASONS.includes(reason.reason)) {
        throw new DomainError(
          'CARGA_INCOMPLETA',
          `Pedido ${order.orderId}: faltan ${missing} de ${line.name} por subir. Escanéelos o indique el motivo.`,
          { orderId: order.orderId, sku: line.sku },
        );
      }
      if (reason.reason === 'OTRO' && !reason.note?.trim()) {
        throw new DomainError('CARGA_INCOMPLETA', `Explique por qué no subió ${line.name}.`);
      }
      shortages.push({
        orderId: order.orderId,
        sku: line.sku,
        missing,
        reason: reason.reason,
        note: reason.note?.trim() || null,
      });
    }
    loaded.push(order.orderId);
  }
  if (loaded.length === 0) {
    throw new DomainError('CARGA_VACIA', 'Todavía no se subió nada al camión.');
  }
  return { loaded, left, shortages };
}
