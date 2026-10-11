/**
 * Lectura de planillas (Excel o CSV) sin librerías: la interfaz entrega las celdas y aquí
 * se reconocen los encabezados en español y se convierten números (coma decimal),
 * verdadero/falso y fechas. Funciones puras: las usan la vista previa del navegador y el
 * servidor.
 */
export type Cell = string | number | boolean | Date | null | undefined;

export interface ColumnSpec {
  field: string;
  /** Encabezado de la plantilla. */
  header: string;
  /** Otras formas de escribirlo que se aceptan (se comparan sin tildes ni mayúsculas). */
  aliases: readonly string[];
  required: boolean;
  /** Qué va en la columna (hoja «Instrucciones» de la plantilla). */
  help: string;
}

export interface RowIssue {
  /** Fila de la planilla (como la numera Excel). */
  line: number;
  message: string;
}

export interface SheetRow {
  line: number;
  cells: Record<string, Cell>;
}

export interface SheetRead {
  rows: SheetRow[];
  /** Columnas obligatorias que no están (por su encabezado). */
  missing: string[];
}

/** «N° Pedido», «nro. pedido» → «n pedido»: sin tildes, signos ni mayúsculas. */
export function headerKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[°º#.:()/]/g, ' ')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** CSV con comillas; el separador (`;` de Excel en Chile, `,` o tabulación) se detecta solo. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isBlank = (cell: Cell) =>
  cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');

/**
 * Busca la fila de encabezados (entre las primeras 10) y entrega cada fila con sus celdas
 * por campo. Las filas vacías se omiten.
 */
export function readSheet(
  table: readonly (readonly Cell[])[],
  columns: readonly ColumnSpec[],
): SheetRead {
  const keys = new Map<string, string>();
  for (const column of columns) {
    for (const name of [column.header, ...column.aliases]) keys.set(headerKey(name), column.field);
  }
  const required = columns.filter((c) => c.required);
  let headerIndex = -1;
  let best: Map<number, string> = new Map();
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const mapping = new Map<number, string>();
    table[i].forEach((cell, index) => {
      const field = keys.get(headerKey(cellText(cell)));
      if (field && ![...mapping.values()].includes(field)) mapping.set(index, field);
    });
    const found = required.filter((c) => [...mapping.values()].includes(c.field)).length;
    // La fila con más encabezados reconocidos (al menos uno obligatorio y dos en total).
    if (mapping.size > best.size && found >= 1 && mapping.size >= 2) {
      best = mapping;
      headerIndex = i;
    }
  }
  const present = new Set(best.values());
  const missing = (
    headerIndex === -1 ? required : required.filter((c) => !present.has(c.field))
  ).map((c) => c.header);
  const rows: SheetRow[] = [];
  if (headerIndex === -1) return { rows, missing };
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells: Record<string, Cell> = {};
    for (const [index, field] of best) cells[field] = table[i][index];
    if (Object.values(cells).every(isBlank)) continue;
    rows.push({ line: i + 1, cells });
  }
  return { rows, missing };
}

/** Texto de una celda (vacío si no hay nada). */
export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return isoDate(cell);
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
  return String(cell).trim();
}

/**
 * Número de una celda: acepta «1.234,5» (Chile), «1234.5» y «12,5». Vacío → null.
 * Lanza un mensaje si no es un número.
 */
export function cellNumber(cell: Cell, field: string): number | null {
  if (typeof cell === 'number') return cell;
  const text = cellText(cell).replace(/\s/g, '');
  if (text === '') return null;
  let normalized = text;
  if (text.includes(',') && text.includes('.')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    normalized = text.replace(',', '.');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`${field}: «${text}» no es un número.`);
  return value;
}

/** Sí/No: «sí», «si», «x», «1», «verdadero», «true» → true. */
export function cellBool(cell: Cell): boolean {
  if (typeof cell === 'boolean') return cell;
  if (typeof cell === 'number') return cell !== 0;
  return ['si', 'sí', 'x', '1', 'verdadero', 'true', 's', 'yes'].includes(
    cellText(cell).toLowerCase(),
  );
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fecha AAAA-MM-DD desde una fecha de Excel, «15-10-2026», «15/10/26», «2026-10-15» o el
 * número de serie de Excel. Vacío → null. Lanza un mensaje si no se entiende.
 */
export function cellDate(cell: Cell, field: string): string | null {
  if (cell instanceof Date) return isoDate(cell);
  if (typeof cell === 'number' && cell > 20_000 && cell < 80_000) {
    return isoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86_400_000));
  }
  const text = cellText(cell);
  if (text === '') return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return checkedDate(+match[1], +match[2], +match[3], field, text);
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    return checkedDate(year, +match[2], +match[1], field, text);
  }
  throw new Error(`${field}: «${text}» no es una fecha (use día-mes-año).`);
}

function checkedDate(year: number, month: number, day: number, field: string, text: string) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${field}: «${text}» no es una fecha válida.`);
  }
  return isoDate(date);
}
