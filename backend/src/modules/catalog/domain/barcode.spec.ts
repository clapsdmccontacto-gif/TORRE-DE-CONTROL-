import {
  barcodeKey,
  findBarcodeConflict,
  hasValidCheckDigit,
  normalizeBarcode,
  validateBarcode,
  validateBarcodes,
} from './barcode.js';

describe('códigos de barra', () => {
  it('limpia lo que entrega la pistola', () => {
    expect(normalizeBarcode(' 780 1234 567890 \n')).toBe('7801234567890');
    expect(normalizeBarcode('cem-25')).toBe('CEM-25');
  });

  it('valida el dígito verificador de EAN-13, UPC-A, EAN-8 y GTIN-14', () => {
    expect(hasValidCheckDigit('7802820005455')).toBe(true); // EAN-13
    expect(hasValidCheckDigit('7802820005456')).toBe(false);
    expect(hasValidCheckDigit('036000291452')).toBe(true); // UPC-A
    expect(hasValidCheckDigit('96385074')).toBe(true); // EAN-8
    expect(hasValidCheckDigit('17802820005452')).toBe(true); // GTIN-14 (caja)
    expect(hasValidCheckDigit('CEM-25')).toBe(false);
  });

  it('acepta códigos internos y rechaza EAN mal escritos o unidades inválidas', () => {
    expect(validateBarcode({ code: 'cem 25', unitsPerScan: 1 })).toEqual({
      code: 'CEM25',
      unitsPerScan: 1,
    });
    expect(() => validateBarcode({ code: '7802820005456', unitsPerScan: 1 })).toThrow(
      expect.objectContaining({ code: 'CODIGO_INVALIDO' }),
    );
    expect(() => validateBarcode({ code: 'AB', unitsPerScan: 1 })).toThrow(
      expect.objectContaining({ code: 'CODIGO_INVALIDO' }),
    );
    expect(() => validateBarcode({ code: 'CEM25', unitsPerScan: 1.5 })).toThrow(
      expect.objectContaining({ code: 'CODIGO_INVALIDO' }),
    );
  });

  it('un UPC-A y el mismo EAN-13 con 0 adelante son el mismo código', () => {
    expect(barcodeKey('036000291452')).toBe(barcodeKey('0036000291452'));
    expect(
      validateBarcodes([
        { code: '036000291452', unitsPerScan: 1 },
        { code: '0036000291452', unitsPerScan: 1 },
        { code: '17802820005452', unitsPerScan: 12 },
      ]),
    ).toHaveLength(2);
    expect(() =>
      validateBarcodes([
        { code: '036000291452', unitsPerScan: 1 },
        { code: '0036000291452', unitsPerScan: 6 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CODIGO_DUPLICADO' }));
  });

  it('encuentra el producto que ya usa un código', () => {
    const products = [
      { sku: 'CEM-25', barcodes: [{ code: '7802820005455', unitsPerScan: 1 }] },
      { sku: 'FIE-12', barcodes: [] },
    ];
    expect(
      findBarcodeConflict(products, 'FIE-12', [{ code: '7802820005455', unitsPerScan: 1 }]),
    ).toEqual({ code: '7802820005455', sku: 'CEM-25' });
    // El mismo producto puede volver a guardar sus códigos.
    expect(
      findBarcodeConflict(products, 'CEM-25', [{ code: '7802820005455', unitsPerScan: 1 }]),
    ).toBeNull();
  });
});
