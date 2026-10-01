/** Redondeo para presentar resultados (los cálculos internos usan precisión completa). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
