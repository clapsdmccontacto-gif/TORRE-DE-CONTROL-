import {
  cellBool,
  cellDate,
  cellNumber,
  headerKey,
  parseCsv,
  readSheet,
  type ColumnSpec,
} from './spreadsheet.js';

const columns: ColumnSpec[] = [
  { field: 'orderId', header: 'N° pedido', aliases: ['nota de venta'], required: true, help: '' },
  { field: 'qty', header: 'Cantidad', aliases: [], required: true, help: '' },
  { field: 'notes', header: 'Notas', aliases: [], required: false, help: '' },
];

describe('planillas', () => {
  it('normaliza encabezados sin tildes ni signos', () => {
    expect(headerKey('  N° Pedido ')).toBe('n pedido');
    expect(headerKey('Teléfono (contacto)')).toBe('telefono contacto');
  });

  it('lee CSV de Excel en Chile (punto y coma, comillas, saltos de línea)', () => {
    const csv =
      '﻿N° pedido;Cantidad;Notas\r\nNV-1;12,5;"Entregar ""temprano""; portón azul"\r\nNV-2;3;"dos\nlíneas"\r\n';
    expect(parseCsv(csv)).toEqual([
      ['N° pedido', 'Cantidad', 'Notas'],
      ['NV-1', '12,5', 'Entregar "temprano"; portón azul'],
      ['NV-2', '3', 'dos\nlíneas'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('encuentra los encabezados aunque haya un título arriba y omite filas vacías', () => {
    const read = readSheet(
      [
        ['Pedidos de octubre'],
        [],
        ['Nota de venta', 'Cantidad', 'Otra cosa'],
        ['NV-1', 2, 'x'],
        [null, '', null],
        ['NV-2', 3],
      ],
      columns,
    );
    expect(read.missing).toEqual([]);
    expect(read.rows).toEqual([
      { line: 4, cells: { orderId: 'NV-1', qty: 2 } },
      { line: 6, cells: { orderId: 'NV-2', qty: 3 } },
    ]);
    expect(readSheet([['Pedido', 'Precio']], columns).missing).toEqual(['N° pedido', 'Cantidad']);
  });

  it('convierte números con coma decimal, sí/no y fechas', () => {
    expect(cellNumber('1.234,5', 'Peso')).toBe(1234.5);
    expect(cellNumber('12,5', 'Peso')).toBe(12.5);
    expect(cellNumber('7.5', 'Peso')).toBe(7.5);
    expect(cellNumber('', 'Peso')).toBeNull();
    expect(() => cellNumber('doce', 'Peso')).toThrow('Peso: «doce» no es un número.');
    expect([cellBool('Sí'), cellBool('x'), cellBool('no'), cellBool(null)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(cellDate(new Date(Date.UTC(2026, 9, 15)), 'Fecha')).toBe('2026-10-15');
    expect(cellDate('15-10-2026', 'Fecha')).toBe('2026-10-15');
    expect(cellDate('5/1/27', 'Fecha')).toBe('2027-01-05');
    expect(cellDate(46310, 'Fecha')).toBe('2026-10-15'); // número de serie de Excel
    expect(() => cellDate('31-02-2026', 'Fecha')).toThrow('no es una fecha válida');
  });
});
