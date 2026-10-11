import { DomainError } from '../../../common/domain-error.js';

/** Código de barra de un producto: el del proveedor o el de la caja, que vale varias unidades. */
export interface ProductBarcode {
  code: string;
  /** Unidades que suma cada lectura (1 para la unidad; p. ej. 12 para la caja). */
  unitsPerScan: number;
}

const MAX_UNITS_PER_SCAN = 10_000;
/** Caracteres de Code128/Code39 que usan las etiquetas internas. */
const CODE_PATTERN = /^[A-Z0-9\-./+$%]{3,48}$/;
/** EAN-8, UPC-A, EAN-13 y GTIN-14: llevan dígito verificador GS1. */
const GTIN_LENGTHS = [8, 12, 13, 14];

/** Lo que entrega la pistola o se escribe: sin espacios y en mayúsculas. */
export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

const isGtin = (code: string) => /^\d+$/.test(code) && GTIN_LENGTHS.includes(code.length);

/** Dígito verificador GS1 (módulo 10, pesos 3 y 1 desde la derecha). */
export function hasValidCheckDigit(code: string): boolean {
  if (!isGtin(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Clave para comparar códigos: un UPC-A de 12 dígitos y el mismo EAN-13 con un 0 adelante
 * son el mismo producto (la pistola puede leer cualquiera de los dos).
 */
export function barcodeKey(code: string): string {
  const clean = normalizeBarcode(code);
  return isGtin(clean) ? clean.padStart(14, '0') : clean;
}

export function validateBarcode(input: ProductBarcode): ProductBarcode {
  const code = normalizeBarcode(input.code);
  if (!CODE_PATTERN.test(code)) {
    throw new DomainError(
      'CODIGO_INVALIDO',
      `Código de barra «${input.code.trim()}»: use entre 3 y 48 letras o números.`,
    );
  }
  if (isGtin(code) && !hasValidCheckDigit(code)) {
    throw new DomainError(
      'CODIGO_INVALIDO',
      `El código ${code} no es un EAN/UPC válido (el último dígito no corresponde): revíselo.`,
    );
  }
  const units = input.unitsPerScan;
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS_PER_SCAN) {
    throw new DomainError(
      'CODIGO_INVALIDO',
      `Unidades por lectura del código ${code}: un número entero entre 1 y ${MAX_UNITS_PER_SCAN}.`,
    );
  }
  return { code, unitsPerScan: units };
}

/** Valida los códigos de un producto y quita repetidos (por su clave). */
export function validateBarcodes(list: readonly ProductBarcode[] | undefined): ProductBarcode[] {
  const byKey = new Map<string, ProductBarcode>();
  for (const barcode of list ?? []) {
    const valid = validateBarcode(barcode);
    const key = barcodeKey(valid.code);
    const existing = byKey.get(key);
    if (existing && existing.unitsPerScan !== valid.unitsPerScan) {
      throw new DomainError(
        'CODIGO_DUPLICADO',
        `El código ${valid.code} aparece dos veces con distintas unidades por lectura.`,
      );
    }
    byKey.set(key, valid);
  }
  return [...byKey.values()];
}

/** Primer código del producto que ya usa otro producto (los códigos no se repiten). */
export function findBarcodeConflict(
  products: readonly { sku: string; barcodes?: readonly ProductBarcode[] }[],
  sku: string,
  barcodes: readonly ProductBarcode[],
): { code: string; sku: string } | null {
  const keys = new Map(barcodes.map((b) => [barcodeKey(b.code), b.code]));
  for (const product of products) {
    if (product.sku === sku) continue;
    for (const barcode of product.barcodes ?? []) {
      const code = keys.get(barcodeKey(barcode.code));
      if (code) return { code, sku: product.sku };
    }
  }
  return null;
}
