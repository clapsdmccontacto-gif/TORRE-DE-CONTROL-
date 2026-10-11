import { DomainError } from '../../../common/domain-error.js';
import { barcodeKey, normalizeBarcode } from '../../catalog/domain/barcode.js';
import { longestSideCm, type Product } from '../../catalog/domain/product.js';
import { DEFAULT_CART_SPECS, type CartType } from './cart.js';

/** Línea del pedido en la lista de picking. */
export interface PickLine {
  sku: string;
  name: string;
  binLocation: string | null;
  ordered: number;
  picked: number;
}

export const SHORTAGE_REASONS = ['SIN_STOCK', 'DANADO', 'OTRO'] as const;
export type ShortageReason = (typeof SHORTAGE_REASONS)[number];

export const SHORTAGE_LABEL: Record<ShortageReason, string> = {
  SIN_STOCK: 'Sin stock',
  DANADO: 'Producto dañado',
  OTRO: 'Otro motivo',
};

export type ScanRejection = 'CODIGO_DESCONOCIDO' | 'NO_ESTA_EN_PEDIDO' | 'EXCEDE_CANTIDAD';

export type ScanEvaluation =
  | { ok: true; sku: string; name: string; units: number; picked: number; ordered: number }
  | { ok: false; reason: ScanRejection; message: string; sku: string | null };

/** «P2-R10-N1» va después de «P2-R9-N1» (orden natural), y sin ubicación al final. */
function compareBins(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

/** Lista de picking: líneas del pedido ordenadas por ubicación en bodega (recorrido). */
export function pickList(
  lines: readonly { product: Product; quantity: number }[],
  pickedBySku: ReadonlyMap<string, number>,
): PickLine[] {
  return lines
    .map((l) => ({
      sku: l.product.sku,
      name: l.product.name,
      binLocation: l.product.binLocation ?? null,
      ordered: l.quantity,
      picked: pickedBySku.get(l.product.sku) ?? 0,
    }))
    .sort((a, b) => compareBins(a.binLocation, b.binLocation) || a.name.localeCompare(b.name));
}

/** Producto y unidades de un código leído (el SKU escrito a mano vale una unidad). */
export function resolveCode(
  code: string,
  products: readonly Product[],
): { product: Product; units: number } | null {
  const clean = normalizeBarcode(code);
  if (!clean) return null;
  const key = barcodeKey(clean);
  for (const product of products) {
    const barcode = (product.barcodes ?? []).find((b) => barcodeKey(b.code) === key);
    if (barcode) return { product, units: barcode.unitsPerScan };
  }
  const bySku = products.find((p) => p.sku === clean);
  return bySku ? { product: bySku, units: 1 } : null;
}

/**
 * ¿El código leído sirve para este pedido? Errores: código que no es de ningún producto,
 * producto que no está en el pedido o pasarse de lo pedido (una caja suma sus unidades).
 */
export function evaluateScan(
  code: string,
  products: readonly Product[],
  lines: readonly PickLine[],
): ScanEvaluation {
  const found = resolveCode(code, products);
  if (!found) {
    return {
      ok: false,
      reason: 'CODIGO_DESCONOCIDO',
      sku: null,
      message: `El código ${normalizeBarcode(code) || '(vacío)'} no es de ningún producto. Revise el producto o regístrelo en «Productos».`,
    };
  }
  const { product, units } = found;
  const line = lines.find((l) => l.sku === product.sku);
  if (!line) {
    return {
      ok: false,
      reason: 'NO_ESTA_EN_PEDIDO',
      sku: product.sku,
      message: `${product.name} no está en este pedido: déjelo en su lugar.`,
    };
  }
  if (line.picked + units > line.ordered) {
    return {
      ok: false,
      reason: 'EXCEDE_CANTIDAD',
      sku: product.sku,
      message:
        units > 1
          ? `La caja trae ${units} y faltan ${line.ordered - line.picked} de ${product.name}: saque las unidades sueltas.`
          : `Ya tiene las ${line.ordered} de ${product.name}: no agregue más.`,
    };
  }
  return {
    ok: true,
    sku: product.sku,
    name: product.name,
    units,
    picked: line.picked + units,
    ordered: line.ordered,
  };
}

export interface PickProgress {
  picked: number;
  ordered: number;
  /** 0 a 1. */
  fraction: number;
  complete: boolean;
}

export function pickProgress(lines: readonly PickLine[]): PickProgress {
  const ordered = lines.reduce((sum, l) => sum + l.ordered, 0);
  const picked = lines.reduce((sum, l) => sum + Math.min(l.picked, l.ordered), 0);
  return {
    picked,
    ordered,
    fraction: ordered === 0 ? 0 : picked / ordered,
    complete: lines.every((l) => l.picked >= l.ordered),
  };
}

export interface Shortage {
  sku: string;
  missing: number;
  reason: ShortageReason;
  note: string | null;
}

/**
 * Cierra el picking: completo → PICKEADO; con faltantes justificados → PICKEADO_PARCIAL.
 * Cada línea incompleta necesita su motivo.
 */
export function closePick(
  lines: readonly PickLine[],
  reasons: readonly { sku: string; reason: ShortageReason; note?: string | null }[],
): { status: 'PICKEADO' | 'PICKEADO_PARCIAL'; shortages: Shortage[] } {
  const bySku = new Map(reasons.map((r) => [r.sku, r]));
  const shortages: Shortage[] = [];
  for (const line of lines) {
    if (line.picked >= line.ordered) continue;
    const reason = bySku.get(line.sku);
    if (!reason || !SHORTAGE_REASONS.includes(reason.reason)) {
      throw new DomainError(
        'FALTAN_PRODUCTOS',
        `Faltan ${line.ordered - line.picked} de ${line.name}: escanéelos o indique el motivo del faltante.`,
        { sku: line.sku },
      );
    }
    if (reason.reason === 'OTRO' && !reason.note?.trim()) {
      throw new DomainError('FALTAN_PRODUCTOS', `Explique el faltante de ${line.name}.`, {
        sku: line.sku,
      });
    }
    shortages.push({
      sku: line.sku,
      missing: line.ordered - line.picked,
      reason: reason.reason,
      note: reason.note?.trim() || null,
    });
  }
  if (lines.every((l) => l.picked === 0)) {
    throw new DomainError(
      'PICKING_VACIO',
      'No se pickeó ningún producto: libere el pedido en vez de cerrarlo.',
    );
  }
  return { status: shortages.length === 0 ? 'PICKEADO' : 'PICKEADO_PARCIAL', shortages };
}

/**
 * Carro sugerido para el pedido: el de largos si algo no cabe en el modular, la plataforma
 * si lleva granel pesado o supera la carga del modular; si no, el modular.
 */
export function suggestCart(lines: readonly { product: Product; quantity: number }[]): CartType {
  const modular = DEFAULT_CART_SPECS.MODULAR;
  if (lines.some((l) => longestSideCm(l.product) > modular.maxItemLengthCm)) return 'CARRO_LARGOS';
  const weight = lines.reduce((sum, l) => sum + l.product.unitWeightKg * l.quantity, 0);
  if (
    lines.some((l) => l.product.handlingClass === 'GRANEL_PESADO') ||
    weight > modular.maxLoadKg
  ) {
    return 'PLATAFORMA_PESADA';
  }
  return 'MODULAR';
}
