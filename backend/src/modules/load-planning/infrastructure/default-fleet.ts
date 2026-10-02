import type { VehicleType } from '../domain/vehicle.js';

/**
 * Tipos de vehículo (no camiones de prueba: las patentes las carga la empresa en «Flota y
 * bodega»). Las especificaciones son representativas de cada segmento; reemplazarlas por
 * las fichas técnicas de los vehículos reales de Constructor Center.
 */
export const DEFAULT_FLEET: readonly VehicleType[] = [
  {
    code: 'CAMIONETA',
    name: 'Camioneta 4x2',
    sizeRank: 1,
    gvwrKg: 2_910,
    cargo: { lengthM: 1.55, widthM: 1.5, heightM: 0.8, stowageFactor: 0.85, maxRearOverhangM: 0.3 },
    wheelbaseM: 3.085,
    cargoStartFromFrontAxleM: 2.3,
    frontAxle: { type: 'SIMPLE_RUEDA_SIMPLE', tareKg: 1_130, ratingKg: 1_300 },
    rearAxle: { type: 'SIMPLE_RUEDA_SIMPLE', tareKg: 790, ratingKg: 1_850 },
    craneMaxLiftKg: null,
    costPerKm: 450,
    fuel: { emptyLitersPer100Km: 9.5, fullLitersPer100Km: 12.5 },
  },
  {
    code: 'CAMION_3_4',
    name: 'Camión 3/4 plataforma',
    sizeRank: 2,
    gvwrKg: 6_500,
    cargo: { lengthM: 4.4, widthM: 2.0, heightM: 1.8, stowageFactor: 0.85, maxRearOverhangM: 1.0 },
    wheelbaseM: 3.36,
    cargoStartFromFrontAxleM: 0.6,
    frontAxle: { type: 'SIMPLE_RUEDA_SIMPLE', tareKg: 1_650, ratingKg: 2_600 },
    rearAxle: { type: 'SIMPLE_RUEDA_DOBLE', tareKg: 1_100, ratingKg: 4_800 },
    craneMaxLiftKg: null,
    costPerKm: 900,
    fuel: { emptyLitersPer100Km: 15, fullLitersPer100Km: 21 },
  },
  {
    code: 'CAMION_PLUMA',
    name: 'Camión pluma',
    sizeRank: 3,
    gvwrKg: 16_000,
    cargo: { lengthM: 6.0, widthM: 2.45, heightM: 1.5, stowageFactor: 0.85, maxRearOverhangM: 1.0 },
    wheelbaseM: 4.9,
    cargoStartFromFrontAxleM: 1.4,
    frontAxle: { type: 'SIMPLE_RUEDA_SIMPLE', tareKg: 4_600, ratingKg: 6_000 },
    rearAxle: { type: 'SIMPLE_RUEDA_DOBLE', tareKg: 3_900, ratingKg: 11_000 },
    craneMaxLiftKg: 2_000,
    costPerKm: 1_600,
    fuel: { emptyLitersPer100Km: 27, fullLitersPer100Km: 37 },
  },
];
