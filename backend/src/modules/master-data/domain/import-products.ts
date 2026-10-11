import { DomainError } from '../../../common/domain-error.js';
import {
  barcodeKey,
  hasValidCheckDigit,
  normalizeBarcode,
  type ProductBarcode,
} from '../../catalog/domain/barcode.js';
import {
  HANDLING_CLASSES,
  type HandlingClass,
  type Product,
} from '../../catalog/domain/product.js';
import { validateProduct } from './master-data.js';
import {
  cellBool,
  cellNumber,
  cellText,
  headerKey,
  readSheet,
  type Cell,
  type ColumnSpec,
  type RowIssue,
} from './spreadsheet.js';

/** Columnas de la planilla de productos (en este orden en la plantilla). */
export const PRODUCT_COLUMNS: readonly ColumnSpec[] = [
  {
    field: 'sku',
    header: 'SKU',
    aliases: ['código', 'codigo', 'código interno'],
    required: true,
    help: 'Código interno del producto. Si ya existe, se actualiza.',
  },
  {
    field: 'name',
    header: 'Nombre',
    aliases: ['descripción', 'descripcion', 'producto'],
    required: true,
    help: 'Nombre del producto.',
  },
  { field: 'brand', header: 'Marca', aliases: [], required: false, help: 'Opcional.' },
  {
    field: 'handlingClass',
    header: 'Clase de manejo',
    aliases: ['clase', 'tipo'],
    required: false,
    help: 'Granel pesado, Largo, General, Frágil, Herramienta o Químico (vacío = General). Define con qué no se puede mezclar en el carro.',
  },
  {
    field: 'unitWeightKg',
    header: 'Peso unitario (kg)',
    aliases: ['peso', 'peso kg', 'peso unitario'],
    required: true,
    help: 'Kilos por unidad. Acepta coma decimal (ej. 25,5).',
  },
  {
    field: 'lengthCm',
    header: 'Largo (cm)',
    aliases: ['largo'],
    required: true,
    help: 'Centímetros.',
  },
  {
    field: 'widthCm',
    header: 'Ancho (cm)',
    aliases: ['ancho'],
    required: true,
    help: 'Centímetros.',
  },
  {
    field: 'heightCm',
    header: 'Alto (cm)',
    aliases: ['alto'],
    required: true,
    help: 'Centímetros.',
  },
  {
    field: 'isFragile',
    header: 'Frágil',
    aliases: ['fragil'],
    required: false,
    help: 'Sí o No (vacío = No).',
  },
  {
    field: 'requiresMechanicalUnload',
    header: 'Requiere grúa',
    aliases: ['grúa', 'grua', 'requiere grua'],
    required: false,
    help: 'Sí si se descarga con grúa o pluma (vacío = No).',
  },
  {
    field: 'binLocation',
    header: 'Ubicación en bodega',
    aliases: ['ubicación', 'ubicacion', 'ubicacion bodega'],
    required: false,
    help: 'Pasillo-rack-nivel, ej. P3-R2-N1. Ordena la lista de picking.',
  },
  {
    field: 'barcodes',
    header: 'Códigos de barra',
    aliases: ['código de barra', 'codigo de barra', 'codigos de barra', 'ean', 'barcode'],
    required: false,
    help: 'EAN/UPC del proveedor o etiqueta interna. Varios separados por «;». Para una caja: código*unidades (ej. 17802820005452*40).',
  },
];

const CLASS_BY_NAME = new Map<string, HandlingClass>([
  ...HANDLING_CLASSES.map((c) => [headerKey(c.replace('_', ' ')), c] as const),
  [headerKey('Frágil'), 'FRAGIL'],
  [headerKey('Químico'), 'QUIMICO'],
]);

export interface ProductImportItem {
  line: number;
  product: Product;
  action: 'NUEVO' | 'ACTUALIZA';
}

export interface ProductImportPreview {
  items: ProductImportItem[];
  issues: RowIssue[];
  missingColumns: string[];
}

