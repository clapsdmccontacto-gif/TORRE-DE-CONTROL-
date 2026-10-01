import { z } from 'zod';
import { skuQuantitySchema } from '../../catalog/http/sku-quantity.schema.js';
import { DEFAULT_CUBICAJE_OPTIONS } from '../domain/cubicaje.js';

export const cubicajeSchema = z.object({
  lines: z.array(skuQuantitySchema).min(1).max(500),
  siteHasUnloadingEquipment: z
    .boolean()
    .default(DEFAULT_CUBICAJE_OPTIONS.siteHasUnloadingEquipment),
  loadCenterRatio: z.number().min(0).max(1).default(DEFAULT_CUBICAJE_OPTIONS.loadCenterRatio),
});

export type CubicajeRequest = z.output<typeof cubicajeSchema>;
