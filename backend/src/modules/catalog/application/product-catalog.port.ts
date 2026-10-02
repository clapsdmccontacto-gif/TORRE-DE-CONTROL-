import type { Product } from '../domain/product.js';

/**
 * Puerto de lectura del maestro de productos. Lo implementan los datos maestros que carga
 * la empresa (`MasterDataProductCatalog`).
 */
export abstract class ProductCatalog {
  abstract list(): Promise<Product[]>;
  abstract findBySkus(skus: readonly string[]): Promise<Product[]>;
}
