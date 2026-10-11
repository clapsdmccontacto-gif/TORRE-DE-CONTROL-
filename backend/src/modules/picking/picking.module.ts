import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { OrderTracker } from '../fulfillment/application/order-tracker.js';
import { MasterData } from '../master-data/application/master-data.js';
import { RoutePlanner } from '../routing/application/route-planner.js';
import { RoutingModule } from '../routing/routing.module.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { PickingDesk } from './application/picking-desk.js';
import { PickingService } from './application/picking.service.js';
import { PickingDeskController } from './http/picking-desk.controller.js';
import { PickingController } from './http/picking.controller.js';

@Module({
  imports: [CatalogModule, RoutingModule],
  controllers: [PickingController, PickingDeskController],
  providers: [
    PickingService,
    {
      provide: PickingDesk,
      useFactory: async (
        data: MasterData,
        tracker: OrderTracker,
        planner: RoutePlanner,
        store: RecordStore,
      ) => {
        const desk = new PickingDesk({
          orders: () => data.orders(),
          products: () => data.products(),
          tracker,
          routeOrder: () => planner.routeOrder(),
          store,
        });
        await desk.ready;
        return desk;
      },
      inject: [MasterData, OrderTracker, RoutePlanner, RECORD_STORE],
    },
  ],
  exports: [PickingDesk],
})
export class PickingModule implements OnApplicationShutdown {
  constructor(@Inject(PickingDesk) private readonly desk: PickingDesk) {}

  async onApplicationShutdown(): Promise<void> {
    await this.desk.flush().catch(() => undefined);
  }
}
