import { Module } from '@nestjs/common';
import { DEFAULT_FLEET } from '../load-planning/infrastructure/default-fleet.js';
import { MasterData } from '../master-data/application/master-data.js';
import { RoutePlanner } from './application/route-planner.js';
import { RoutingController } from './http/routing.controller.js';

@Module({
  controllers: [RoutingController],
  providers: [
    {
      provide: RoutePlanner,
      useFactory: (data: MasterData) =>
        new RoutePlanner({
          depot: () => data.depot(),
          orders: () => data.orders(),
          fleet: DEFAULT_FLEET,
          units: () => data.units(),
        }),
      inject: [MasterData],
    },
  ],
  exports: [RoutePlanner],
})
export class RoutingModule {}
