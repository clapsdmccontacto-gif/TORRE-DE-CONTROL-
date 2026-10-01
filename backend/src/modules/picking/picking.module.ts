import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PickingService } from './application/picking.service.js';
import { PickingController } from './http/picking.controller.js';

@Module({
  imports: [CatalogModule],
  controllers: [PickingController],
  providers: [PickingService],
})
export class PickingModule {}
