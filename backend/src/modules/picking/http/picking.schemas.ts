import { z } from 'zod';
import { skuQuantitySchema } from '../../catalog/http/sku-quantity.schema.js';
import { CART_TYPES } from '../domain/cart.js';
import { SHORTAGE_REASONS } from '../domain/pick-task.js';

export const cartAuditSchema = z.object({
  cartType: z.enum(CART_TYPES),
  lines: z.array(skuQuantitySchema).min(1).max(200),
});

export type CartAuditRequest = z.output<typeof cartAuditSchema>;

const operator = z.string().min(1).max(60);
const eventId = z.string().min(8).max(80);

export const claimSchema = z.object({
  operator,
  device: z.string().max(80).nullable().default(null),
});
export const releaseSchema = z.object({ operator, force: z.boolean().default(false) });
export const scanSchema = z.object({
  id: eventId,
  code: z.string().min(1).max(80),
  operator,
  device: z.string().max(80).nullable().default(null),
  cartType: z.enum(CART_TYPES).optional(),
});
export const undoSchema = z.object({ id: eventId, operator });
export const closeSchema = z.object({
  operator,
  shortages: z
    .array(
      z.object({
        sku: z.string().min(1).max(40),
        reason: z.enum(SHORTAGE_REASONS),
        note: z.string().max(200).nullable().default(null),
      }),
    )
    .max(200)
    .default([]),
});

export type ClaimRequest = z.output<typeof claimSchema>;
export type ReleaseRequest = z.output<typeof releaseSchema>;
export type ScanRequest = z.output<typeof scanSchema>;
export type UndoRequest = z.output<typeof undoSchema>;
export type CloseRequest = z.output<typeof closeSchema>;