/** «7802820005455; 17802820005452*40» → códigos con sus unidades por lectura. */
export function parseBarcodeCell(cell: Cell): ProductBarcode[] {
  if (typeof cell === 'number') return [{ code: restoreLeadingZero(cell), unitsPerScan: 1 }];
  return cellText(cell)
    .split(/[;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const match = /^(.+?)\s*(?:[*×]|\s[xX]\s)\s*(\d+)$/.exec(token);
      return match
        ? { code: normalizeBarcode(match[1]), unitsPerScan: Number(match[2]) }
        : { code: normalizeBarcode(token), unitsPerScan: 1 };
    });
}

/** Excel guarda el EAN como número y pierde el 0 inicial de un UPC: se repone si cuadra. */
function restoreLeadingZero(value: number): string {
  const digits = value.toFixed(0);
  if (digits.length === 7 || digits.length === 11 || digits.length === 12) {
    const padded = `0${digits}`;
    if (hasValidCheckDigit(padded) && !hasValidCheckDigit(digits)) return padded;
  }
  return digits;
}

function handlingClass(cell: Cell): HandlingClass {
  const text = cellText(cell);
  if (text === '') return 'GENERAL';
  const found = CLASS_BY_NAME.get(headerKey(text.replace(/_/g, ' ')));
  if (!found) {
    throw new Error(
      `Clase de manejo «${text}»: use Granel pesado, Largo, General, Frágil, Herramienta o Químico.`,
    );
  }
  return found;
}

function required(value: number | null, field: string): number {
  if (value === null) throw new Error(`${field}: falta el dato.`);
  return value;
}

/**
 * Vista previa de la importación de productos: cada fila válida (nueva o que actualiza un
 * SKU existente) y los errores por fila. No guarda nada.
 */
export function parseProductSheet(
  table: readonly (readonly Cell[])[],
  existing: readonly Product[],
): ProductImportPreview {
  const sheet = readSheet(table, PRODUCT_COLUMNS);
  const items: ProductImportItem[] = [];
  const issues: RowIssue[] = [];
  const skuLine = new Map<string, number>();
  const codeOwner = new Map<string, { sku: string; line: number | null }>();
  for (const product of existing) {
    for (const b of product.barcodes ?? [])
      codeOwner.set(barcodeKey(b.code), { sku: product.sku, line: null });
  }

  for (const { line, cells } of sheet.rows) {
    try {
      const product = validateProduct({
        sku: cellText(cells.sku),
        name: cellText(cells.name),
        brand: cellText(cells.brand) || null,
        handlingClass: handlingClass(cells.handlingClass),
        unitWeightKg: required(cellNumber(cells.unitWeightKg, 'Peso unitario'), 'Peso unitario'),
        lengthCm: required(cellNumber(cells.lengthCm, 'Largo'), 'Largo'),
        widthCm: required(cellNumber(cells.widthCm, 'Ancho'), 'Ancho'),
        heightCm: required(cellNumber(cells.heightCm, 'Alto'), 'Alto'),
        isFragile: cellBool(cells.isFragile),
        requiresMechanicalUnload: cellBool(cells.requiresMechanicalUnload),
        binLocation: cellText(cells.binLocation) || null,
        barcodes: parseBarcodeCell(cells.barcodes),
      });
      const repeated = skuLine.get(product.sku);
      if (repeated) throw new Error(`El SKU ${product.sku} ya está en la fila ${repeated}.`);
      for (const barcode of product.barcodes ?? []) {
        const owner = codeOwner.get(barcodeKey(barcode.code));
        if (owner && owner.sku !== product.sku) {
          throw new Error(
            owner.line
              ? `El código ${barcode.code} ya está en la fila ${owner.line} (${owner.sku}).`
              : `El código ${barcode.code} ya es del producto ${owner.sku}.`,
          );
        }
      }
      skuLine.set(product.sku, line);
      for (const b of product.barcodes ?? [])
        codeOwner.set(barcodeKey(b.code), { sku: product.sku, line });
      items.push({
        line,
        product,
        action: existing.some((p) => p.sku === product.sku) ? 'ACTUALIZA' : 'NUEVO',
      });
    } catch (error) {
      issues.push({ line, message: issueMessage(error) });
    }
  }
  return { items, issues, missingColumns: sheet.missing };
}

export function issueMessage(error: unknown): string {
  if (error instanceof DomainError || error instanceof Error) return error.message;
  return String(error);
}
