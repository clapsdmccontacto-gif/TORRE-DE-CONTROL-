import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import { validateProduct } from './master-data.js';
import { PRODUCT_COLUMNS, parseBarcodeCell, parseProductSheet } from './import-products.js';

const header = PRODUCT_COLUMNS.map((c) => c.header);
const row = (values: Record<string, unknown>) =>
  PRODUCT_COLUMNS.map((c) => (values[c.field] ?? null) as string | number | null);

describe('importar productos', () => {
  it('lee la planilla, marca nuevos y actualizados, y valida cada fila', () => {
    const existing = [
      validateProduct({
        ...DEMO_PRODUCTS[0],
        barcodes: [{ code: '7802820005455', unitsPerScan: 1 }],
      }),
    ];
    const preview = parseProductSheet(
      [
        header,
        row({
          sku: existing[0].sku,
          name: 'Cemento especial 25 kg',
          handlingClass: 'Granel pesado',
          unitWeightKg: '25',
          lengthCm: 60,
          widthCm: 40,
          heightCm: 12,
          barcodes: '7802820005455; 17802820005452*40',
          binLocation: 'p1-r1',
        }),
        row({
          sku: 'cer-60',
          name: 'Cerámica 60x60',
          handlingClass: 'Frágil',
          unitWeightKg: '22,5',
          lengthCm: 61,
          widthCm: 61,
          heightCm: 10,
          isFragile: 'sí',
        }),
        row({ sku: 'MAL-1', name: 'Sin peso', lengthCm: 1, widthCm: 1, heightCm: 1 }),
        row({
          sku: 'MAL-2',
          name: 'Clase rara',
          handlingClass: 'Explosivo',
          unitWeightKg: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        }),
        row({
          sku: 'CER-60',
          name: 'Repetido',
          unitWeightKg: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        }),
        row({
          sku: 'OTRO',
          name: 'Roba código',
          unitWeightKg: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
          barcodes: '7802820005455',
        }),
      ],
      existing,
    );
    expect(preview.missingColumns).toEqual([]);
    expect(preview.items.map((i) => [i.line, i.product.sku, i.action])).toEqual([
      [2, existing[0].sku, 'ACTUALIZA'],
      [3, 'CER-60', 'NUEVO'],
    ]);
    expect(preview.items[0].product).toMatchObject({
      binLocation: 'P1-R1',
      barcodes: [
        { code: '7802820005455', unitsPerScan: 1 },
        { code: '17802820005452', unitsPerScan: 40 },
      ],
    });
    expect(preview.items[1].product).toMatchObject({
      handlingClass: 'FRAGIL',
      unitWeightKg: 22.5,
      isFragile: true,
    });
    expect(preview.issues).toEqual([
      { line: 4, message: 'Peso unitario: falta el dato.' },
      { line: 5, message: expect.stringContaining('Clase de manejo «Explosivo»') },
      { line: 6, message: 'El SKU CER-60 ya está en la fila 3.' },
      { line: 7, message: `El código 7802820005455 ya está en la fila 2 (${existing[0].sku}).` },
    ]);
  });

  it('avisa las columnas obligatorias que faltan', () => {
    expect(parseProductSheet([['SKU', 'Nombre']], []).missingColumns).toEqual([
      'Peso unitario (kg)',
      'Largo (cm)',
      'Ancho (cm)',
      'Alto (cm)',
    ]);
  });

  it('repone el 0 inicial que Excel le quita a un UPC guardado como número', () => {
    expect(parseBarcodeCell(36000291452)).toEqual([{ code: '036000291452', unitsPerScan: 1 }]);
    expect(parseBarcodeCell(7802820005455)).toEqual([{ code: '7802820005455', unitsPerScan: 1 }]);
    expect(parseBarcodeCell('CEMX25 ; 17802820005452 x 12')).toEqual([
      { code: 'CEMX25', unitsPerScan: 1 },
      { code: '17802820005452', unitsPerScan: 12 },
    ]);
  });
});
