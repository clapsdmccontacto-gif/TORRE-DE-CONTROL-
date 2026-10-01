export type AxleType = 'SIMPLE_RUEDA_SIMPLE' | 'SIMPLE_RUEDA_DOBLE' | 'DOBLE_RUEDA_DOBLE';

/**
 * Peso máximo legal por eje en Chile (DS 158/1980 del MOP). Son valores de referencia:
 * validar con la normativa vigente y con las restricciones propias de puentes y caminos
 * rurales, que pueden ser más estrictas.
 */
export const CHILE_LEGAL_AXLE_LIMIT_KG: Readonly<Record<AxleType, number>> = {
  SIMPLE_RUEDA_SIMPLE: 7_000,
  SIMPLE_RUEDA_DOBLE: 11_000,
  DOBLE_RUEDA_DOBLE: 18_000,
};

export interface AxleSpec {
  type: AxleType;
  /** Peso del vehículo vacío sobre este eje. */
  tareKg: number;
  /** Capacidad del eje según fabricante (GAWR). */
  ratingKg: number;
}

/** Tipo de vehículo de la flota (tabla `vehicle_types`). Distancias en metros. */
export interface VehicleType {
  code: string;
  name: string;
  /** 1 = el más pequeño. Desempata recomendaciones con igual costo. */
  sizeRank: number;
  /** Peso bruto vehicular (PBV) del fabricante. */
  gvwrKg: number;
  cargo: {
    lengthM: number;
    widthM: number;
    /** Altura máxima de carga estable (no la de la caja). */
    heightM: number;
    /** Fracción del volumen geométrico aprovechable con carga mixta (factor de estiba). */
    stowageFactor: number;
    /** Voladizo trasero permitido para cargas largas. */
    maxRearOverhangM: number;
  };
  wheelbaseM: number;
  /** Distancia desde el eje delantero hasta el inicio de la plataforma de carga. */
  cargoStartFromFrontAxleM: number;
  frontAxle: AxleSpec;
  rearAxle: AxleSpec;
  /** Capacidad de levante de la pluma; null si el vehículo no tiene pluma. */
  craneMaxLiftKg: number | null;
  /** Costo relativo por km (CLP); se usa para comparar alternativas, no para facturar. */
  costPerKm: number;
}

export function tareKg(vehicle: VehicleType): number {
  return vehicle.frontAxle.tareKg + vehicle.rearAxle.tareKg;
}

export function maxPayloadKg(vehicle: VehicleType): number {
  return vehicle.gvwrKg - tareKg(vehicle);
}

export function usableVolumeM3(vehicle: VehicleType): number {
  const { lengthM, widthM, heightM, stowageFactor } = vehicle.cargo;
  return lengthM * widthM * heightM * stowageFactor;
}

export function maxItemLengthM(vehicle: VehicleType): number {
  return vehicle.cargo.lengthM + vehicle.cargo.maxRearOverhangM;
}

/** Límite efectivo del eje: el menor entre el legal y el del fabricante. */
export function axleLimitKg(axle: AxleSpec): number {
  return Math.min(axle.ratingKg, CHILE_LEGAL_AXLE_LIMIT_KG[axle.type]);
}
