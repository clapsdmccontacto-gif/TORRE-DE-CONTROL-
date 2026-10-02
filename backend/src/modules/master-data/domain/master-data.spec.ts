import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import {
  EMPTY_MASTER_DATA,
  normalizePlate,
  parseSnapshot,
  resolveOrders,
  resolveUnits,
  upsert,
  validateOrder,
  validateProduct,
  validateSite,
  validateVehicle,
  type MasterDataSnapshot,
} from './master-data.js';

const site = {
  id: 'OBRA-1',
  name: '  Edificio   Las Araucarias ',
  commune: 'Los Ángeles',
  location: { lat: -37.472, lng: -72.356 },
  hasUnloadingEquipment: false,
  notifyEtaMinutes: 15,
};

describe('validaciones de datos maestros', () => {
  it('normaliza patentes y rechaza las inválidas', () => {
    expect(normalizePlate(' ab·cd 12 ')).toBe('ABCD12');
    expect(normalizePlate('hj-kl-34')).toBe('HJ-KL-34');
    expect(() => normalizePlate('A1')).toThrow(
      expect.objectContaining({ code: 'PATENTE_INVALIDA' }),
    );
  });

  it('exige un tipo de vehículo del catálogo', () => {
    expect(
      validateVehicle({ plate: 'abcd12', vehicleCode: 'CAMION_PLUMA' }, DEFAULT_FLEET),
    ).toEqual({
      plate: 'ABCD12',
      vehicleCode: 'CAMION_PLUMA',
    });
    expect(() => validateVehicle({ plate: 'ABCD12', vehicleCode: 'BUS' }, DEFAULT_FLEET)).toThrow(
      expect.objectContaining({ code: 'TIPO_VEHICULO_DESCONOCIDO' }),
    );
  });

  it('valida productos: SKU en mayúsculas, medidas y peso positivos', () => {
    const product = validateProduct({ ...DEMO_PRODUCTS[0], sku: ' cem-25 ', brand: '  ' });
    expect(product.sku).toBe('CEM-25');
    expect(product.brand).toBeNull();
    expect(() => validateProduct({ ...DEMO_PRODUCTS[0], unitWeightKg: 0 })).toThrow(
      expect.objectContaining({ code: 'DATO_INVALIDO' }),
    );
  });

  it('valida obras: nombre, comuna, ubicación y aviso', () => {
    expect(validateSite(site).name).toBe('Edificio Las Araucarias');
    expect(() => validateSite({ ...site, location: { lat: 120, lng: 0 } })).toThrow(
      expect.objectContaining({ code: 'UBICACION_INVALIDA' }),
    );
    expect(() => validateSite({ ...site, notifyEtaMinutes: 0 })).toThrow(
      expect.objectContaining({ code: 'DATO_INVALIDO' }),
    );
  });

  it('valida pedidos contra obras y productos registrados y junta SKU repetidos', () => {
    const data: MasterDataSnapshot = {
      ...EMPTY_MASTER_DATA,
      products: [DEMO_PRODUCTS[0]],
      sites: [validateSite(site)],
    };
    const sku = DEMO_PRODUCTS[0].sku;
    expect(
      validateOrder(
        {
          id: 'nv-1',
          siteId: 'OBRA-1',
          lines: [
            { sku: sku.toLowerCase(), quantity: 2 },
            { sku, quantity: 3 },
          ],
        },
        data,
      ),
    ).toEqual({ id: 'NV-1', siteId: 'OBRA-1', lines: [{ sku, quantity: 5 }] });
    expect(() =>
      validateOrder({ id: 'NV-2', siteId: 'X', lines: [{ sku, quantity: 1 }] }, data),
    ).toThrow(expect.objectContaining({ code: 'OBRA_DESCONOCIDA' }));
    expect(() => validateOrder({ id: 'NV-2', siteId: 'OBRA-1', lines: [] }, data)).toThrow(
      expect.objectContaining({ code: 'PEDIDO_VACIO' }),
    );
    expect(() =>
      validateOrder(
        { id: 'NV-2', siteId: 'OBRA-1', lines: [{ sku: 'NO-EXISTE', quantity: 1 }] },
        data,
      ),
    ).toThrow(expect.objectContaining({ code: 'SKU_DESCONOCIDO' }));
  });
});

it('resolveOrders y resolveUnits arman pedidos y camiones para el optimizador', () => {
  const data: MasterDataSnapshot = {
    ...EMPTY_MASTER_DATA,
    products: [DEMO_PRODUCTS[0]],
    sites: [site],
    orders: [
      { id: 'NV-1', siteId: 'OBRA-1', lines: [{ sku: DEMO_PRODUCTS[0].sku, quantity: 4 }] },
      { id: 'NV-2', siteId: 'OBRA-BORRADA', lines: [{ sku: DEMO_PRODUCTS[0].sku, quantity: 1 }] },
    ],
    vehicles: [
      { plate: 'ABCD12', vehicleCode: 'CAMION_3_4' },
      { plate: 'ZZZZ99', vehicleCode: 'TIPO_QUE_YA_NO_EXISTE' },
    ],
  };
  const orders = resolveOrders(data);
  expect(orders).toHaveLength(1);
  expect(orders[0].lines[0]).toEqual({ product: DEMO_PRODUCTS[0], quantity: 4 });
  expect(resolveUnits(data, DEFAULT_FLEET).map((u) => u.plate)).toEqual(['ABCD12']);
});

it('upsert reemplaza por clave y parseSnapshot parte vacío con datos dañados', () => {
  expect(upsert([{ k: 'a', v: 1 }], { k: 'a', v: 2 }, (x) => x.k)).toEqual([{ k: 'a', v: 2 }]);
  expect(upsert([{ k: 'a', v: 1 }], { k: 'b', v: 2 }, (x) => x.k)).toHaveLength(2);
  expect(parseSnapshot(null)).toEqual(EMPTY_MASTER_DATA);
  expect(parseSnapshot({ version: 9 })).toEqual(EMPTY_MASTER_DATA);
  expect(parseSnapshot({ version: 1, vehicles: 'x' }).vehicles).toEqual([]);
});
