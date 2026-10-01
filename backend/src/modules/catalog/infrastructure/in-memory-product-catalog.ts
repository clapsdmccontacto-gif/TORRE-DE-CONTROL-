import { Injectable } from '@nestjs/common';
import { ProductCatalog } from '../application/product-catalog.port.js';
import type { Product } from '../domain/product.js';
import { DEMO_PRODUCTS } from './demo-products.js';

@Injectable()
export class InMemoryProductCatalog extends ProductCatalog {
  private readonly bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));

  async list(): Promise<Product[]> {
    return [...this.bySku.values()];
  }

  async findBySkus(skus: readonly string[]): Promise<Product[]> {
    return skus.flatMap((sku) => this.bySku.get(sku) ?? []);
  }
}
