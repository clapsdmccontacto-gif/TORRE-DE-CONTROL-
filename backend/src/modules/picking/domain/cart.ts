export const CART_TYPES = ['MODULAR', 'PLATAFORMA_PESADA', 'CARRO_LARGOS'] as const;

export type CartType = (typeof CART_TYPES)[number];

/** Capacidad física de un carro de picking. */
export interface CartSpec {
  type: CartType;
  name: string;
  maxLoadKg: number;
  maxVolumeM3: number;
  /** Lado más largo de unidad que cabe sin sobresalir del carro. */
  maxItemLengthCm: number;
}

/**
 * Capacidades de referencia por tipo de carro. Cada carro físico registra las
 * suyas en la tabla `picking_carts`; estos valores son los de fábrica.
 */
export const DEFAULT_CART_SPECS: Readonly<Record<CartType, CartSpec>> = {
  MODULAR: {
    type: 'MODULAR',
    name: 'Carro modular (ferretería y herramientas)',
    maxLoadKg: 250,
    maxVolumeM3: 0.6,
    maxItemLengthCm: 120,
  },
  PLATAFORMA_PESADA: {
    type: 'PLATAFORMA_PESADA',
    name: 'Plataforma para carga pesada',
    maxLoadKg: 1000,
    maxVolumeM3: 1.2,
    maxItemLengthCm: 160,
  },
  CARRO_LARGOS: {
    type: 'CARRO_LARGOS',
    name: 'Carro para fierros y planchas',
    maxLoadKg: 600,
    maxVolumeM3: 0.8,
    maxItemLengthCm: 650,
  },
};
