import type { VehicleType } from '../domain/vehicle.js';

/** Puerto de lectura de los tipos de vehículo de la flota (tabla `vehicle_types`). */
export abstract class FleetCatalog {
  abstract list(): Promise<VehicleType[]>;
}
