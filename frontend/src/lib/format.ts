import type { HandlingClass, StopState } from '@/types/api';

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

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});
export const formatClp = (value: number) => clp.format(value);
export const formatLiters = (liters: number) => `${number(1).format(liters)} L`;
export const formatKm = (km: number) => `${number(km < 10 ? 1 : 0).format(km)} km`;

const clock = new Intl.DateTimeFormat('es-CL', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export const formatClock = (iso: string) => clock.format(new Date(iso));

/** Hora estimada a partir de los minutos desde la salida de bodega (08:00 por defecto). */
export function formatPlannedTime(minutesFromDeparture: number, departure = '08:00'): string {
  const [h, m] = departure.split(':').map(Number);
  const total = h * 60 + m + Math.round(minutesFromDeparture);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const VEHICLE_SHORT_LABEL: Record<string, string> = {
  CAMIONETA: 'Camioneta',
  CAMION_3_4: 'Camión 3/4',
  CAMION_PLUMA: 'Camión pluma',
};

export const STOP_STATE_LABEL: Record<StopState, string> = {
  PENDIENTE: 'Pendiente',
  EN_OBRA: 'En obra',
  COMPLETADA: 'Descargada',
};
