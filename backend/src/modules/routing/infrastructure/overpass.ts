import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import type { RoadsideLookup } from '../application/road-router.port.js';
import { clusterPoints, samplePath, type RoadsideFeatures } from '../domain/road-route.js';

/**
 * Semáforos y plazas de peaje desde OpenStreetMap (Overpass API, gratis y sin clave).
 * La cobertura depende de lo mapeado por la comunidad en cada ciudad.
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MAX_QUERY_POINTS = 80;

export function buildRoadsideQuery(path: readonly LatLng[]): string {
  const line = samplePath(path, MAX_QUERY_POINTS)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(',');
  return (
    '[out:json][timeout:25];(' +
    `node(around:25,${line})["highway"="traffic_signals"];` +
    `node(around:60,${line})["barrier"="toll_booth"];` +
    `way(around:60,${line})["barrier"="toll_booth"];` +
    ');out center tags;'
  );
}

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function parseRoadside(json: unknown): RoadsideFeatures {
  const elements = ((json as { elements?: OverpassElement[] } | null)?.elements ?? []).flatMap(
    (e) => {
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      return lat === undefined || lng === undefined ? [] : [{ ...e, location: { lat, lng } }];
    },
  );
  const signals = elements
    .filter((e) => e.tags?.highway === 'traffic_signals')
    .map((e) => e.location);
  const booths = elements.filter((e) => e.tags?.barrier === 'toll_booth');
  // Una plaza tiene varias casetas: se agrupan en un radio de 300 m.
  const plazas = clusterPoints(
    booths.map((b) => b.location),
    300,
  ).map((location) => {
    const named = booths.find(
      (b) =>
        Math.abs(b.location.lat - location.lat) < 0.003 &&
        Math.abs(b.location.lng - location.lng) < 0.003 &&
        (b.tags?.name ?? b.tags?.operator),
    );
    return { name: named?.tags?.name ?? named?.tags?.operator ?? null, location };
  });
  return { trafficSignals: clusterPoints(signals, 40), tollBooths: plazas };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OverpassRoadsideLookup implements RoadsideLookup {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init)) {
    this.fetchImpl = fetchImpl;
  }

  async features(path: readonly LatLng[]): Promise<RoadsideFeatures> {
    if (path.length < 2) return { trafficSignals: [], tollBooths: [] };
    try {
      const response = await this.fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildRoadsideQuery(path))}`,
      });
      if (!response.ok) throw new Error(String(response.status));
      return parseRoadside(await response.json());
    } catch {
      throw new DomainError(
        'OSM_NO_DISPONIBLE',
        'No se pudieron consultar semáforos y peajes en OpenStreetMap; intente más tarde.',
      );
    }
  }
}
