import { z } from 'zod';
import { skuQuantitySchema } from '../../catalog/http/sku-quantity.schema.js';
import { CART_TYPES } from '../domain/cart.js';

export const cartAuditSchema = z.object({
  cartType: z.enum(CART_TYPES),
  lines: z.array(skuQuantitySchema).min(1).max(200),
});

export type CartAuditRequest = z.output<typeof cartAuditSchema>;
