import {
  TomTomGeocoder,
  type GeocodeResult,
} from '@core/modules/routing/infrastructure/tomtom-geocoder';
import { tomtomKey } from '@/components/map/basemaps';

export type { GeocodeResult };

/** Pausa entre consultas: el plan gratuito de TomTom admite pocas por segundo. */
const SPACING_MS = 250;

/**
 * Ubica direcciones con TomTom desde el navegador (clave de la empresa o la del equipo),
 * una tras otra. `onProgress` informa cuántas van; las no encontradas quedan en null.
 */
export async function geocodeAll(
  queries: { key: string; query: string }[],
  onProgress: (done: number) => void,
): Promise<Map<string, GeocodeResult | null>> {
  const geocoder = new TomTomGeocoder(tomtomKey());
  const results = new Map<string, GeocodeResult | null>();
  for (const [index, { key, query }] of queries.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
    try {
      results.set(key, await geocoder.geocode(query));
    } catch {
      // Sin conexión o sin cupo: se marca en el mapa a mano.
      results.set(key, null);
    }
    onProgress(index + 1);
  }
  return results;
}
