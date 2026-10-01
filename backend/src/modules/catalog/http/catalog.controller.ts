import { Controller, Get } from '@nestjs/common';
import { ProductCatalog } from '../application/product-catalog.port.js';
import { unitVolumeM3 } from '../domain/product.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: ProductCatalog) {}

  @Get('products')
  async listProducts() {
    const products = await this.catalog.list();
    return products.map((p) => ({ ...p, unitVolumeM3: unitVolumeM3(p) }));
  }
}
