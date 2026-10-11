import { canonicalRut, formatRut, isValidRut, rutCheckDigit } from './rut.js';

describe('RUT', () => {
  it('calcula el dígito verificador (incluye K y 0)', () => {
    expect(rutCheckDigit('12345678')).toBe('5');
    expect(rutCheckDigit('10000013')).toBe('K');
    expect(rutCheckDigit('10000004')).toBe('0');
  });

  it('valida con o sin puntos y guion, y en minúscula', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('123456785')).toBe(true);
    expect(isValidRut('10.000.013-k')).toBe(true);
    expect(isValidRut('12.345.678-6')).toBe(false);
    expect(isValidRut('0-0')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
  });

  it('muestra con puntos y guarda sin ellos', () => {
    expect(formatRut('123456785')).toBe('12.345.678-5');
    expect(formatRut('7654321-6')).toBe('7.654.321-6');
    expect(canonicalRut(' 12.345.678-5 ')).toBe('12345678-5');
    expect(canonicalRut('12.345.678-6')).toBeNull();
  });
});
