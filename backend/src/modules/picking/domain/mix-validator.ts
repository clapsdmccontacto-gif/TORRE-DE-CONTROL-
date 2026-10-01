import { roundTo } from '../../../common/math.js';
import {
  assertValidLine,
  longestSideCm,
  unitVolumeM3,
  type Product,
  type ProductLine,
} from '../../catalog/domain/product.js';
import type { CartSpec } from './cart.js';
import {
  DEFAULT_MIX_POLICY,
  findClassPairRule,
  isSensitive,
  type MixPolicy,
  type MixSeverity,
} from './mix-policy.js';

export type MixRuleCode =
  | 'MEZCLA_INCOMPATIBLE'
  | 'PESADO_CON_SENSIBLE'
  | 'LARGO_EXCEDE_CARRO'
  | 'SOBREPESO_CARRO'
  | 'SOBREVOLUMEN_CARRO'
  | 'CARRO_CASI_LLENO';

export interface MixViolation {
  rule: MixRuleCode;
  severity: MixSeverity;
  message: string;
  /** SKUs involucrados (vacío cuando la regla aplica al carro completo). */
  skus: string[];
}

export type MixDecision = 'PERMITIDO' | 'PERMITIDO_CON_ADVERTENCIA' | 'BLOQUEADO';

export interface CartLoad {
  totalWeightKg: number;
  totalVolumeM3: number;
  /** Fracción de la capacidad usada (1 = lleno). */
  weightUtilization: number;
  volumeUtilization: number;
}

export interface MixCheckResult {
  decision: MixDecision;
  /** Ordenadas con los bloqueos primero. */
  violations: MixViolation[];
  /** Carga del carro incluyendo la línea evaluada. */
  load: CartLoad;
}

/**
 * Regla crítica del picking: ¿puede `incoming` subir al carro que ya contiene `current`?
 *
 * Sólo reporta conflictos en los que participa la línea entrante: los que ya estaban en
 * el carro se resolvieron (o los autorizó un supervisor) cuando se escanearon. La
 * capacidad, en cambio, se evalúa sobre el carro completo resultante.
 */
export function checkCartAddition(
  cart: CartSpec,
  current: readonly ProductLine[],
  incoming: ProductLine,
  policy: MixPolicy = DEFAULT_MIX_POLICY,
): MixCheckResult {
  const lines = [...current, incoming];
  lines.forEach(assertValidLine);
  const load = computeLoad(cart, lines);

  return buildResult(load, [
    ...lengthViolations(cart, incoming),
    ...pairViolations(incoming, current, policy),
    ...capacityViolations(cart, load, policy, [incoming.product.sku]),
  ]);
}

/** Revisa el carro completo (todas las parejas), p. ej. para auditoría desde la torre de control. */
export function auditCart(
  cart: CartSpec,
  lines: readonly ProductLine[],
  policy: MixPolicy = DEFAULT_MIX_POLICY,
): MixCheckResult {
  lines.forEach(assertValidLine);
  const load = computeLoad(cart, lines);

  return buildResult(load, [
    ...lines.flatMap((line) => lengthViolations(cart, line)),
    ...lines.flatMap((line, i) => pairViolations(line, lines.slice(i + 1), policy)),
    ...capacityViolations(cart, load, policy, []),
  ]);
}

function pairViolations(
  line: ProductLine,
  others: readonly ProductLine[],
  policy: MixPolicy,
): MixViolation[] {
  return others
    .filter((other) => other.product.sku !== line.product.sku)
    .flatMap((other) => evaluatePair(line.product, other.product, policy));
}

function evaluatePair(a: Product, b: Product, policy: MixPolicy): MixViolation[] {
  const violations: MixViolation[] = [];

  const rule = findClassPairRule(policy, a.handlingClass, b.handlingClass);
  if (rule) {
    violations.push({
      rule: 'MEZCLA_INCOMPATIBLE',
      severity: rule.severity,
      message:
        rule.severity === 'BLOQUEO'
          ? `Mezcla incompatible: ${describe(a)} no puede ir en el mismo carro que ${describe(b)} (${rule.reason}).`
          : `Precaución al mezclar ${describe(a)} con ${describe(b)}: ${rule.reason}.`,
      skus: [a.sku, b.sku],
    });
    if (rule.severity === 'BLOQUEO') return violations;
  }

  // Defensa en profundidad: un ítem pesado mal clasificado (p. ej. GENERAL) también aplasta.
  const heavy = [a, b].find(
    (p) => !isSensitive(p, policy) && p.unitWeightKg >= policy.heavyUnitThresholdKg,
  );
  const sensitive = [a, b].find((p) => isSensitive(p, policy));
  if (heavy && sensitive) {
    violations.push({
      rule: 'PESADO_CON_SENSIBLE',
      severity: 'BLOQUEO',
      message: `«${heavy.name}» pesa ${heavy.unitWeightKg} kg por unidad y puede aplastar «${sensitive.name}»; use carros separados.`,
      skus: [heavy.sku, sensitive.sku],
    });
  }

  return violations;
}

