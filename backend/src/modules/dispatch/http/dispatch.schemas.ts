import { z } from 'zod';
import { LOAD_SHORTAGE_REASONS } from '../domain/dispatch.js';

const operator = z.string().min(1).max(60);
const eventId = z.string().min(8).max(80);

export const assignSchema = z.object({ orderId: z.string().min(1).max(40), operator });
export const loadScanSchema = z.object({
  id: eventId,
  code: z.string().min(1).max(80),
  operator,
  device: z.string().max(80).nullable().default(null),
});
export const loadUndoSchema = z.object({ id: eventId, operator });
export const loadCloseSchema = z.object({
  operator,
  shortages: z
    .array(
      z.object({
        orderId: z.string().min(1).max(40),
        sku: z.string().min(1).max(40),
        reason: z.enum(LOAD_SHORTAGE_REASONS),
        note: z.string().max(200).nullable().default(null),
      }),
    )
    .max(500)
    .default([]),
});

export type AssignRequest = z.output<typeof assignSchema>;
export type LoadScanRequest = z.output<typeof loadScanSchema>;
export type LoadUndoRequest = z.output<typeof loadUndoSchema>;
export type LoadCloseRequest = z.output<typeof loadCloseSchema>;
