import { DomainError } from '../../../common/domain-error.js';

/**
 * Clase de manipulación: define con qué se puede mezclar un ítem en el carro
 * y cómo se carga en el camión.
 */
export const HANDLING_CLASSES = [
  'GRANEL_PESADO', // sacos de cemento, áridos, maxisacos
  'LARGO', // fierros, perfiles, planchas
  'GENERAL', // ferretería general
  'FRAGIL', // cerámicas, loza sanitaria, vidrio
  'HERRAMIENTA', // herramientas eléctricas y de precisión (Makita, Bosch)
  'QUIMICO', // diluyentes, solventes, aditivos
] as const;

export type HandlingClass = (typeof HANDLING_CLASSES)[number];

/**
 * Maestro de producto con los atributos logísticos que usan picking y cubicaje.
 * Peso y dimensiones corresponden a la unidad de manipulación (saco, caja, barra, maxisaco).
 */
export interface Product {
  sku: string;
  name: string;
  brand: string | null;
  handlingClass: HandlingClass;
  unitWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile: boolean;
  /** Fuerza descarga mecánica aunque la unidad pese menos que el límite de manipulación manual. */
  requiresMechanicalUnload: boolean;
}

/** Producto + cantidad: unidad básica tanto de picking como de carga. */
export interface ProductLine {
  product: Product;
  quantity: number;
}

export function unitVolumeM3(product: Product): number {
  return (product.lengthCm * product.widthCm * product.heightCm) / 1_000_000;
}

export function longestSideCm(product: Product): number {
  return Math.max(product.lengthCm, product.widthCm, product.heightCm);
}

export function assertValidLine(line: ProductLine): void {
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    throw new DomainError(
      'CANTIDAD_INVALIDA',
      `La cantidad de ${line.product.sku} debe ser mayor que cero.`,
    );
  }
}
