import { axleLimitKg, maxPayloadKg, tareKg, type VehicleType } from './vehicle.js';

export interface AxleLoads {
  frontKg: number;
  rearKg: number;
  frontLimitKg: number;
  rearLimitKg: number;
  /** Fracción del peso total que queda sobre el eje delantero (dirección y frenado). */
  frontShare: number;
}

/**
 * Reparte la carga útil entre ejes con la regla de la palanca. Tomando momentos respecto
 * del eje delantero, el trasero recibe P·x/L y el delantero P·(L−x)/L, donde x es la
 * distancia del centro de gravedad de la carga al eje delantero y L la distancia entre
 * ejes. Si la carga queda detrás del eje trasero (x > L), el eje delantero se descarga.
 *
 * @param loadCenterRatio posición del centro de gravedad a lo largo de la plataforma
 *   (0 = inicio junto a la cabina, 0,5 = centro, 1 = extremo trasero).
 */
export function computeAxleLoads(
  vehicle: VehicleType,
  payloadKg: number,
  loadCenterRatio = 0.5,
): AxleLoads {
  const rearRatio = rearAxleRatio(vehicle, loadCenterRatio);
  const frontKg = vehicle.frontAxle.tareKg + payloadKg * (1 - rearRatio);
  const rearKg = vehicle.rearAxle.tareKg + payloadKg * rearRatio;
  return {
    frontKg,
    rearKg,
    frontLimitKg: axleLimitKg(vehicle.frontAxle),
    rearLimitKg: axleLimitKg(vehicle.rearAxle),
    frontShare: frontKg / (frontKg + rearKg),
  };
}

/**
 * Máxima carga útil que respeta el PBV, el límite de cada eje y la fracción mínima de
 * peso sobre el eje delantero, para una posición dada del centro de gravedad.
 */
export function maxPayloadWithinAxleLimits(
  vehicle: VehicleType,
  minFrontShare: number,
  loadCenterRatio = 0.5,
): number {
  const s = rearAxleRatio(vehicle, loadCenterRatio);
  const { frontAxle, rearAxle } = vehicle;
  const bounds = [maxPayloadKg(vehicle)];

  if (s > 0) bounds.push((axleLimitKg(rearAxle) - rearAxle.tareKg) / s);
  if (s < 1) bounds.push((axleLimitKg(frontAxle) - frontAxle.tareKg) / (1 - s));

  // frontKg / totalKg ≥ m  ⇔  P·(1 − s − m) ≥ m·tara − tara_delantera.
  // Sólo acota la carga cuando (1 − s − m) < 0, es decir, cuando cargar descarga la dirección.
  const k = 1 - s - minFrontShare;
  if (k < 0) bounds.push((frontAxle.tareKg - minFrontShare * tareKg(vehicle)) / -k);

  return Math.max(0, Math.min(...bounds));
}

/** Fracción de la carga útil que toma el eje trasero (x / L). */
function rearAxleRatio(vehicle: VehicleType, loadCenterRatio: number): number {
  const x = vehicle.cargoStartFromFrontAxleM + loadCenterRatio * vehicle.cargo.lengthM;
  return x / vehicle.wheelbaseM;
}
