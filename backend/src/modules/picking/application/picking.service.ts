import { Injectable } from '@nestjs/common';
import { ProductCatalog } from '../../catalog/application/product-catalog.port.js';
import { resolveLines } from '../../catalog/application/resolve-lines.js';
import { DEFAULT_CART_SPECS, type CartSpec } from '../domain/cart.js';
import { auditCart, type MixCheckResult } from '../domain/mix-validator.js';
import type { CartAuditRequest } from '../http/picking.schemas.js';

export interface CartCheckResponse extends MixCheckResult {
  cart: CartSpec;
}

@Injectable()
export class PickingService {
  constructor(private readonly catalog: ProductCatalog) {}

  listCartTypes(): CartSpec[] {
    return Object.values(DEFAULT_CART_SPECS);
  }

  async audit(request: CartAuditRequest): Promise<CartCheckResponse> {
    const cart = DEFAULT_CART_SPECS[request.cartType];
    const lines = await resolveLines(this.catalog, request.lines);
    return { cart, ...auditCart(cart, lines) };
  }
}
