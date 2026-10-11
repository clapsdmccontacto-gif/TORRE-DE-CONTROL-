import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { OrderTracker } from '../fulfillment/application/order-tracker.js';
import { MasterData } from '../master-data/application/master-data.js';
import { PickingDesk } from '../picking/application/picking-desk.js';
import { PickingModule } from '../picking/picking.module.js';
import { RoutePlanner } from '../routing/application/route-planner.js';
import { RoutingModule } from '../routing/routing.module.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { DispatchDesk } from './application/dispatch-desk.js';
import { DispatchController } from './http/dispatch.controller.js';

@Module({
  imports: [RoutingModule, PickingModule],
  controllers: [DispatchController],
  providers: [
    {
      provide: DispatchDesk,
      useFactory: async (
        data: MasterData,
        tracker: OrderTracker,
        planner: RoutePlanner,
        picking: PickingDesk,
        store: RecordStore,
      ) => {
        const desk = new DispatchDesk({
          orders: () => data.orders(),
          products: () => data.products(),
          units: () => data.units(),
          tracker,
          picked: (id) => picking.picked(id),
          routeOrder: () => planner.routeOrder(),
          store,
        });
        await desk.ready;
        return desk;
      },
      inject: [MasterData, OrderTracker, RoutePlanner, PickingDesk, RECORD_STORE],
    },
  ],
  exports: [DispatchDesk],
})
export class DispatchModule implements OnApplicationShutdown {
  constructor(@Inject(DispatchDesk) private readonly desk: DispatchDesk) {}

  async onApplicationShutdown(): Promise<void> {
    await this.desk.flush().catch(() => undefined);
  }
}
