import { DomainError } from '../../../common/domain-error.js';
import { roundTo } from '../../../common/math.js';
import {
  assertValidLine,
  longestSideCm,
  unitVolumeM3,
  type ProductLine,
} from '../../catalog/domain/product.js';
import { computeAxleLoads, maxPayloadWithinAxleLimits, type AxleLoads } from './axle-load.js';
import { maxItemLengthM, maxPayloadKg, usableVolumeM3, type VehicleType } from './vehicle.js';

export interface CubicajeOptions {
  /** Peso máximo por unidad para descarga manual (Ley 20.949: 25 kg). */
  manualHandlingLimitKg: number;
  /** La obra tiene grúa horquilla u otro equipo, por lo que no se exige camión pluma. */
  siteHasUnloadingEquipment: boolean;
  /** Centro de gravedad a lo largo de la plataforma (0 = cabina, 0,5 = centro, 1 = cola). */
  loadCenterRatio: number;
  /** Fracción mínima del peso total sobre el eje delantero para conservar dirección. */
  minFrontAxleShare: number;
}

export const DEFAULT_CUBICAJE_OPTIONS: CubicajeOptions = {
  manualHandlingLimitKg: 25,
  siteHasUnloadingEquipment: false,
  loadCenterRatio: 0.5,
  minFrontAxleShare: 0.2,
};

export interface LoadProfile {
  lineCount: number;
  totalUnits: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  longestItemM: number;
  heaviestUnitKg: number;
  /** SKUs que no se pueden descargar a mano (sobre el límite manual o marcados en el maestro). */
  mechanicalUnloadSkus: string[];
}

export type CubicajeIssueCode =
  | 'EXCEDE_CARGA_UTIL'
  | 'EXCEDE_VOLUMEN'
  | 'EXCEDE_LARGO'
  | 'REQUIERE_PLUMA'
  | 'EXCEDE_CAPACIDAD_PLUMA'
  | 'SOBRECARGA_EJE_DELANTERO'
  | 'SOBRECARGA_EJE_TRASERO'
  | 'EJE_DELANTERO_DESCARGADO';

/** Problemas que se resuelven repartiendo la carga en más viajes. */
const DIVISIBLE_ISSUES: ReadonlySet<CubicajeIssueCode> = new Set([
  'EXCEDE_CARGA_UTIL',
  'EXCEDE_VOLUMEN',
  'SOBRECARGA_EJE_DELANTERO',
  'SOBRECARGA_EJE_TRASERO',
  'EJE_DELANTERO_DESCARGADO',
]);

export interface CubicajeIssue {
  code: CubicajeIssueCode;
  message: string;
}

export interface VehicleEvaluation {
  vehicleCode: string;
  vehicleName: string;
  feasible: boolean;
  weightUtilization: number;
  volumeUtilization: number;
  axleLoads: AxleLoads;
  issues: CubicajeIssue[];
}

export interface SplitSuggestion {
  vehicleCode: string;
  vehicleName: string;
  trips: number;
  maxPayloadPerTripKg: number;
  message: string;
}

export interface CubicajeResult {
  profile: LoadProfile;
  /** Vehículo factible de menor costo; null si la carga no cabe en un solo viaje. */
  recommendation: VehicleEvaluation | null;
  /** Evaluación de toda la flota, del vehículo más pequeño al más grande. */
  evaluations: VehicleEvaluation[];
  /** Sólo cuando no hay recomendación y la carga se puede dividir. */
  splitSuggestion: SplitSuggestion | null;
}

/**
 * Cubicaje previo al despacho: calcula peso, volumen, largo y necesidad de descarga
 * mecánica de la carga, evalúa cada tipo de vehículo de la flota (incluidos los límites
 * por eje) y recomienda el factible de menor costo por km.
 *
 * Las restricciones de circulación (horarios, zonas, puentes) no se evalúan aquí: el
 * llamador filtra la flota según la matriz de restricción antes de invocar esta función.
 */
