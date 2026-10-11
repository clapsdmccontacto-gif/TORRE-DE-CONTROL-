/**
 * RUT chileno: cuerpo + dígito verificador (módulo 11). Se guarda como «12345678-5».
 */
export function normalizeRut(raw: string): string {
  return raw.replace(/[.\s]/g, '').replace(/‐|–/g, '-').toUpperCase();
}

/** Dígito verificador del cuerpo («12345678» → «5»). */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  return rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
}

export function isValidRut(raw: string): boolean {
  const match = /^(\d{1,8})-?([\dK])$/.exec(normalizeRut(raw));
  return match !== null && Number(match[1]) > 0 && rutCheckDigit(match[1]) === match[2];
}

/** «123456785» → «12.345.678-5» (para mostrar). */
export function formatRut(raw: string): string {
  const match = /^(\d{1,8})-?([\dK])$/.exec(normalizeRut(raw));
  if (!match) return raw;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${match[2]}`;
}

/** Forma guardada: sin puntos, con guion («12345678-5»); null si no es válido. */
export function canonicalRut(raw: string): string | null {
  if (!isValidRut(raw)) return null;
  const match = /^(\d{1,8})-?([\dK])$/.exec(normalizeRut(raw))!;
  return `${Number(match[1])}-${match[2]}`;
}
