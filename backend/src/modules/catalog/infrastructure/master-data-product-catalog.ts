import { Injectable } from '@nestjs/common';
import { MasterData } from '../../master-data/application/master-data.js';
import { ProductCatalog } from '../application/product-catalog.port.js';
import type { Product } from '../domain/product.js';

/** Productos que la empresa carga en «Productos» (datos maestros). */
@Injectable()
export class MasterDataProductCatalog extends ProductCatalog {
  constructor(private readonly data: MasterData) {
    super();
  }

  async list(): Promise<Product[]> {
    return [...this.data.products()];
  }

  async findBySkus(skus: readonly string[]): Promise<Product[]> {
    const products = this.data.products();
    return skus.flatMap((sku) => products.find((p) => p.sku === sku.trim().toUpperCase()) ?? []);
  }
}