export function planLoad(
  lines: readonly ProductLine[],
  fleet: readonly VehicleType[],
  overrides: Partial<CubicajeOptions> = {},
): CubicajeResult {
  const options = { ...DEFAULT_CUBICAJE_OPTIONS, ...overrides };
  const profile = buildLoadProfile(lines, options.manualHandlingLimitKg);
  const vehicles = [...fleet].sort((a, b) => a.sizeRank - b.sizeRank);
  const evaluations = vehicles.map((v) => evaluateVehicle(profile, v, options));

  const recommendation =
    vehicles
      .map((vehicle, i) => ({ vehicle, evaluation: evaluations[i] }))
      .filter(({ evaluation }) => evaluation.feasible)
      .sort(
        (a, b) =>
          a.vehicle.costPerKm - b.vehicle.costPerKm || a.vehicle.sizeRank - b.vehicle.sizeRank,
      )
      .at(0)?.evaluation ?? null;

  return {
    profile: roundProfile(profile),
    recommendation,
    evaluations,
    splitSuggestion: recommendation ? null : suggestSplit(profile, vehicles, evaluations, options),
  };
}

export function buildLoadProfile(
  lines: readonly ProductLine[],
  manualHandlingLimitKg: number,
): LoadProfile {
  if (lines.length === 0) {
    throw new DomainError('CARGA_VACIA', 'La carga no tiene líneas.');
  }
  lines.forEach(assertValidLine);

  const mechanical = lines
    .filter(
      ({ product }) =>
        product.requiresMechanicalUnload || product.unitWeightKg > manualHandlingLimitKg,
    )
    .map(({ product }) => product.sku);

  return {
    lineCount: lines.length,
    totalUnits: lines.reduce((sum, l) => sum + l.quantity, 0),
    totalWeightKg: lines.reduce((sum, l) => sum + l.quantity * l.product.unitWeightKg, 0),
    totalVolumeM3: lines.reduce((sum, l) => sum + l.quantity * unitVolumeM3(l.product), 0),
    longestItemM: Math.max(...lines.map((l) => longestSideCm(l.product))) / 100,
    heaviestUnitKg: Math.max(...lines.map((l) => l.product.unitWeightKg)),
    mechanicalUnloadSkus: [...new Set(mechanical)],
  };
}

export function evaluateVehicle(
  profile: LoadProfile,
  vehicle: VehicleType,
  options: CubicajeOptions,
): VehicleEvaluation {
  const issues: CubicajeIssue[] = [];
  const payloadKg = maxPayloadKg(vehicle);
  const volumeM3 = usableVolumeM3(vehicle);
  const lengthM = maxItemLengthM(vehicle);
  const axleLoads = computeAxleLoads(vehicle, profile.totalWeightKg, options.loadCenterRatio);

  if (profile.totalWeightKg > payloadKg) {
    issues.push({
      code: 'EXCEDE_CARGA_UTIL',
      message: `La carga pesa ${fmt(profile.totalWeightKg)} kg y la carga útil es ${fmt(payloadKg)} kg.`,
    });
  }
  if (profile.totalVolumeM3 > volumeM3) {
    issues.push({
      code: 'EXCEDE_VOLUMEN',
      message: `La carga ocupa ${fmt(profile.totalVolumeM3, 2)} m³ y el vehículo aprovecha ${fmt(volumeM3, 2)} m³.`,
    });
  }
  if (profile.longestItemM > lengthM) {
    issues.push({
      code: 'EXCEDE_LARGO',
      message: `El ítem más largo mide ${fmt(profile.longestItemM, 2)} m y el vehículo admite ${fmt(lengthM, 2)} m (plataforma + voladizo).`,
    });
  }

  const needsCrane = profile.mechanicalUnloadSkus.length > 0 && !options.siteHasUnloadingEquipment;
  if (needsCrane && vehicle.craneMaxLiftKg === null) {
    issues.push({
      code: 'REQUIERE_PLUMA',
      message: `${profile.mechanicalUnloadSkus.join(', ')} requiere descarga mecánica y la obra no declara equipo de descarga.`,
    });
  }
  if (
    needsCrane &&
    vehicle.craneMaxLiftKg !== null &&
    profile.heaviestUnitKg > vehicle.craneMaxLiftKg
  ) {
    issues.push({
      code: 'EXCEDE_CAPACIDAD_PLUMA',
      message: `La unidad más pesada (${fmt(profile.heaviestUnitKg)} kg) supera la capacidad de la pluma (${fmt(vehicle.craneMaxLiftKg)} kg).`,
    });
  }

  // Con sobrepeso total, la sobrecarga de ejes es consecuencia y sólo agrega ruido.
  if (profile.totalWeightKg <= payloadKg) {
    if (axleLoads.frontKg > axleLoads.frontLimitKg) {
      issues.push({
        code: 'SOBRECARGA_EJE_DELANTERO',
        message: `El eje delantero quedaría con ${fmt(axleLoads.frontKg)} kg (límite ${fmt(axleLoads.frontLimitKg)} kg).`,
      });
    }
    if (axleLoads.rearKg > axleLoads.rearLimitKg) {
      issues.push({
        code: 'SOBRECARGA_EJE_TRASERO',
        message: `El eje trasero quedaría con ${fmt(axleLoads.rearKg)} kg (límite ${fmt(axleLoads.rearLimitKg)} kg). Adelante la carga hacia la cabina.`,
      });
    }
    if (axleLoads.frontShare < options.minFrontAxleShare) {
      issues.push({
        code: 'EJE_DELANTERO_DESCARGADO',
        message: `Sólo el ${fmt(axleLoads.frontShare * 100)} % del peso queda sobre el eje delantero (mínimo ${fmt(options.minFrontAxleShare * 100)} %): riesgo de perder dirección.`,
      });
    }
  }

  return {
    vehicleCode: vehicle.code,
    vehicleName: vehicle.name,
    feasible: issues.length === 0,
    weightUtilization: roundTo(profile.totalWeightKg / payloadKg, 3),
    volumeUtilization: roundTo(profile.totalVolumeM3 / volumeM3, 3),
    axleLoads: {
      frontKg: Math.round(axleLoads.frontKg),
      rearKg: Math.round(axleLoads.rearKg),
      frontLimitKg: axleLoads.frontLimitKg,
      rearLimitKg: axleLoads.rearLimitKg,
      frontShare: roundTo(axleLoads.frontShare, 3),
    },
    issues,
  };
}

