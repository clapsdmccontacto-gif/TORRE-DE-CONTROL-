import { Module } from '@nestjs/common';
import { RoutePlanner } from '../routing/application/route-planner.js';
import { RoutingModule } from '../routing/routing.module.js';
import { TrackingHub } from './application/tracking-hub.js';
import { TrackingController } from './http/tracking.controller.js';

@Module({
  imports: [RoutingModule],
  controllers: [TrackingController],
  providers: [
    {
      provide: TrackingHub,
      useFactory: (planner: RoutePlanner) =>
        new TrackingHub({ units: () => planner.units(), activePlan: () => planner.activePlan() }),
      inject: [RoutePlanner],
    },
  ],
})
export class TrackingModule {}
