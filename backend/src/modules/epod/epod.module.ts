import { Module } from '@nestjs/common';
import { OrderTracker } from '../fulfillment/application/order-tracker.js';
import { MasterData } from '../master-data/application/master-data.js';
import { TrackingHub } from '../tracking/application/tracking-hub.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { DeliveryRegistry } from './application/delivery-registry.js';
import { MemoryProofStore } from './application/proof-store.port.js';
import { proofOrderOf } from './domain/delivery-proof.js';
import { EpodController } from './http/epod.controller.js';
import { PostgresProofStore } from './infrastructure/postgres-proof-store.js';

/** Entregas con firma y foto: PostgreSQL si hay DATABASE_URL; si no, en memoria. */
@Module({
  imports: [TrackingModule],
  controllers: [EpodController],
  providers: [
    {
      provide: DeliveryRegistry,
      useFactory: (data: MasterData, hub: TrackingHub, tracker: OrderTracker) => {
        const url = process.env.DATABASE_URL?.trim();
        return new DeliveryRegistry({
          store: url ? new PostgresProofStore(url) : new MemoryProofStore(),
          order: (id) => {
            const order = data.orders().find((o) => o.id === id);
            return order ? proofOrderOf(order) : null;
          },
          route: (sessionId) => hub.route(sessionId),
          tracker,
          onDelivered: async (proof) => {
            hub.completeStop(proof.sessionId, proof.orderId, proof.outcome);
            await hub.flush();
          },
        });
      },
      inject: [MasterData, TrackingHub, OrderTracker],
    },
  ],
})
export class EpodModule {}
