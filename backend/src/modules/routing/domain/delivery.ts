import type { LatLng } from '../../../common/geo.js';
import type { ProductLine } from '../../catalog/domain/product.js';
import {
  DEFAULT_CUBICAJE_OPTIONS,
  buildLoadProfile,
  evaluateVehicle,
} from '../../load-planning/domain/cubicaje.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';

export interface DeliverySite {
  id: string;
  name: string;
  commune: string;
  location: LatLng;
  hasUnloadingEquipment: boolean;
  /** Minutos de ETA a los que se avisa al capataz. */
  notifyEtaMinutes: number;
}

/** Pedido a entregar en una obra (nota de venta + líneas). */
export interface DeliveryOrder {
  id: string;
  site: DeliverySite;
  lines: ProductLine[];
}

/** Pedido listo para planificar rutas: carga calculada y vehículos que lo pueden llevar. */
export interface DeliveryRequest {
  id: string;
  site: DeliverySite;
  lines: ProductLine[];
  weightKg: number;
  volumeM3: number;
  /** Tipos de vehículo que cumplen el cubicaje del pedido (largo, pluma, capacidad, ejes). */
  allowedVehicleCodes: string[];
  /** Tiempo estimado de descarga en obra. */
  serviceMinutes: number;
}

/**
 * Aplica el cubicaje a un pedido para saber qué vehículos lo pueden llevar.
 * La descarga se estima en 15 min + 1 min por cada 100 kg.
 */
export function toDeliveryRequest(
  order: DeliveryOrder,
  fleet: readonly VehicleType[],
): DeliveryRequest {
  const options = {
    ...DEFAULT_CUBICAJE_OPTIONS,
    siteHasUnloadingEquipment: order.site.hasUnloadingEquipment,
  };
  const profile = buildLoadProfile(order.lines, options.manualHandlingLimitKg);
  return {
    id: order.id,
    site: order.site,
    lines: order.lines,
    weightKg: profile.totalWeightKg,
    volumeM3: profile.totalVolumeM3,
    allowedVehicleCodes: fleet
      .filter((vehicle) => evaluateVehicle(profile, vehicle, options).feasible)
      .map((vehicle) => vehicle.code),
    serviceMinutes: Math.round(15 + profile.totalWeightKg / 100),
  };
}
