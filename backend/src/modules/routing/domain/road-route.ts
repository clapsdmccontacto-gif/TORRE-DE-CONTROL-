import { distanceMeters, type LatLng } from '../../../common/geo.js';
import { roundTo } from '../../../common/math.js';
import {
  axleLimitKg,
  maxPayloadKg,
  tareKg,
  type VehicleType,
} from '../../load-planning/domain/vehicle.js';
import { legLiters } from './fuel.js';

/** Pedido de ruta por calles: bodega/posición actual → paradas → destino. */
export interface RoadRouteRequest {
  /** Origen, paradas intermedias y destino, en orden. */
  points: LatLng[];
  vehicle: VehicleType;
  /** Carga a bordo al salir (kg): define el peso del camión para las restricciones. */
  loadKg: number;
  /** Deja que el proveedor reordene las paradas intermedias (origen y destino fijos). */
  optimizeOrder: boolean;
  avoidTolls: boolean;
}

export interface RoadInstruction {
  message: string;
  street: string | null;
  maneuver: string;
  point: LatLng;
  /** Distancia desde el origen hasta la maniobra. */
  offsetKm: number;
}

export type TrafficSeverity = 'LEVE' | 'MODERADA' | 'ALTA' | 'CERRADO';

/** Tramo con congestión, obras o cierre según el tráfico en vivo. */
export interface TrafficSpan {
  path: LatLng[];
  severity: TrafficSeverity;
  category: string;
  delayMin: number;
  speedKmh: number | null;
}

export interface RoadLeg {
  distanceKm: number;
  durationMin: number;
}

export interface RoadRoute {
  /** Trazado por las calles, listo para dibujar. */
  path: LatLng[];
  legs: RoadLeg[];
  distanceKm: number;
  /** Duración con el tráfico en vivo. */
  durationMin: number;
  durationNoTrafficMin: number | null;
  trafficDelayMin: number;
  departureAt: string | null;
  arrivalAt: string | null;
  traffic: TrafficSpan[];
  /** Tramos con peaje (trazado) y su largo total. */
  tollPaths: LatLng[][];
  tollKm: number;
  instructions: RoadInstruction[];
  /**
   * Orden en que se visitan las paradas intermedias, como índices del pedido original
   * (0 = primera parada intermedia). Igual al original si no se pidió reordenar.
   */
  stopOrder: number[];
}

/** Elementos junto a la ruta tomados de OpenStreetMap. */
export interface RoadsideFeatures {
  /** Un punto por intersección con semáforo (OSM marca cada acceso por separado). */
  trafficSignals: LatLng[];
  tollBooths: { name: string | null; location: LatLng }[];
}

export interface TruckProfile {
  travelMode: 'car' | 'truck';
  grossWeightKg: number;
  maxAxleLoadKg: number;
  commercial: boolean;
}

/** Sobre 3,5 t de peso bruto vehicular el ruteo aplica restricciones de camión. */
const TRUCK_FROM_GVWR_KG = 3_500;

export function truckProfile(vehicle: VehicleType, loadKg: number): TruckProfile {
  const payload = Math.min(Math.max(loadKg, 0), maxPayloadKg(vehicle));
  return {
    travelMode: vehicle.gvwrKg > TRUCK_FROM_GVWR_KG ? 'truck' : 'car',
    grossWeightKg: Math.round(tareKg(vehicle) + payload),
    maxAxleLoadKg: Math.max(axleLimitKg(vehicle.frontAxle), axleLimitKg(vehicle.rearAxle)),
    commercial: true,
  };
}

/**
 * Diésel de una ruta por calles con el mismo modelo del optimizador: cada tramo con la
 * carga que va a bordo (se descarga en cada parada).
 * @param stopWeightsKg peso que se entrega en cada parada, en el orden recorrido.
 */
export function roadRouteFuelLiters(
  route: Pick<RoadRoute, 'legs'>,
  vehicle: VehicleType,
  stopWeightsKg: readonly number[],
): number {
  const payload = maxPayloadKg(vehicle);
  let load = stopWeightsKg.reduce((sum, w) => sum + w, 0);
  let liters = 0;
  route.legs.forEach((leg, i) => {
    liters += legLiters(leg.distanceKm, vehicle.fuel, load, payload);
    load = Math.max(0, load - (stopWeightsKg[i] ?? 0));
  });
  return roundTo(liters, 1);
}

/** Reduce el trazado a `maxPoints` puntos repartidos a lo largo (para consultas externas). */
export function samplePath(path: readonly LatLng[], maxPoints: number): LatLng[] {
  if (path.length <= maxPoints) return [...path];
  const step = (path.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => path[Math.round(i * step)]);
}

/** Agrupa puntos cercanos (p. ej. los semáforos de cada acceso de una misma esquina). */
export function clusterPoints(points: readonly LatLng[], radiusM: number): LatLng[] {
  const clusters: { center: LatLng; members: LatLng[] }[] = [];
  for (const point of points) {
    const cluster = clusters.find((c) => distanceMeters(c.center, point) <= radiusM);
    if (cluster) {
      cluster.members.push(point);
      const n = cluster.members.length;
      cluster.center = {
        lat: cluster.members.reduce((s, p) => s + p.lat, 0) / n,
        lng: cluster.members.reduce((s, p) => s + p.lng, 0) / n,
      };
    } else {
      clusters.push({ center: point, members: [point] });
    }
  }
  return clusters.map((c) => c.center);
}

/**
 * Lo que falta de un trazado visto desde la posición actual: desde el punto más cercano
 * en adelante. Para dibujar la ruta restante sin volver a consultar a cada lectura GPS.
 */
export function remainingPath(path: readonly LatLng[], position: LatLng): LatLng[] {
  if (path.length === 0) return [];
  let nearest = 0;
  let best = Infinity;
  path.forEach((point, i) => {
    const d = distanceMeters(point, position);
    if (d < best) {
      best = d;
      nearest = i;
    }
  });
  return [position, ...path.slice(nearest + 1)];
}

/** Largo de un trazado en km. */
export function pathKm(path: readonly LatLng[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) meters += distanceMeters(path[i - 1], path[i]);
  return meters / 1000;
}

/** Enlaces para navegar con voz en el teléfono del conductor (no requieren clave). */
export function navigationLinks(destination: LatLng): { waze: string; googleMaps: string } {
  const ll = `${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`;
  return {
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
  };
}
