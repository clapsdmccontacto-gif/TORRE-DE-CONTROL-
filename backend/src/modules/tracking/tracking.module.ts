import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RecordStore } from '../../common/record-store.js';
import { OrderTracker } from '../fulfillment/application/order-tracker.js';
import { MasterData } from '../master-data/application/master-data.js';
import { RoutePlanner } from '../routing/application/route-planner.js';
import { RoutingModule } from '../routing/routing.module.js';
import { RECORD_STORE } from '../storage/storage.module.js';
import { TrackingHub, stopDetailsOf } from './application/tracking-hub.js';
import { TrackingController } from './http/tracking.controller.js';

@Module({
  imports: [RoutingModule],
  controllers: [TrackingController],
  providers: [
    {
      provide: TrackingHub,
      useFactory: async (
        planner: RoutePlanner,
        store: RecordStore,
        data: MasterData,
        tracker: OrderTracker,
      ) => {
        const hub = new TrackingHub({
          units: () => planner.units(),
          activePlan: () => planner.activePlan(),
          store,
          details: (id) => {
            const order = data.orders().find((o) => o.id === id);
            return order ? stopDetailsOf(order) : null;
          },
          // Los pedidos de la ruta salen de bodega con el camión.
          onRouteStarted: (session) => {
            for (const stop of session.stops) {
              if (stop.state === 'COMPLETADA') continue;
              tracker.tryTransition({
                orderId: stop.deliveryId,
                to: 'EN_RUTA',
                actor: session.driverName,
                vehiclePlate: session.vehiclePlate,
              });
            }
          },
        });
        await hub.ready;
        planner.onPublish((plan) => hub.planPublished(plan));
        return hub;
      },
      inject: [RoutePlanner, RECORD_STORE, MasterData, OrderTracker],
    },
  ],
  exports: [TrackingHub],
})
export class TrackingModule implements OnApplicationShutdown {
  constructor(@Inject(TrackingHub) private readonly hub: TrackingHub) {}

  /** Al apagar (p. ej. un despliegue en Render) guarda las lecturas GPS acumuladas. */
  async onApplicationShutdown(): Promise<void> {
    await this.hub.flush().catch(() => undefined);
  }
}
