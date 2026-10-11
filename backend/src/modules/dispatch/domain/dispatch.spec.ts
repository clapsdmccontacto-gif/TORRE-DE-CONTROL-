import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import type { Product } from '../../catalog/domain/product.js';
import { closeLoad, evaluateLoadScan, loadingOrder, type LoadOrder } from './dispatch.js';

const cement: Product = {
  ...DEMO_PRODUCTS.find((p) => p.sku === 'CEM-ESP-25')!,
  barcodes: [
    { code: '7802820005455', unitsPerScan: 1 },
    { code: '17802820005452', unitsPerScan: 10 },
  ],
};
const tile: Product = { ...DEMO_PRODUCTS.find((p) => p.sku === 'CER-MUR-2540')!, barcodes: [] };
const drill: Product = { ...DEMO_PRODUCTS.find((p) => p.sku === 'MAK-HP1630')!, barcodes: [] };
const products = [cement, tile, drill];

const orders = (): LoadOrder[] => [
  {
    orderId: 'NV-1',
    routePosition: 1,
    lines: [{ sku: cement.sku, name: cement.name, picked: 12, loaded: 0 }],
  },
  {
    orderId: 'NV-2',
    routePosition: 2,
    lines: [
      { sku: cement.sku, name: cement.name, picked: 3, loaded: 0 },
      { sku: tile.sku, name: tile.name, picked: 2, loaded: 0 },
    ],
  },
];
const elsewhere = new Map([['NV-9', { plate: 'ABCD12', skus: [drill.sku] }]]);
const context = (o = orders()) => ({ plate: 'LXCD21', products, orders: o, elsewhere });

describe('despacho con escaneo', () => {
  it('carga primero lo que se entrega último', () => {
    expect(loadingOrder(orders()).map((o) => o.orderId)).toEqual(['NV-2', 'NV-1']);
    expect(
      loadingOrder([...orders(), { orderId: 'NV-0', routePosition: null, lines: [] }]).map(
        (o) => o.orderId,
      ),
    ).toEqual(['NV-2', 'NV-1', 'NV-0']);
  });

  it('asigna el producto al pedido que va al fondo y respeta lo pickeado', () => {
    expect(evaluateLoadScan('7802820005455', context())).toMatchObject({
      ok: true,
      kind: 'PRODUCTO',
      orderId: 'NV-2',
    });
    // La caja de 10 no cabe en NV-2 (faltan 3): va a NV-1.
    expect(evaluateLoadScan('17802820005452', context())).toMatchObject({
      ok: true,
      orderId: 'NV-1',
    });
    const full = orders();
    full[0].lines[0].loaded = 12;
    full[1].lines[0].loaded = 3;
    expect(evaluateLoadScan('7802820005455', context(full))).toMatchObject({
      ok: false,
      reason: 'YA_CARGADO',
    });
  });

  it('la etiqueta del pedido sube todo lo que falta de ese pedido', () => {
    const partly = orders();
    partly[1].lines[0].loaded = 1;
    expect(evaluateLoadScan('nv-2', context(partly))).toEqual({
      ok: true,
      kind: 'BULTO',
      orderId: 'NV-2',
      units: [
        { sku: cement.sku, quantity: 2 },
        { sku: tile.sku, quantity: 2 },
      ],
      message: 'Pedido NV-2 completo: 4 unidades a bordo.',
    });
  });

  it('dice en qué camión va lo que no corresponde', () => {
    expect(evaluateLoadScan('NV-9', context())).toMatchObject({
      ok: false,
      reason: 'OTRO_CAMION',
      message: 'El pedido NV-9 va en el camión ABCD12, no en LXCD21.',
    });
    expect(evaluateLoadScan(drill.sku, context())).toMatchObject({
      ok: false,
      reason: 'OTRO_CAMION',
      message: expect.stringContaining('ABCD12'),
    });
    expect(evaluateLoadScan('000', context())).toMatchObject({
      ok: false,
      reason: 'CODIGO_DESCONOCIDO',
    });
    const lone = DEMO_PRODUCTS.find((p) => p.sku === 'BOS-GWS700')!;
    expect(
      evaluateLoadScan(lone.sku, { ...context(), products: [...products, lone] }),
    ).toMatchObject({
      ok: false,
      reason: 'NO_ESTA_EN_CAMION',
    });
  });

  it('cierra: lo que tiene algo a bordo queda cargado, lo que falta con motivo', () => {
    const progress = orders();
    progress[0].lines[0].loaded = 12;
    progress[1].lines[0].loaded = 3;
    expect(() => closeLoad(progress, [])).toThrow(
      expect.objectContaining({ code: 'CARGA_INCOMPLETA' }),
    );
    expect(
      closeLoad(progress, [{ orderId: 'NV-2', sku: tile.sku, reason: 'SIN_ESPACIO' }]),
    ).toEqual({
      loaded: ['NV-1', 'NV-2'],
      left: [],
      shortages: [
        { orderId: 'NV-2', sku: tile.sku, missing: 2, reason: 'SIN_ESPACIO', note: null },
      ],
    });
    const onlyFirst = orders();
    onlyFirst[0].lines[0].loaded = 12;
    expect(closeLoad(onlyFirst, [])).toMatchObject({ loaded: ['NV-1'], left: ['NV-2'] });
    expect(() => closeLoad(orders(), [])).toThrow(expect.objectContaining({ code: 'CARGA_VACIA' }));
  });
});
