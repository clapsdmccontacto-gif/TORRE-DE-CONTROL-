import { code128Bars, code128Values, code128Widths } from './code128.js';

describe('Code 128', () => {
  it('codifica con inicio B, dígito de control y parada', () => {
    // «PJJ123C»: control = (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 55.
    expect(code128Values('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });

  it('cada símbolo mide 11 módulos y la parada 13', () => {
    const widths = code128Widths('NV-901');
    const symbols = 'NV-901'.length + 2; // inicio, datos y control (la parada aparte)
    expect(widths.reduce((a, b) => a + b, 0)).toBe(symbols * 11 + 13);
    expect(code128Bars('NV-901').width).toBe(symbols * 11 + 13 + 20);
  });

  it('rechaza textos vacíos o con caracteres fuera del conjunto B', () => {
    expect(() => code128Values('')).toThrow(expect.objectContaining({ code: 'CODIGO_INVALIDO' }));
    expect(() => code128Values('NV-Ñ')).toThrow(
      expect.objectContaining({ code: 'CODIGO_INVALIDO' }),
    );
  });
});
