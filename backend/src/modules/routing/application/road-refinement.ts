import type { LatLng } from '../../../common/geo.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';
import { CO2_KG_PER_LITER_DIESEL } from '../domain/fuel.js';
import type { PlannedRoute } from '../domain/optimizer.js';
import type { RoadAdjustment } from '../domain/road-adjustment.js';
import { roadRouteFuelLiters, samplePath, type RoadRoute } from '../domain/road-route.js';
import type { RoadRouter } from './road-router.port.js';

export interface RefinedRoute {
  unitPlate: string;
  roadRoute: RoadRoute;
  /** Paradas del plan (índices) en el orden recomendado por calles. */
  stopOrder: number[];
  /** true si el orden por calles difiere del orden del plan. */
  reordered: boolean;
  fuelLiters: number;
  fuelCostClp: number;
  co2Kg: number;
}

/**
 * Ajusta una ruta del plan con calles y tráfico reales: pide al proveedor la ruta en el
 * orden del plan y, si hay dos o más paradas, también con las paradas reordenadas según
 * el tráfico. Se queda con la que gasta menos diésel con el modelo de carga por tramo
 * (a igual consumo, la más rápida).
 */
export async function refineWithRoads(
  route: PlannedRoute,
  depot: LatLng,
  vehicle: VehicleType,
  router: RoadRouter,
  dieselPriceClp: number,
): Promise<RefinedRoute> {
  const base = {
    points: [depot, ...route.stops.map((s) => s.location), depot],
    vehicle,
    loadKg: route.loadKg,
    avoidTolls: false,
  };
  const candidates = [await router.route({ ...base, optimizeOrder: false })];
  if (route.stops.length >= 2)
    candidates.push(await router.route({ ...base, optimizeOrder: true }));

  const evaluated = candidates.map((roadRoute) => {
    const weights = roadRoute.stopOrder.map((i) => route.stops[i]?.weightKg ?? 0);
    return { roadRoute, fuelLiters: roadRouteFuelLiters(roadRoute, vehicle, weights) };
  });
  const best = evaluated.sort(
    (a, b) => a.fuelLiters - b.fuelLiters || a.roadRoute.durationMin - b.roadRoute.durationMin,
  )[0];
  const order = best.roadRoute.stopOrder;
  return {
    unitPlate: route.unitPlate,
    roadRoute: best.roadRoute,
    stopOrder: order,
    reordered: order.some((stop, i) => stop !== i),
    fuelLiters: best.fuelLiters,
    fuelCostClp: Math.round(best.fuelLiters * dieselPriceClp),
    co2Kg: Math.round(best.fuelLiters * CO2_KG_PER_LITER_DIESEL * 10) / 10,
  };
}

/** Puntos del trazado que se guardan en el plan (suficiente para dibujarlo). */
const MAX_PLAN_PATH_POINTS = 800;

/** Datos para aplicar la ruta por calles al plan (`RoutePlanner.applyRoadAdjustment`). */
export function toRoadAdjustment(refined: RefinedRoute): RoadAdjustment {
  return roadAdjustmentFrom(refined.roadRoute, refined.stopOrder);
}

export function roadAdjustmentFrom(roadRoute: RoadRoute, stopOrder: number[]): RoadAdjustment {
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    stopOrder,
    legs: roadRoute.legs,
    path: samplePath(roadRoute.path, MAX_PLAN_PATH_POINTS).map((p) => ({
      lat: round(p.lat),
      lng: round(p.lng),
    })),
    trafficDelayMin: roadRoute.trafficDelayMin,
    tollKm: roadRoute.tollKm,
  };
}
