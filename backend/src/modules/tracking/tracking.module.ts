import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { RoutePlanner } from '../routing/application/route-planner.js';
import { RoutingModule } from '../routing/routing.module.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { TrackingHub } from './application/tracking-hub.js';
import { TrackingController } from './http/tracking.controller.js';

@Module({
  imports: [RoutingModule],
  controllers: [TrackingController],
  providers: [
    {
      provide: TrackingHub,
      useFactory: async (planner: RoutePlanner, store: RecordStore) => {
        const hub = new TrackingHub({
          units: () => planner.units(),
          activePlan: () => planner.activePlan(),
          store,
        });
        await hub.ready;
        planner.onPublish((plan) => hub.planPublished(plan));
        return hub;
      },
      inject: [RoutePlanner, RECORD_STORE],
    },
  ],
})
export class TrackingModule implements OnApplicationShutdown {
  constructor(@Inject(TrackingHub) private readonly hub: TrackingHub) {}

  /** Al apagar (p. ej. un despliegue en Render) guarda las lecturas GPS acumuladas. */
  async onApplicationShutdown(): Promise<void> {
    await this.hub.flush().catch(() => undefined);
  }
}
