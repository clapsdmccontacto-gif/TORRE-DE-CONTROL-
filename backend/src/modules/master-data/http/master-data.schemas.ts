import { z } from 'zod';
import { HANDLING_CLASSES } from '../../catalog/domain/product.js';

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const depotSchema = z.object({ name: z.string().max(80), location: latLng });

export const vehicleSchema = z.object({
  plate: z.string().max(20),
  vehicleCode: z.string().min(1).max(40),
});

export const productSchema = z.object({
  sku: z.string().max(40),
  name: z.string().max(120),
  brand: z.string().max(60).nullable().default(null),
  handlingClass: z.enum(HANDLING_CLASSES),
  unitWeightKg: z.number(),
  lengthCm: z.number(),
  widthCm: z.number(),
  heightCm: z.number(),
  isFragile: z.boolean().default(false),
  requiresMechanicalUnload: z.boolean().default(false),
});

export const siteSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().max(120),
  commune: z.string().max(60),
  location: latLng,
  hasUnloadingEquipment: z.boolean().default(false),
  notifyEtaMinutes: z.number().default(15),
});

export const orderSchema = z.object({
  id: z.string().max(40),
  siteId: z.string().min(1).max(80),
  lines: z.array(z.object({ sku: z.string().min(1).max(40), quantity: z.number() })).max(200),
});

export type DepotRequest = z.output<typeof depotSchema>;
export type VehicleRequest = z.output<typeof vehicleSchema>;
export type ProductRequest = z.output<typeof productSchema>;
export type SiteRequest = z.output<typeof siteSchema>;
export type OrderRequest = z.output<typeof orderSchema>;
