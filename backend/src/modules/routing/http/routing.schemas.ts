import { z } from 'zod';
import { DEFAULT_ROUTING_OPTIONS } from '../domain/optimizer.js';

export const optimizeSchema = z.object({
  deliveryIds: z.array(z.string().trim().min(1)).min(1).max(200),
  dieselPriceClp: z.number().positive().max(10_000).default(DEFAULT_ROUTING_OPTIONS.dieselPriceClp),
});

export type OptimizeRequest = z.output<typeof optimizeSchema>;

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const roadAdjustmentSchema = z.object({
  stopOrder: z.array(z.number().int().min(0)).max(150),
  legs: z
    .array(z.object({ distanceKm: z.number().min(0).max(5_000), durationMin: z.number().min(0) }))
    .min(1)
    .max(151),
  path: z.array(latLng).min(2).max(2_000),
  trafficDelayMin: z.number().min(0).max(10_000),
  tollKm: z.number().min(0).max(5_000),
});

export type RoadAdjustmentRequest = z.output<typeof roadAdjustmentSchema>;
