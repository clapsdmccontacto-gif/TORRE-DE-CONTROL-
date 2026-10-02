import { z } from 'zod';
import { DEFAULT_ROUTING_OPTIONS } from '../domain/optimizer.js';

export const optimizeSchema = z.object({
  deliveryIds: z.array(z.string().trim().min(1)).min(1).max(200),
  dieselPriceClp: z.number().positive().max(10_000).default(DEFAULT_ROUTING_OPTIONS.dieselPriceClp),
});

export type OptimizeRequest = z.output<typeof optimizeSchema>;
