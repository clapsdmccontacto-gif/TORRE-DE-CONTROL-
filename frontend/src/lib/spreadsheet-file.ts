import { parseCsv, type Cell, type ColumnSpec } from '@core/modules/master-data/domain/spreadsheet';
import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';

/**
 * Planillas desde el navegador: lee .xlsx (primera hoja) o .csv y descarga la plantilla
 * con sus instrucciones. La interpretación de las filas es la misma del servidor
 * (`@core/.../spreadsheet`).
 */
export async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) {
    throw new Error('Planilla .xls antigua: ábrala en Excel y guárdela como .xlsx o .csv.');
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return parseCsv(decodeText(await file.arrayBuffer()));
  }
  try {
    return (await readSheet(file)) as unknown as Cell[][];
  } catch {
    throw new Error('No se pudo leer la planilla: use un archivo .xlsx o .csv.');
  }
}

/** Excel en Windows guarda el CSV en «ANSI» (Windows-1252), no en UTF-8: se prueban ambos. */
function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Plantilla .xlsx: hoja «Datos» con los encabezados y hoja «Instrucciones». */
export async function downloadTemplate(columns: readonly ColumnSpec[], fileName: string) {
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  await writeXlsxFile([
    {
      sheet: 'Datos',
      data: [columns.map((c) => bold(c.header))],
      columns: columns.map((c) => ({ width: Math.max(12, c.header.length + 4) })),
      stickyRowsCount: 1,
    },
    {
      sheet: 'Instrucciones',
      data: [
        [bold('Columna'), bold('Obligatoria'), bold('Qué va')],
        ...columns.map((c) => [c.header, c.required ? 'Sí' : 'No', c.help]),
        [],
        ['Cargue la planilla en la app con «Elegir planilla». Puede guardarla como .xlsx o .csv.'],
      ],
      columns: [{ width: 24 }, { width: 12 }, { width: 100 }],
    },
  ]).toFile(fileName);
}
