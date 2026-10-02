// Motor local: ejecuta en el navegador las mismas reglas de dominio del backend
// (importadas desde backend/src con el alias @core). Así la app funciona sin
// servidor: como archivo HTML, publicada en la web o en el teléfono.
import { DomainError } from '@core/common/domain-error';
import { resolveLines } from '@core/modules/catalog/application/resolve-lines';
import { unitVolumeM3 } from '@core/modules/catalog/domain/product';
import { DEMO_PRODUCTS } from '@core/modules/catalog/infrastructure/demo-products';
import { planLoad } from '@core/modules/load-planning/domain/cubicaje';
import { DEFAULT_FLEET } from '@core/modules/load-planning/infrastructure/default-fleet';
import { DEFAULT_CART_SPECS } from '@core/modules/picking/domain/cart';
import { checkCartAddition } from '@core/modules/picking/domain/mix-validator';
import { ApiError } from '@/lib/api-error';
import type { TorreApi } from '@/types/api';

const catalog = {
  list: async () => [...DEMO_PRODUCTS],
  findBySkus: async (skus: readonly string[]) =>
    DEMO_PRODUCTS.filter((product) => skus.includes(product.sku)),
};

/** Traduce los errores de dominio al mismo formato que responde la API (422). */
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new ApiError(422, { code: error.code, message: error.message });
    }
    throw error;
  }
}

export const localApi: TorreApi = {
  products: async () => DEMO_PRODUCTS.map((p) => ({ ...p, unitVolumeM3: unitVolumeM3(p) })),
  cartTypes: async () => Object.values(DEFAULT_CART_SPECS),
  mixCheck: (request) =>
    run(async () => {
      const cart = DEFAULT_CART_SPECS[request.cartType];
      const [incoming, ...current] = await resolveLines(catalog, [
        request.incoming,
        ...request.currentLines,
      ]);
      return { cart, ...checkCartAddition(cart, current, incoming) };
    }),
  cubicaje: (request) =>
    run(async () =>
      planLoad(await resolveLines(catalog, request.lines), DEFAULT_FLEET, {
        siteHasUnloadingEquipment: request.siteHasUnloadingEquipment,
        loadCenterRatio: request.loadCenterRatio,
      }),
    ),
};
