import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CloudModule } from './modules/cloud/cloud.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { EpodModule } from './modules/epod/epod.module.js';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module.js';
import { LoadPlanningModule } from './modules/load-planning/load-planning.module.js';
import { MasterDataModule } from './modules/master-data/master-data.module.js';
import { PickingModule } from './modules/picking/picking.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';

@Module({
  imports: [
    CloudModule,
    StorageModule,
    MasterDataModule,
    FulfillmentModule,
    CatalogModule,
    PickingModule,
    LoadPlanningModule,
    RoutingModule,
    DispatchModule,
    TrackingModule,
    EpodModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
