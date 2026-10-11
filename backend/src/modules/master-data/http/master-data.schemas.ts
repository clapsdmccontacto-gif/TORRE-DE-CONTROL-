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
  barcodes: z
    .array(z.object({ code: z.string().max(60), unitsPerScan: z.number().default(1) }))
    .max(20)
    .default([]),
  binLocation: z.string().max(40).nullable().default(null),
});

export const siteSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().max(120),
  commune: z.string().max(60),
  location: latLng,
  hasUnloadingEquipment: z.boolean().default(false),
  notifyEtaMinutes: z.number().default(15),
  address: z.string().max(200).nullable().default(null),
  contactName: z.string().max(100).nullable().default(null),
  contactPhone: z.string().max(30).nullable().default(null),
});

export const orderSchema = z.object({
  id: z.string().max(40),
  siteId: z.string().min(1).max(80),
  lines: z.array(z.object({ sku: z.string().min(1).max(40), quantity: z.number() })).max(200),
  customerName: z.string().max(150).nullable().default(null),
  deliveryDate: z.string().max(20).nullable().default(null),
  notes: z.string().max(600).nullable().default(null),
});

/** Importación desde planilla: la interfaz ya la revisó; el servidor valida de nuevo todo. */
export const productImportSchema = z.object({ products: z.array(productSchema).max(5_000) });

export const orderImportSchema = z.object({
  sites: z.array(siteSchema).max(5_000).default([]),
  orders: z.array(orderSchema).max(5_000),
});

export type DepotRequest = z.output<typeof depotSchema>;
export type VehicleRequest = z.output<typeof vehicleSchema>;
export type ProductRequest = z.output<typeof productSchema>;
export type SiteRequest = z.output<typeof siteSchema>;
export type OrderRequest = z.output<typeof orderSchema>;
export type ProductImportRequest = z.output<typeof productImportSchema>;
export type OrderImportRequest = z.output<typeof orderImportSchema>;
