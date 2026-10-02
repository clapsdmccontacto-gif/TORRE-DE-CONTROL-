import { Module } from '@nestjs/common';
import { DEFAULT_FLEET } from '../load-planning/infrastructure/default-fleet.js';
import { RoutePlanner } from './application/route-planner.js';
import { RoutingController } from './http/routing.controller.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_UNITS } from './infrastructure/demo-network.js';

@Module({
  controllers: [RoutingController],
  providers: [
    {
      provide: RoutePlanner,
      useFactory: () =>
        new RoutePlanner({
          depot: DEMO_DEPOT,
          orders: () => DEMO_ORDERS,
          fleet: DEFAULT_FLEET,
          units: DEMO_UNITS,
        }),
    },
  ],
  exports: [RoutePlanner],
})
export class RoutingModule {}
