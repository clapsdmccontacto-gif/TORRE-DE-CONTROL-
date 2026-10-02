import { z } from 'zod';

export const startSessionSchema = z.object({
  driverName: z.string().trim().min(2).max(80),
  vehiclePlate: z.string().trim().min(1).max(20),
});

const fixSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().nullable().default(null),
  speedKmh: z.number().nonnegative().nullable().default(null),
  headingDeg: z.number().min(0).max(360).nullable().default(null),
  recordedAt: z.iso.datetime({ offset: true }),
});

/** Lote de lecturas: el teléfono acumula las que no pudo enviar por falta de señal. */
export const positionsSchema = z.object({
  fixes: z.array(fixSchema).min(1).max(500),
});

export type StartSessionRequest = z.output<typeof startSessionSchema>;
export type PositionsRequest = z.output<typeof positionsSchema>;
