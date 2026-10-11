import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { DeliveryRegistry } from '../application/delivery-registry.js';
import {
  deliveryFilterSchema,
  deliverySchema,
  type DeliveryFilterRequest,
  type DeliveryRequest,
} from './epod.schemas.js';

/** Comprobantes de entrega (e-POD): los envía el conductor y los revisa la torre. */
@Controller('deliveries')
export class EpodController {
  constructor(private readonly registry: DeliveryRegistry) {}

  /** Idempotente por `id` (generado en el teléfono): reenviar devuelve el ya guardado. */
  @Post()
  @HttpCode(200)
  register(@Body(new ZodValidationPipe(deliverySchema)) body: DeliveryRequest) {
    return this.registry.register(body);
  }

  @Get()
  list(@Query(new ZodValidationPipe(deliveryFilterSchema)) query: DeliveryFilterRequest) {
    return this.registry.list({
      from: query.from,
      to: query.to,
      vehiclePlate: query.plate,
      outcome: query.outcome,
      orderId: query.order,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.registry.get(id);
  }

  /** Firma o foto (la clave va en `?key=`: las etiquetas <img> no envían cabeceras). */
  @Get(':id/images/:imageId')
  async image(@Param('id') id: string, @Param('imageId') imageId: string, @Res() res: Response) {
    const image = await this.registry.image(id, imageId);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.type(image.mime).send(Buffer.from(image.base64, 'base64'));
  }
}
