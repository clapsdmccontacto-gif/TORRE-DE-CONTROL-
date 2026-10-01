import type { Product } from '../domain/product.js';

/**
 * Puerto de lectura del maestro de productos. Hoy lo implementa un catálogo en
 * memoria; el adaptador PostgreSQL (tabla `products`) lo reemplaza sin tocar el dominio.
 */
export abstract class ProductCatalog {
  abstract list(): Promise<Product[]>;
  abstract findBySkus(skus: readonly string[]): Promise<Product[]>;
}
