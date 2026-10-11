import { z } from 'zod';

const image = z.string().max(1_500_000);

export const deliverySchema = z.object({
  id: z.string().min(8).max(80),
  orderId: z.string().min(1).max(40),
  sessionId: z.string().min(1).max(100),
  receiverName: z.string().max(150).nullable().default(null),
  receiverRut: z.string().max(20).nullable().default(null),
  lines: z.array(z.object({ sku: z.string().min(1).max(40), delivered: z.number() })).max(200),
  reason: z.string().max(400).nullable().default(null),
  signature: image.nullable().default(null),
  photos: z.array(image).max(3),
  position: z
    .object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable().default(null) })
    .nullable()
    .default(null),
  capturedAt: z.string().max(40),
});

export const deliveryFilterSchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  plate: z.string().max(20).optional(),
  outcome: z.enum(['ENTREGADO', 'ENTREGA_PARCIAL', 'RECHAZADO']).optional(),
  order: z.string().max(40).optional(),
});

export type DeliveryRequest = z.output<typeof deliverySchema>;
export type DeliveryFilterRequest = z.output<typeof deliveryFilterSchema>;
