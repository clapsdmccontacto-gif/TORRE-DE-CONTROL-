import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { PickingService } from '../application/picking.service.js';
import { cartAuditSchema, type CartAuditRequest } from './picking.schemas.js';

@Controller('picking')
export class PickingController {
  constructor(private readonly picking: PickingService) {}

  @Get('cart-types')
  cartTypes() {
    return this.picking.listCartTypes();
  }

  @Post('cart-audit')
  @HttpCode(200)
  cartAudit(@Body(new ZodValidationPipe(cartAuditSchema)) body: CartAuditRequest) {
    return this.picking.audit(body);
  }
}
