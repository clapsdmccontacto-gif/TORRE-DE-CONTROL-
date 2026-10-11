import { Module } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { OrderTracker } from '../fulfillment/application/order-tracker.js';
import { isPlannable } from '../fulfillment/domain/order-status.js';
import { DEFAULT_FLEET } from '../load-planning/infrastructure/default-fleet.js';
import { MasterData } from '../master-data/application/master-data.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { RoutePlanner } from './application/route-planner.js';
import { RoutingController } from './http/routing.controller.js';

@Module({
  controllers: [RoutingController],
  providers: [
    {
      provide: RoutePlanner,
      useFactory: async (data: MasterData, store: RecordStore, tracker: OrderTracker) => {
        const planner = new RoutePlanner({
          depot: () => data.depot(),
          // Los pedidos en ruta o ya entregados no se vuelven a planificar.
          orders: () => data.orders().filter((o) => isPlannable(tracker.status(o.id))),
          fleet: DEFAULT_FLEET,
          units: () => data.units(),
          store,
        });
        await planner.ready;
        return planner;
      },
      inject: [MasterData, RECORD_STORE, OrderTracker],
    },
  ],
  exports: [RoutePlanner],
})
export class RoutingModule {}
