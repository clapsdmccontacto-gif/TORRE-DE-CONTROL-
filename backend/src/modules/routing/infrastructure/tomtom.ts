import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { roundTo } from '../../../common/math.js';
import type { RoadRouter } from '../application/road-router.port.js';
import {
  pathKm,
  truckProfile,
  type RoadRoute,
  type RoadRouteRequest,
  type TrafficSeverity,
} from '../domain/road-route.js';

/**
 * Adaptador de TomTom Routing API v1 ("TomTom Maps"). Se usa v1 porque la versión
 * Orbis todavía no admite camiones, reordenar paradas ni tramos con peaje.
 * Plan gratuito: 2.500 consultas de ruta y 50.000 mosaicos de mapa al día, sin tarjeta.
 */
const CALCULATE_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
const MAX_POINTS = 150;
/** Velocidad máxima de camiones en carretera en Chile. */
const TRUCK_MAX_SPEED_KMH = 90;

export function buildCalculateRouteUrl(request: RoadRouteRequest, apiKey: string): string {
  if (request.points.length < 2) {
    throw new DomainError('RUTA_INVALIDA', 'La ruta necesita al menos un origen y un destino.');
  }
  if (request.points.length > MAX_POINTS) {
    throw new DomainError('RUTA_INVALIDA', `La ruta admite hasta ${MAX_POINTS} puntos.`);
  }
  const locations = request.points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(':');
  const truck = truckProfile(request.vehicle, request.loadKg);
  const params = new URLSearchParams({
    key: apiKey,
    traffic: 'true',
    departAt: 'now',
    routeType: 'fastest',
    travelMode: truck.travelMode,
    computeTravelTimeFor: 'all',
    instructionsType: 'text',
    language: 'es-ES',
  });
  params.append('sectionType', 'tollRoad');
  params.append('sectionType', 'traffic');
  if (truck.travelMode === 'truck') {
    params.set('vehicleCommercial', 'true');
    params.set('vehicleWeight', String(truck.grossWeightKg));
    params.set('vehicleAxleWeight', String(truck.maxAxleLoadKg));
    params.set('vehicleMaxSpeed', String(TRUCK_MAX_SPEED_KMH));
  }
  if (request.optimizeOrder && request.points.length > 3) params.set('computeBestOrder', 'true');
  if (request.avoidTolls) params.set('avoid', 'tollRoads');
  return `${CALCULATE_ROUTE_URL}/${locations}/json?${params.toString()}`;
}

interface TomTomPoint {
  latitude: number;
  longitude: number;
}

interface TomTomSummary {
  lengthInMeters: number;
  travelTimeInSeconds: number;
  trafficDelayInSeconds?: number;
  noTrafficTravelTimeInSeconds?: number;
  departureTime?: string;
  arrivalTime?: string;
}

interface TomTomSection {
  startPointIndex: number;
  endPointIndex: number;
  sectionType: string;
  simpleCategory?: string;
  delayInSeconds?: number;
  magnitudeOfDelay?: number;
  effectiveSpeedInKmh?: number;
}

interface TomTomInstruction {
  message?: string;
  street?: string;
  maneuver?: string;
  point: TomTomPoint;
  routeOffsetInMeters?: number;
}

interface TomTomResponse {
  routes?: {
    summary: TomTomSummary;
    legs: { summary: TomTomSummary; points: TomTomPoint[] }[];
    sections?: TomTomSection[];
    guidance?: { instructions?: TomTomInstruction[] };
  }[];
  optimizedWaypoints?: { providedIndex: number; optimizedIndex: number }[];
  error?: { description?: string };
  detailedError?: { message?: string };
}

const toLatLng = (p: TomTomPoint): LatLng => ({ lat: p.latitude, lng: p.longitude });

const CATEGORY_LABEL: Record<string, string> = {
  JAM: 'Congestión',
  ROAD_WORK: 'Obras en la vía',
  ROAD_CLOSURE: 'Vía cerrada',
  OTHER: 'Incidente',
};

function severity(section: TomTomSection): TrafficSeverity {
  if (section.simpleCategory === 'ROAD_CLOSURE' || section.magnitudeOfDelay === 4) return 'CERRADO';
  if (section.magnitudeOfDelay === 3) return 'ALTA';
  if (section.magnitudeOfDelay === 2) return 'MODERADA';
  return 'LEVE';
}

