import type { RoadRouter } from '@core/modules/routing/application/road-router.port';
import {
  samplePath,
  type RoadRoute,
  type RoadRouteRequest,
} from '@core/modules/routing/domain/road-route';

const STORAGE_KEY = 'torre-control.road-cache';
const TTL_MS = 3 * 3_600_000;
const MAX_ENTRIES = 24;
const MAX_PATH_POINTS = 800;

interface Entry {
  at: number;
  route: RoadRoute;
}

function read(): Record<string, Entry> {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Entry>) ?? {};
  } catch {
    return {};
  }
}

function write(entries: Record<string, Entry>): void {
  try {
    const newest = Object.entries(entries)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Sin almacenamiento (o lleno): la próxima vez se vuelve a consultar.
  }
}

function cacheKey(request: RoadRouteRequest): string {
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return JSON.stringify([
    request.points.map((p) => [round(p.lat), round(p.lng)]),
    request.vehicle.code,
    Math.round(request.loadKg),
    request.optimizeOrder,
    request.avoidTolls,
  ]);
}

/**
 * Guarda en el dispositivo las rutas por calles ya consultadas (3 h) para no gastar el
 * cupo diario de TomTom cada vez que se abre la app. Se guarda el trazado reducido y
 * sin indicaciones: sirve para dibujar y simular, no para navegar.
 */
export class CachedRoadRouter implements RoadRouter {
  private readonly inner: RoadRouter;

  constructor(inner: RoadRouter) {
    this.inner = inner;
  }

  async route(request: RoadRouteRequest): Promise<RoadRoute> {
    const key = cacheKey(request);
    const hit = read()[key];
    if (hit && Date.now() - hit.at < TTL_MS) return hit.route;
    const route = await this.inner.route(request);
    write({
      ...read(),
      [key]: {
        at: Date.now(),
        route: { ...route, path: samplePath(route.path, MAX_PATH_POINTS), instructions: [] },
      },
    });
    return route;
  }
}
