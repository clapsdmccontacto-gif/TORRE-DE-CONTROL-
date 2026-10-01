import { Module } from '@nestjs/common';
import { ProductCatalog } from './application/product-catalog.port.js';
import { CatalogController } from './http/catalog.controller.js';
import { InMemoryProductCatalog } from './infrastructure/in-memory-product-catalog.js';

@Module({
  controllers: [CatalogController],
  providers: [{ provide: ProductCatalog, useClass: InMemoryProductCatalog }],
  exports: [ProductCatalog],
})
export class CatalogModule {}