export function parseCalculateRoute(json: unknown, request: RoadRouteRequest): RoadRoute {
  const data = json as TomTomResponse;
  const route = data.routes?.[0];
  if (!route) {
    throw new DomainError('RUTA_NO_ENCONTRADA', 'TomTom no encontró una ruta entre esos puntos.');
  }
  const path = route.legs.flatMap((leg) => leg.points.map(toLatLng));
  const clamp = (i: number) => Math.min(Math.max(i, 0), path.length - 1);
  const slice = (s: TomTomSection) =>
    path.slice(clamp(s.startPointIndex), clamp(s.endPointIndex) + 1);
  const sections = route.sections ?? [];
  const tollPaths = sections.filter((s) => s.sectionType === 'TOLL_ROAD').map(slice);

  const intermediates = Math.max(request.points.length - 2, 0);
  const stopOrder = data.optimizedWaypoints?.length
    ? [...data.optimizedWaypoints]
        .sort((a, b) => a.optimizedIndex - b.optimizedIndex)
        .map((w) => w.providedIndex)
    : Array.from({ length: intermediates }, (_, i) => i);

  const s = route.summary;
  return {
    path,
    legs: route.legs.map((leg) => ({
      distanceKm: roundTo(leg.summary.lengthInMeters / 1000, 1),
      durationMin: Math.round(leg.summary.travelTimeInSeconds / 60),
    })),
    distanceKm: roundTo(s.lengthInMeters / 1000, 1),
    durationMin: Math.round(s.travelTimeInSeconds / 60),
    durationNoTrafficMin:
      s.noTrafficTravelTimeInSeconds === undefined
        ? null
        : Math.round(s.noTrafficTravelTimeInSeconds / 60),
    trafficDelayMin: Math.round((s.trafficDelayInSeconds ?? 0) / 60),
    departureAt: s.departureTime ?? null,
    arrivalAt: s.arrivalTime ?? null,
    traffic: sections
      .filter((section) => section.sectionType === 'TRAFFIC')
      .map((section) => ({
        path: slice(section),
        severity: severity(section),
        category: CATEGORY_LABEL[section.simpleCategory ?? 'OTHER'] ?? 'Incidente',
        delayMin: Math.round((section.delayInSeconds ?? 0) / 60),
        speedKmh: section.effectiveSpeedInKmh ?? null,
      })),
    tollPaths,
    tollKm: roundTo(
      tollPaths.reduce((sum, p) => sum + pathKm(p), 0),
      1,
    ),
    instructions: (route.guidance?.instructions ?? []).map((i) => ({
      message: i.message ?? i.maneuver ?? '',
      street: i.street ?? null,
      maneuver: i.maneuver ?? '',
      point: toLatLng(i.point),
      offsetKm: roundTo((i.routeOffsetInMeters ?? 0) / 1000, 1),
    })),
    stopOrder,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TomTomRoadRouter implements RoadRouter {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    apiKey: string,
    fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  ) {
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
  }

  async route(request: RoadRouteRequest): Promise<RoadRoute> {
    if (!this.apiKey) {
      throw new DomainError(
        'CLAVE_MAPA_FALTANTE',
        'Falta la clave de TomTom: péguela en «Mapa base» debajo del mapa.',
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(buildCalculateRouteUrl(request, this.apiKey));
    } catch {
      throw new DomainError(
        'SIN_CONEXION_MAPAS',
        'No se pudo conectar con TomTom. Revise la conexión a internet.',
      );
    }
    const body = (await response.json().catch(() => null)) as TomTomResponse | null;
    if (response.status === 401 || response.status === 403) {
      throw new DomainError(
        'CLAVE_MAPA_INVALIDA',
        'TomTom rechazó la clave. Revise que esté bien copiada y activa en developer.tomtom.com.',
      );
    }
    if (response.status === 429) {
      throw new DomainError(
        'LIMITE_MAPAS',
        'TomTom limitó las consultas (máximo por segundo o cupo diario gratuito). Espere un momento y reintente.',
      );
    }
    if (!response.ok) {
      const detail = body?.error?.description ?? body?.detailedError?.message;
      throw new DomainError(
        'RUTA_NO_ENCONTRADA',
        detail
          ? `TomTom no pudo calcular la ruta: ${detail}`
          : `TomTom respondió ${response.status}.`,
      );
    }
    return parseCalculateRoute(body, request);
  }
}
