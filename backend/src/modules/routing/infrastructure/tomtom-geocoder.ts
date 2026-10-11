import { DomainError } from '../../../common/domain-error.js';
import { isValidLatLng, type LatLng } from '../../../common/geo.js';

/**
 * Adaptador de TomTom Search API v2 (geocodificación): ubica una obra por su dirección.
 * Mismo plan gratuito y clave que las rutas. Se busca en Chile, cerca de Los Ángeles.
 */
const GEOCODE_URL = 'https://api.tomtom.com/search/2/geocode';
const LOS_ANGELES = { lat: -37.4697, lng: -72.3537 };

export interface GeocodeResult {
  location: LatLng;
  /** Dirección como la entiende TomTom (para que la persona la confirme). */
  label: string;
  /** true: número de calle encontrado; false: sólo la calle (revisar en el mapa). */
  precise: boolean;
}

interface TomTomGeocodeResponse {
  results?: {
    type?: string;
    matchConfidence?: { score?: number };
    position?: { lat: number; lon: number };
    address?: { freeformAddress?: string };
  }[];
}

/** Tipos de resultado que sirven para entregar (una ciudad o región entera no sirve). */
const PRECISE_TYPES = new Set(['Point Address', 'Address Range']);
const USABLE_TYPES = new Set([...PRECISE_TYPES, 'Street', 'Cross Street', 'POI']);
const MIN_CONFIDENCE = 0.5;

export function buildGeocodeUrl(query: string, apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    countrySet: 'CL',
    limit: '1',
    language: 'es-419',
    lat: String(LOS_ANGELES.lat),
    lon: String(LOS_ANGELES.lng),
  });
  return `${GEOCODE_URL}/${encodeURIComponent(query.trim())}.json?${params.toString()}`;
}

/** Primer resultado útil, o null si TomTom no encontró la dirección con suficiente precisión. */
export function parseGeocode(json: unknown): GeocodeResult | null {
  const result = (json as TomTomGeocodeResponse | null)?.results?.[0];
  if (!result?.position || !USABLE_TYPES.has(result.type ?? '')) return null;
  if ((result.matchConfidence?.score ?? 1) < MIN_CONFIDENCE) return null;
  const location = { lat: result.position.lat, lng: result.position.lon };
  if (!isValidLatLng(location)) return null;
  return {
    location,
    label: result.address?.freeformAddress ?? '',
    precise: PRECISE_TYPES.has(result.type ?? ''),
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TomTomGeocoder {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    apiKey: string,
    fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  ) {
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
  }

  /** Busca «calle y número, comuna»; null si no la encuentra. */
  async geocode(query: string): Promise<GeocodeResult | null> {
    if (!this.apiKey) {
      throw new DomainError(
        'CLAVE_MAPA_FALTANTE',
        'Falta la clave de TomTom: péguela en «Mapa base» debajo del mapa.',
      );
    }
    if (query.trim().length < 3) return null;
    let response: Response;
    try {
      response = await this.fetchImpl(buildGeocodeUrl(query, this.apiKey));
    } catch {
      throw new DomainError(
        'SIN_CONEXION_MAPAS',
        'No se pudo conectar con TomTom. Revise la conexión a internet.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new DomainError('CLAVE_MAPA_INVALIDA', 'TomTom rechazó la clave del mapa.');
    }
    if (response.status === 429) {
      throw new DomainError(
        'LIMITE_MAPAS',
        'TomTom limitó las consultas. Espere un momento y vuelva a buscar.',
      );
    }
    if (!response.ok) return null;
    return parseGeocode(await response.json().catch(() => null));
  }
}
