import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { LoadPlanningModule } from './modules/load-planning/load-planning.module.js';
import { PickingModule } from './modules/picking/picking.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';

@Module({
  imports: [CatalogModule, PickingModule, LoadPlanningModule, RoutingModule, TrackingModule],
  controllers: [HealthController],
})
export class AppModule {}
