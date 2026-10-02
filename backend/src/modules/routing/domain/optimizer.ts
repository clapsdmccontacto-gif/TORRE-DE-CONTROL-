import { distanceMeters, type LatLng } from '../../../common/geo.js';
import { roundTo } from '../../../common/math.js';
import {
  maxPayloadKg,
  usableVolumeM3,
  type VehicleType,
} from '../../load-planning/domain/vehicle.js';
import type { DeliveryRequest } from './delivery.js';
import { CO2_KG_PER_LITER_DIESEL, legLiters } from './fuel.js';

/** Un vehículo físico de la flota (patente + tipo). */
export interface FleetUnit {
  plate: string;
  vehicle: VehicleType;
}

export interface RoutingOptions {
  depot: LatLng;
  /** Distancia por calle ≈ línea recta × este factor (hasta conectar un motor de ruteo). */
  circuityFactor: number;
  averageSpeedKmh: number;
  dieselPriceClp: number;
}

export const DEFAULT_ROUTING_OPTIONS: Omit<RoutingOptions, 'depot'> = {
  circuityFactor: 1.3,
  averageSpeedKmh: 45,
  dieselPriceClp: 1_050,
};

export interface PlannedStop {
  deliveryId: string;
  siteName: string;
  commune: string;
  location: LatLng;
  notifyEtaMinutes: number;
  /** Minutos desde la salida de bodega. */
  arrivalMin: number;
  departureMin: number;
  weightKg: number;
  lines: { sku: string; name: string; quantity: number }[];
}

export interface PlannedRoute {
  unitPlate: string;
  vehicleCode: string;
  vehicleName: string;
  stops: PlannedStop[];
  /** Bodega → obras → bodega, para dibujar en el mapa. */
  path: LatLng[];
  loadKg: number;
  weightUtilization: number;
  distanceKm: number;
  durationMin: number;
  fuelLiters: number;
  fuelCostClp: number;
  co2Kg: number;
  /** null = distancias estimadas; con datos = ajustada con calles y tráfico reales. */
  road: RoadSummary | null;
}

export interface RoadSummary {
  trafficDelayMin: number;
  tollKm: number;
}

export interface PlanTotals {
  routes: number;
  distanceKm: number;
  fuelLiters: number;
  fuelCostClp: number;
  co2Kg: number;
}

export interface OptimizationResult {
  routes: PlannedRoute[];
  unassigned: { deliveryId: string; siteName: string; reason: string }[];
  totals: PlanTotals;
  /** Referencia: despacho manual en orden de llegada, primer camión que sirva, sin reordenar. */
  baseline: PlanTotals & { unassigned: number };
  savings: { fuelLiters: number; fuelCostClp: number; co2Kg: number; pct: number };
}

interface Draft {
  unit: FleetUnit;
  stops: DeliveryRequest[];
}

interface Solution {
  drafts: Draft[];
  unassigned: DeliveryRequest[];
}

const EPSILON = 1e-9;

/**
 * Asigna y ordena las entregas del día para minimizar el diésel consumido.
 *
 * Optimización heurística en dos fases, la técnica habitual de los TMS:
 * 1. Construcción por inserción más barata: primero los pedidos más restringidos
 *    (menos vehículos posibles, más pesados), cada uno donde menos litros agrega.
 * 2. Búsqueda local hasta que nada mejora: 2-opt (invertir tramos de una ruta) y
 *    reubicación de entregas entre camiones.
 *
 * El consumo depende de la carga a bordo en cada tramo, así que el orden importa:
 * conviene descargar lo pesado temprano. Se parte también desde el despacho manual
 * y se queda con la mejor solución, de modo que nunca resulta peor que la referencia.
 */
export function optimizeRoutes(
  deliveries: readonly DeliveryRequest[],
  units: readonly FleetUnit[],
  options: RoutingOptions,
): OptimizationResult {
  const baseline = manualDispatch(deliveries, units);
  const candidates = [constructGreedy(deliveries, units, options), clone(baseline)].map((s) =>
    improve(s, options),
  );
  const best = candidates.sort(
    (a, b) =>
      a.unassigned.length - b.unassigned.length ||
      solutionLiters(a, options) - solutionLiters(b, options),
  )[0];

  const totals = summarize(best, options);
  const baselineTotals = summarize(baseline, options);
  return {
    routes: best.drafts.filter((d) => d.stops.length > 0).map((d) => describeRoute(d, options)),
    unassigned: best.unassigned.map((d) => ({
      deliveryId: d.id,
      siteName: d.site.name,
      reason:
        d.allowedVehicleCodes.length === 0
          ? 'Ningún tipo de vehículo de la flota cumple el cubicaje de este pedido.'
          : 'No queda capacidad en los vehículos compatibles; programar un segundo viaje.',
    })),
    totals,
    baseline: { ...baselineTotals, unassigned: baseline.unassigned.length },
    savings: {
      fuelLiters: roundTo(baselineTotals.fuelLiters - totals.fuelLiters, 1),
      fuelCostClp: Math.round(baselineTotals.fuelCostClp - totals.fuelCostClp),
      co2Kg: roundTo(baselineTotals.co2Kg - totals.co2Kg, 1),
      pct:
        baselineTotals.fuelLiters > 0
          ? roundTo(1 - totals.fuelLiters / baselineTotals.fuelLiters, 3)
          : 0,
    },
  };
}

