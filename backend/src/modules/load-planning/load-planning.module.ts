import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FleetCatalog } from './application/fleet-catalog.port.js';
import { LoadPlanningService } from './application/load-planning.service.js';
import { LoadPlanningController } from './http/load-planning.controller.js';
import { InMemoryFleetCatalog } from './infrastructure/in-memory-fleet-catalog.js';

@Module({
  imports: [CatalogModule],
  controllers: [LoadPlanningController],
  providers: [LoadPlanningService, { provide: FleetCatalog, useClass: InMemoryFleetCatalog }],
})
export class LoadPlanningModule {}
