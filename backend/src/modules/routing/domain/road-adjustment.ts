import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { roundTo } from '../../../common/math.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';
import { CO2_KG_PER_LITER_DIESEL } from './fuel.js';
import type { PlannedRoute } from './optimizer.js';
import { roadRouteFuelLiters, type RoadLeg } from './road-route.js';

/** Resultado de la ruta por calles que se aplica a una ruta del plan. */
export interface RoadAdjustment {
  /** Orden de visita, como índices de las paradas actuales de la ruta. */
  stopOrder: number[];
  /** Tramos bodega → paradas → bodega, en el orden de visita. */
  legs: RoadLeg[];
  path: LatLng[];
  trafficDelayMin: number;
  tollKm: number;
}

/**
 * Reemplaza las estimaciones (línea recta × factor, velocidad media) de una ruta por las
 * de la ruta por calles: orden de paradas, trazado, horarios con tráfico, km y diésel.
 * El tiempo de descarga de cada parada se conserva.
 */
export function applyRoadAdjustment(
  route: PlannedRoute,
  adjustment: RoadAdjustment,
  vehicle: VehicleType,
  dieselPriceClp: number,
): PlannedRoute {
  const n = route.stops.length;
  const order = adjustment.stopOrder;
  const isPermutation =
    order.length === n &&
    new Set(order).size === n &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (!isPermutation) {
    throw new DomainError(
      'AJUSTE_INVALIDO',
      'El orden de paradas no corresponde a la ruta del plan.',
    );
  }
  if (adjustment.legs.length !== n + 1 || adjustment.path.length < 2) {
    throw new DomainError('AJUSTE_INVALIDO', 'La ruta por calles no cubre todas las paradas.');
  }

  let minutes = 0;
  const stops = order.map((index, i) => {
    const stop = route.stops[index];
    minutes += adjustment.legs[i].durationMin;
    const arrivalMin = minutes;
    minutes += stop.departureMin - stop.arrivalMin;
    return { ...stop, arrivalMin: Math.round(arrivalMin), departureMin: Math.round(minutes) };
  });
  minutes += adjustment.legs[n].durationMin;

  const fuelLiters = roadRouteFuelLiters(
    adjustment,
    vehicle,
    stops.map((s) => s.weightKg),
  );
  return {
    ...route,
    stops,
    path: adjustment.path,
    distanceKm: roundTo(
      adjustment.legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
      1,
    ),
    durationMin: Math.round(minutes),
    fuelLiters,
    fuelCostClp: Math.round(fuelLiters * dieselPriceClp),
    co2Kg: roundTo(fuelLiters * CO2_KG_PER_LITER_DIESEL, 1),
    road: {
      trafficDelayMin: Math.max(0, Math.round(adjustment.trafficDelayMin)),
      tollKm: roundTo(Math.max(0, adjustment.tollKm), 1),
    },
  };
}
