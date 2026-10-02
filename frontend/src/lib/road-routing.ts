import { DEFAULT_FLEET } from '@core/modules/load-planning/infrastructure/default-fleet';
import {
  refineWithRoads,
  toRoadAdjustment,
  type RefinedRoute,
} from '@core/modules/routing/application/road-refinement';
import { OverpassRoadsideLookup } from '@core/modules/routing/infrastructure/overpass';
import { TomTomRoadRouter } from '@core/modules/routing/infrastructure/tomtom';
import { tomtomKey } from '@/components/map/basemaps';
import { api } from '@/lib/api';
import type { LatLng, PlannedRoute, RoadRoute, RoadsideFeatures, RoutePlan } from '@/types/api';

/**
 * Rutas por calles con tráfico. Se calculan desde el navegador con la clave de TomTom de
 * este dispositivo (igual en modo local y con servidor); semáforos y casetas de peaje
 * vienen de OpenStreetMap. Sólo el resultado aplicado a un plan pasa por `TorreApi`.
 */
export const ROUTING_VEHICLES = DEFAULT_FLEET;

const vehicleByCode = (code: string) => DEFAULT_FLEET.find((v) => v.code === code);

/** Tipo de vehículo de una unidad en ruta (por nombre); por defecto, el camión 3/4. */
export function vehicleCodeFor(vehicleName: string | null | undefined): string {
  return DEFAULT_FLEET.find((v) => v.name === vehicleName)?.code ?? 'CAMION_3_4';
}

export interface StreetRouteQuery {
  origin: LatLng;
  originLabel: string;
  destination: LatLng;
  vehicleCode: string;
  loadKg: number;
  avoidTolls: boolean;
}

export interface StreetRouteResult {
  route: RoadRoute;
  /** null mientras OpenStreetMap no responde o si falló (ver `roadsideError`). */
  roadside: RoadsideFeatures | null;
  roadsideError: string | null;
}

function router(): TomTomRoadRouter {
  return new TomTomRoadRouter(tomtomKey());
}

export async function streetRoute(query: StreetRouteQuery): Promise<RoadRoute> {
  return router().route({
    points: [query.origin, query.destination],
    vehicle: vehicleByCode(query.vehicleCode) ?? DEFAULT_FLEET[1],
    loadKg: query.loadKg,
    optimizeOrder: false,
    avoidTolls: query.avoidTolls,
  });
}

export async function roadsideFeatures(path: readonly LatLng[]): Promise<RoadsideFeatures> {
  return new OverpassRoadsideLookup().features(path);
}

/**
 * Ajusta una ruta del plan con calles y tráfico reales (orden que gasta menos diésel) y
 * guarda el resultado en el plan.
 */
export async function adjustPlanRoute(
  plan: RoutePlan,
  route: PlannedRoute,
): Promise<{ plan: RoutePlan; refined: RefinedRoute }> {
  const vehicle = vehicleByCode(route.vehicleCode) ?? DEFAULT_FLEET[1];
  const refined = await refineWithRoads(
    route,
    plan.depot.location,
    vehicle,
    router(),
    plan.dieselPriceClp,
  );
  const updated = await api.applyRoadAdjustment(
    plan.id,
    route.unitPlate,
    toRoadAdjustment(refined),
  );
  return { plan: updated, refined };
}
