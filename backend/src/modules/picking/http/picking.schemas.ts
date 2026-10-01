import { z } from 'zod';
import { skuQuantitySchema } from '../../catalog/http/sku-quantity.schema.js';
import { CART_TYPES } from '../domain/cart.js';

export const mixCheckSchema = z.object({
  cartType: z.enum(CART_TYPES),
  currentLines: z.array(skuQuantitySchema).max(200).default([]),
  incoming: skuQuantitySchema,
});

export const cartAuditSchema = z.object({
  cartType: z.enum(CART_TYPES),
  lines: z.array(skuQuantitySchema).min(1).max(200),
});

export type MixCheckRequest = z.output<typeof mixCheckSchema>;
export type CartAuditRequest = z.output<typeof cartAuditSchema>;
