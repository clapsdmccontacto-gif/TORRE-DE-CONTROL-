import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { OrderTracker } from './application/order-tracker.js';
import { FulfillmentController } from './http/fulfillment.controller.js';

/** Estado e historial de cada pedido (picking, carga, ruta, entrega). */
@Global()
@Module({
  controllers: [FulfillmentController],
  providers: [
    {
      provide: OrderTracker,
      useFactory: async (store: RecordStore) => {
        const tracker = new OrderTracker({ store });
        await tracker.ready;
        return tracker;
      },
      inject: [RECORD_STORE],
    },
  ],
  exports: [OrderTracker],
})
export class FulfillmentModule implements OnApplicationShutdown {
  constructor(@Inject(OrderTracker) private readonly tracker: OrderTracker) {}

  async onApplicationShutdown(): Promise<void> {
    await this.tracker.flush().catch(() => undefined);
  }
}
