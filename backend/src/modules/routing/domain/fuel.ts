import type { FuelProfile } from '../../load-planning/domain/vehicle.js';

/** Emisión por litro de diésel (factor estándar de combustión). */
export const CO2_KG_PER_LITER_DIESEL = 2.68;

/** Consumo interpolado entre vacío y plena carga según la fracción de carga útil. */
export function litersPer100Km(fuel: FuelProfile, loadFraction: number): number {
  const fraction = Math.min(Math.max(loadFraction, 0), 1);
  return fuel.emptyLitersPer100Km + (fuel.fullLitersPer100Km - fuel.emptyLitersPer100Km) * fraction;
}

/** Litros de un tramo recorrido con `loadKg` a bordo. */
export function legLiters(
  distanceKm: number,
  fuel: FuelProfile,
  loadKg: number,
  maxPayloadKg: number,
): number {
  return (distanceKm * litersPer100Km(fuel, loadKg / maxPayloadKg)) / 100;
}