function lengthViolations(cart: CartSpec, line: ProductLine): MixViolation[] {
  const longest = longestSideCm(line.product);
  if (longest <= cart.maxItemLengthCm) return [];
  return [
    {
      rule: 'LARGO_EXCEDE_CARRO',
      severity: 'BLOQUEO',
      message: `«${line.product.name}» mide ${longest} cm y este carro admite hasta ${cart.maxItemLengthCm} cm.`,
      skus: [line.product.sku],
    },
  ];
}

function capacityViolations(
  cart: CartSpec,
  load: CartLoad,
  policy: MixPolicy,
  skus: string[],
): MixViolation[] {
  const violations: MixViolation[] = [];

  if (load.totalWeightKg > cart.maxLoadKg) {
    violations.push({
      rule: 'SOBREPESO_CARRO',
      severity: 'BLOQUEO',
      message: `El carro quedaría con ${roundTo(load.totalWeightKg, 1)} kg y su capacidad es ${cart.maxLoadKg} kg.`,
      skus,
    });
  }
  if (load.totalVolumeM3 > cart.maxVolumeM3) {
    violations.push({
      rule: 'SOBREVOLUMEN_CARRO',
      severity: 'BLOQUEO',
      message: `El carro quedaría con ${roundTo(load.totalVolumeM3, 3)} m³ y su capacidad es ${cart.maxVolumeM3} m³.`,
      skus,
    });
  }

  const utilization = Math.max(load.weightUtilization, load.volumeUtilization);
  if (violations.length === 0 && utilization >= policy.nearCapacityRatio) {
    violations.push({
      rule: 'CARRO_CASI_LLENO',
      severity: 'ADVERTENCIA',
      message: `El carro queda al ${Math.round(utilization * 100)} % de su capacidad; prepare el siguiente carro.`,
      skus,
    });
  }

  return violations;
}

function computeLoad(cart: CartSpec, lines: readonly ProductLine[]): CartLoad {
  const totalWeightKg = lines.reduce((sum, l) => sum + l.quantity * l.product.unitWeightKg, 0);
  const totalVolumeM3 = lines.reduce((sum, l) => sum + l.quantity * unitVolumeM3(l.product), 0);
  return {
    totalWeightKg,
    totalVolumeM3,
    weightUtilization: totalWeightKg / cart.maxLoadKg,
    volumeUtilization: totalVolumeM3 / cart.maxVolumeM3,
  };
}

function buildResult(load: CartLoad, violations: MixViolation[]): MixCheckResult {
  // Un mismo par puede aparecer dos veces (A-B y B-A, o líneas repetidas del mismo SKU).
  const byKey = new Map<string, MixViolation>();
  for (const v of violations) {
    const key = `${v.rule}|${[...v.skus].sort().join(',')}`;
    if (!byKey.has(key)) byKey.set(key, v);
  }
  const unique = [...byKey.values()].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );

  const decision: MixDecision = unique.some((v) => v.severity === 'BLOQUEO')
    ? 'BLOQUEADO'
    : unique.length > 0
      ? 'PERMITIDO_CON_ADVERTENCIA'
      : 'PERMITIDO';

  return {
    decision,
    violations: unique,
    load: {
      totalWeightKg: roundTo(load.totalWeightKg, 2),
      totalVolumeM3: roundTo(load.totalVolumeM3, 4),
      weightUtilization: roundTo(load.weightUtilization, 3),
      volumeUtilization: roundTo(load.volumeUtilization, 3),
    },
  };
}

function severityRank(severity: MixSeverity): number {
  return severity === 'BLOQUEO' ? 2 : 1;
}

function describe(product: Product): string {
  return `«${product.name}» (${product.handlingClass})`;
}