/**
 * Cota inferior de viajes cuando nada cabe en uno: sólo considera vehículos cuyos
 * problemas son divisibles (peso, volumen, ejes) y que pueden llevar la unidad más pesada.
 */
function suggestSplit(
  profile: LoadProfile,
  vehicles: readonly VehicleType[],
  evaluations: readonly VehicleEvaluation[],
  options: CubicajeOptions,
): SplitSuggestion | null {
  const candidates = vehicles
    .map((vehicle, i) => {
      if (!evaluations[i].issues.every((issue) => DIVISIBLE_ISSUES.has(issue.code))) return null;
      const perTripKg = maxPayloadWithinAxleLimits(
        vehicle,
        options.minFrontAxleShare,
        options.loadCenterRatio,
      );
      if (perTripKg < profile.heaviestUnitKg) return null;
      const trips = Math.max(
        Math.ceil(profile.totalWeightKg / perTripKg),
        Math.ceil(profile.totalVolumeM3 / usableVolumeM3(vehicle)),
      );
      return { vehicle, trips, perTripKg, cost: trips * vehicle.costPerKm };
    })
    .filter((c) => c !== null)
    .sort((a, b) => a.cost - b.cost || a.vehicle.sizeRank - b.vehicle.sizeRank);

  const best = candidates.at(0);
  if (!best) return null;

  return {
    vehicleCode: best.vehicle.code,
    vehicleName: best.vehicle.name,
    trips: best.trips,
    maxPayloadPerTripKg: Math.floor(best.perTripKg),
    message:
      `Ningún vehículo lleva la carga en un viaje. Mínimo estimado: ${best.trips} viajes en ` +
      `${best.vehicle.name} (hasta ${fmt(Math.floor(best.perTripKg))} kg por viaje). Es una cota ` +
      'inferior: el acomodo real por ítem puede requerir más viajes.',
  };
}

function roundProfile(profile: LoadProfile): LoadProfile {
  return {
    ...profile,
    totalWeightKg: roundTo(profile.totalWeightKg, 2),
    totalVolumeM3: roundTo(profile.totalVolumeM3, 3),
    longestItemM: roundTo(profile.longestItemM, 2),
  };
}

function fmt(value: number, decimals = 0): string {
  return roundTo(value, decimals).toLocaleString('es-CL');
}
