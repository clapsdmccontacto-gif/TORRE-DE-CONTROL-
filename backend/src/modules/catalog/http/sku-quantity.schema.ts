import { z } from 'zod';

export const skuQuantitySchema = z.object({
  sku: z.string().trim().min(1),
  quantity: z.number().positive(),
});
