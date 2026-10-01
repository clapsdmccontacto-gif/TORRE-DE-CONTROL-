import type { HandlingClass } from '@/types/api';

const number = (maxDecimals: number) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: maxDecimals });

export const formatKg = (kg: number) => `${number(kg < 100 ? 1 : 0).format(kg)} kg`;
export const formatM3 = (m3: number) => `${number(m3 < 1 ? 3 : 2).format(m3)} m³`;
export const formatM = (m: number) => `${number(2).format(m)} m`;
export const formatPct = (fraction: number) => `${Math.round(fraction * 100)} %`;

export const HANDLING_CLASS_LABEL: Record<HandlingClass, string> = {
  GRANEL_PESADO: 'Granel pesado',
  LARGO: 'Largo',
  GENERAL: 'General',
  FRAGIL: 'Frágil',
  HERRAMIENTA: 'Herramienta',
  QUIMICO: 'Químico',
};