function legKm(a: LatLng, b: LatLng, options: RoutingOptions): number {
  return (distanceMeters(a, b) * options.circuityFactor) / 1000;
}

function routeLiters(
  unit: FleetUnit,
  stops: readonly DeliveryRequest[],
  options: RoutingOptions,
): number {
  const payload = maxPayloadKg(unit.vehicle);
  let load = stops.reduce((sum, s) => sum + s.weightKg, 0);
  let at = options.depot;
  let liters = 0;
  for (const stop of stops) {
    liters += legLiters(legKm(at, stop.site.location, options), unit.vehicle.fuel, load, payload);
    load -= stop.weightKg;
    at = stop.site.location;
  }
  return liters + legLiters(legKm(at, options.depot, options), unit.vehicle.fuel, 0, payload);
}

function fits(unit: FleetUnit, stops: readonly DeliveryRequest[]): boolean {
  const weight = stops.reduce((sum, s) => sum + s.weightKg, 0);
  const volume = stops.reduce((sum, s) => sum + s.volumeM3, 0);
  return (
    weight <= maxPayloadKg(unit.vehicle) &&
    volume <= usableVolumeM3(unit.vehicle) &&
    stops.every((s) => s.allowedVehicleCodes.includes(unit.vehicle.code))
  );
}

function solutionLiters(solution: Solution, options: RoutingOptions): number {
  return solution.drafts.reduce((sum, d) => sum + routeLiters(d.unit, d.stops, options), 0);
}

function clone(solution: Solution): Solution {
  return {
    drafts: solution.drafts.map((d) => ({ unit: d.unit, stops: [...d.stops] })),
    unassigned: [...solution.unassigned],
  };
}

/** Mejor posición para insertar `delivery` en `draft`, o null si no cabe o no está permitido. */
function bestPosition(
  draft: Draft,
  delivery: DeliveryRequest,
  options: RoutingOptions,
): { index: number; delta: number } | null {
  if (!fits(draft.unit, [...draft.stops, delivery])) return null;
  const base = routeLiters(draft.unit, draft.stops, options);
  let best: { index: number; delta: number } | null = null;
  for (let index = 0; index <= draft.stops.length; index++) {
    const candidate = [...draft.stops.slice(0, index), delivery, ...draft.stops.slice(index)];
    const delta = routeLiters(draft.unit, candidate, options) - base;
    if (!best || delta < best.delta - EPSILON) best = { index, delta };
  }
  return best;
}

function constructGreedy(
  deliveries: readonly DeliveryRequest[],
  units: readonly FleetUnit[],
  options: RoutingOptions,
): Solution {
  const drafts: Draft[] = units.map((unit) => ({ unit, stops: [] }));
  const unassigned: DeliveryRequest[] = [];
  const ordered = [...deliveries].sort(
    (a, b) =>
      a.allowedVehicleCodes.length - b.allowedVehicleCodes.length ||
      b.weightKg - a.weightKg ||
      a.id.localeCompare(b.id),
  );
  for (const delivery of ordered) {
    let best: { draft: Draft; index: number; delta: number } | null = null;
    for (const draft of drafts) {
      const position = bestPosition(draft, delivery, options);
      if (position && (!best || position.delta < best.delta - EPSILON))
        best = { draft, ...position };
    }
    if (best) best.draft.stops.splice(best.index, 0, delivery);
    else unassigned.push(delivery);
  }
  return { drafts, unassigned };
}

/** Despacho manual de referencia: orden de nota de venta, primer camión que sirva. */
function manualDispatch(
  deliveries: readonly DeliveryRequest[],
  units: readonly FleetUnit[],
): Solution {
  const drafts: Draft[] = units.map((unit) => ({ unit, stops: [] }));
  const unassigned: DeliveryRequest[] = [];
  for (const delivery of [...deliveries].sort((a, b) => a.id.localeCompare(b.id))) {
    const draft = drafts.find((d) => fits(d.unit, [...d.stops, delivery]));
    if (draft) draft.stops.push(delivery);
    else unassigned.push(delivery);
  }
  return { drafts, unassigned };
}

function improve(solution: Solution, options: RoutingOptions): Solution {
  const result = clone(solution);
  for (let round = 0; round < 50; round++) {
    let improved = false;
    for (const draft of result.drafts) improved = twoOpt(draft, options) || improved;
    improved = relocate(result.drafts, options) || improved;
    improved = insertUnassigned(result, options) || improved;
    if (!improved) break;
  }
  return result;
}

