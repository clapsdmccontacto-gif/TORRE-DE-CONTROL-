import type { HandlingClass, Product } from '../../catalog/domain/product.js';

export type MixSeverity = 'ADVERTENCIA' | 'BLOQUEO';

/** Regla de compatibilidad entre dos clases de manipulación (simétrica). */
export interface ClassPairRule {
  classes: readonly [HandlingClass, HandlingClass];
  severity: MixSeverity;
  reason: string;
}

export interface MixPolicy {
  classPairRules: readonly ClassPairRule[];
  /** Clases que se dañan con carga pesada, además de los productos marcados como frágiles. */
  sensitiveClasses: readonly HandlingClass[];
  /**
   * Peso unitario desde el cual un ítem se trata como carga pesada aunque su clase
   * no lo diga. Defiende contra productos mal clasificados en el maestro.
   */
  heavyUnitThresholdKg: number;
  /** Fracción de la capacidad del carro desde la cual se advierte. */
  nearCapacityRatio: number;
}

/**
 * Política por defecto. Todo par de clases que no aparece aquí es compatible.
 * Es configuración: el siguiente paso es moverla a una tabla editable por el supervisor.
 */
export const DEFAULT_MIX_POLICY: MixPolicy = {
  classPairRules: [
    {
      classes: ['GRANEL_PESADO', 'FRAGIL'],
      severity: 'BLOQUEO',
      reason: 'riesgo de aplastamiento y rotura',
    },
    {
      classes: ['GRANEL_PESADO', 'HERRAMIENTA'],
      severity: 'BLOQUEO',
      reason: 'golpes y contaminación por polvo de cemento o áridos en herramientas de precisión',
    },
    {
      classes: ['LARGO', 'FRAGIL'],
      severity: 'BLOQUEO',
      reason: 'barras y planchas golpean o quiebran ítems frágiles al maniobrar el carro',
    },
    {
      classes: ['LARGO', 'HERRAMIENTA'],
      severity: 'ADVERTENCIA',
      reason: 'asegure las herramientas en un compartimento separado de las barras',
    },
    {
      classes: ['QUIMICO', 'GRANEL_PESADO'],
      severity: 'ADVERTENCIA',
      reason: 'un derrame inutiliza los sacos de cemento; mantenga el envase vertical y separado',
    },
    {
      classes: ['QUIMICO', 'HERRAMIENTA'],
      severity: 'ADVERTENCIA',
      reason: 'riesgo de derrame sobre equipos eléctricos',
    },
  ],
  sensitiveClasses: ['FRAGIL', 'HERRAMIENTA'],
  heavyUnitThresholdKg: 20,
  nearCapacityRatio: 0.9,
};

export function findClassPairRule(
  policy: MixPolicy,
  a: HandlingClass,
  b: HandlingClass,
): ClassPairRule | undefined {
  return policy.classPairRules.find(
    ({ classes: [x, y] }) => (x === a && y === b) || (x === b && y === a),
  );
}

export function isSensitive(product: Product, policy: MixPolicy): boolean {
  return product.isFragile || policy.sensitiveClasses.includes(product.handlingClass);
}
