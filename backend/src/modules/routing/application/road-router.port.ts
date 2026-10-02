import type { LatLng } from '../../../common/geo.js';
import type { RoadRoute, RoadRouteRequest, RoadsideFeatures } from '../domain/road-route.js';

/** Proveedor de rutas por calles con tráfico (hoy TomTom). */
export interface RoadRouter {
  route(request: RoadRouteRequest): Promise<RoadRoute>;
}

/** Semáforos y plazas de peaje a lo largo de un trazado (hoy OpenStreetMap). */
export interface RoadsideLookup {
  features(path: readonly LatLng[]): Promise<RoadsideFeatures>;
}
