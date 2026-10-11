import { Controller, Get } from '@nestjs/common';
import { OrderTracker } from '../application/order-tracker.js';

@Controller('orders')
export class FulfillmentController {
  constructor(private readonly tracker: OrderTracker) {}

  /** Estado e historial de los pedidos que ya se movieron (los demás están PENDIENTE). */
  @Get('tracks')
  tracks() {
    return this.tracker.all();
  }
}
