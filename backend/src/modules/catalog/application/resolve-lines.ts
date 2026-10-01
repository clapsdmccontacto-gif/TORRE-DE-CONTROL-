import { DomainError } from '../../../common/domain-error.js';
import type { ProductLine } from '../domain/product.js';
import type { ProductCatalog } from './product-catalog.port.js';

export interface SkuQuantity {
  sku: string;
  quantity: number;
}

/** Convierte líneas {sku, cantidad} del request en líneas de dominio con el producto completo. */
export async function resolveLines(
  catalog: ProductCatalog,
  lines: readonly SkuQuantity[],
): Promise<ProductLine[]> {
  const skus = [...new Set(lines.map((line) => line.sku))];
  const products = new Map((await catalog.findBySkus(skus)).map((p) => [p.sku, p]));

  const unknown = skus.filter((sku) => !products.has(sku));
  if (unknown.length > 0) {
    throw new DomainError('SKU_DESCONOCIDO', `SKU no encontrado: ${unknown.join(', ')}.`, {
      skus: unknown,
    });
  }

  return lines.map((line) => ({ product: products.get(line.sku)!, quantity: line.quantity }));
}