function twoOpt(draft: Draft, options: RoutingOptions): boolean {
  let changed = false;
  let best = routeLiters(draft.unit, draft.stops, options);
  for (let i = 0; i < draft.stops.length - 1; i++) {
    for (let j = i + 1; j < draft.stops.length; j++) {
      const candidate = [
        ...draft.stops.slice(0, i),
        ...draft.stops.slice(i, j + 1).reverse(),
        ...draft.stops.slice(j + 1),
      ];
      const cost = routeLiters(draft.unit, candidate, options);
      if (cost < best - EPSILON) {
        draft.stops = candidate;
        best = cost;
        changed = true;
      }
    }
  }
  return changed;
}

function relocate(drafts: Draft[], options: RoutingOptions): boolean {
  for (const from of drafts) {
    for (let k = 0; k < from.stops.length; k++) {
      const delivery = from.stops[k];
      const remaining = from.stops.filter((_, i) => i !== k);
      const saved =
        routeLiters(from.unit, from.stops, options) - routeLiters(from.unit, remaining, options);
      for (const to of drafts) {
        if (to === from) continue;
        const position = bestPosition(to, delivery, options);
        if (position && position.delta < saved - EPSILON) {
          from.stops = remaining;
          to.stops.splice(position.index, 0, delivery);
          return true;
        }
      }
    }
  }
  return false;
}

function insertUnassigned(solution: Solution, options: RoutingOptions): boolean {
  let changed = false;
  for (const delivery of solution.unassigned) {
    let best: { draft: Draft; index: number; delta: number } | null = null;
    for (const draft of solution.drafts) {
      const position = bestPosition(draft, delivery, options);
      if (position && (!best || position.delta < best.delta - EPSILON))
        best = { draft, ...position };
    }
    if (best) {
      best.draft.stops.splice(best.index, 0, delivery);
      solution.unassigned = solution.unassigned.filter((d) => d !== delivery);
      changed = true;
    }
  }
  return changed;
}

function summarize(solution: Solution, options: RoutingOptions): PlanTotals {
  return planTotals(
    solution.drafts.filter((d) => d.stops.length > 0).map((d) => describeRoute(d, options)),
  );
}

export function planTotals(routes: readonly PlannedRoute[]): PlanTotals {
  const liters = routes.reduce((sum, r) => sum + r.fuelLiters, 0);
  return {
    routes: routes.length,
    distanceKm: roundTo(
      routes.reduce((sum, r) => sum + r.distanceKm, 0),
      1,
    ),
    fuelLiters: roundTo(liters, 1),
    fuelCostClp: Math.round(routes.reduce((sum, r) => sum + r.fuelCostClp, 0)),
    co2Kg: roundTo(
      routes.reduce((sum, r) => sum + r.co2Kg, 0),
      1,
    ),
  };
}

function describeRoute(draft: Draft, options: RoutingOptions): PlannedRoute {
  const { unit, stops } = draft;
  let at = options.depot;
  let minutes = 0;
  let km = 0;
  const planned: PlannedStop[] = stops.map((stop) => {
    const leg = legKm(at, stop.site.location, options);
    km += leg;
    minutes += (leg / options.averageSpeedKmh) * 60;
    const arrivalMin = minutes;
    minutes += stop.serviceMinutes;
    at = stop.site.location;
    return {
      deliveryId: stop.id,
      siteName: stop.site.name,
      commune: stop.site.commune,
      location: stop.site.location,
      notifyEtaMinutes: stop.site.notifyEtaMinutes,
      arrivalMin: Math.round(arrivalMin),
      departureMin: Math.round(minutes),
      weightKg: roundTo(stop.weightKg, 1),
      lines: stop.lines.map((l) => ({
        sku: l.product.sku,
        name: l.product.name,
        quantity: l.quantity,
      })),
    };
  });
  const back = legKm(at, options.depot, options);
  km += back;
  minutes += (back / options.averageSpeedKmh) * 60;

  const liters = routeLiters(unit, stops, options);
  const loadKg = stops.reduce((sum, s) => sum + s.weightKg, 0);
  return {
    unitPlate: unit.plate,
    vehicleCode: unit.vehicle.code,
    vehicleName: unit.vehicle.name,
    stops: planned,
    path: [options.depot, ...stops.map((s) => s.site.location), options.depot],
    loadKg: roundTo(loadKg, 1),
    weightUtilization: roundTo(loadKg / maxPayloadKg(unit.vehicle), 3),
    distanceKm: roundTo(km, 1),
    durationMin: Math.round(minutes),
    fuelLiters: roundTo(liters, 1),
    fuelCostClp: Math.round(liters * options.dieselPriceClp),
    co2Kg: roundTo(liters * CO2_KG_PER_LITER_DIESEL, 1),
    road: null,
  };
}
