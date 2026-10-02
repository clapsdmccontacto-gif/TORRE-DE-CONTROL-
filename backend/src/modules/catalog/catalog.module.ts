import { Module } from '@nestjs/common';
import { ProductCatalog } from './application/product-catalog.port.js';
import { CatalogController } from './http/catalog.controller.js';
import { MasterDataProductCatalog } from './infrastructure/master-data-product-catalog.js';

@Module({
  controllers: [CatalogController],
  providers: [{ provide: ProductCatalog, useClass: MasterDataProductCatalog }],
  exports: [ProductCatalog],
})
export class CatalogModule {}
