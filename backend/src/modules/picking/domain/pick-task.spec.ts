import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import type { Product } from '../../catalog/domain/product.js';
import {
  closePick,
  evaluateScan,
  pickList,
  pickProgress,
  resolveCode,
  suggestCart,
} from './pick-task.js';

const [a, b, c] = DEMO_PRODUCTS;
const cement: Product = {
  ...a,
  binLocation: 'P2-R10-N1',
  barcodes: [
    { code: '7802820005455', unitsPerScan: 1 },
    { code: '17802820005452', unitsPerScan: 10 },
  ],
};
const second: Product = {
  ...b,
  binLocation: 'P2-R9-N1',
  barcodes: [{ code: '036000291452', unitsPerScan: 1 }],
};
const third: Product = { ...c, binLocation: null, barcodes: [] };
const products = [cement, second, third];
const order = [
  { product: cement, quantity: 12 },
  { product: second, quantity: 2 },
  { product: third, quantity: 1 },
];

describe('picking por código de barras', () => {
  it('sugiere el carro según lo que lleva el pedido', () => {
    const product = (sku: string) => DEMO_PRODUCTS.find((p) => p.sku === sku)!;
    expect(suggestCart([{ product: product('MAK-HP1630'), quantity: 1 }])).toBe('MODULAR');
    expect(suggestCart([{ product: product('CEM-ESP-25'), quantity: 2 }])).toBe(
      'PLATAFORMA_PESADA',
    );
    expect(suggestCart([{ product: product('FIE-A630-12'), quantity: 1 }])).toBe('CARRO_LARGOS');
  });

  it('ordena la lista por ubicación (orden natural) y deja sin ubicación al final', () => {
    expect(pickList(order, new Map()).map((l) => l.binLocation)).toEqual([
      'P2-R9-N1',
      'P2-R10-N1',
      null,
    ]);
  });

  it('reconoce EAN, UPC leído como EAN-13, caja y SKU escrito a mano', () => {
    expect(resolveCode(' 7802820005455 ', products)).toMatchObject({
      product: { sku: cement.sku },
      units: 1,
    });
    expect(resolveCode('0036000291452', products)).toMatchObject({ product: { sku: second.sku } });
    expect(resolveCode('17802820005452', products)?.units).toBe(10);
    expect(resolveCode(third.sku.toLowerCase(), products)).toMatchObject({
      product: { sku: third.sku },
      units: 1,
    });
    expect(resolveCode('999', products)).toBeNull();
  });

  it('acepta lo del pedido, suma la caja y rechaza lo desconocido, lo ajeno y el exceso', () => {
    let lines = pickList(order, new Map());
    expect(evaluateScan('17802820005452', products, lines)).toMatchObject({
      ok: true,
      units: 10,
      picked: 10,
    });
    lines = pickList(order, new Map([[cement.sku, 10]]));
    expect(evaluateScan('17802820005452', products, lines)).toMatchObject({
      ok: false,
      reason: 'EXCEDE_CANTIDAD',
    });
    expect(evaluateScan('7802820005455', products, lines)).toMatchObject({ ok: true, picked: 11 });
    lines = pickList(order, new Map([[cement.sku, 12]]));
    expect(evaluateScan('7802820005455', products, lines)).toMatchObject({
      ok: false,
      reason: 'EXCEDE_CANTIDAD',
    });
    expect(evaluateScan('123', products, lines)).toMatchObject({
      ok: false,
      reason: 'CODIGO_DESCONOCIDO',
    });
    const other = DEMO_PRODUCTS[3];
    expect(evaluateScan(other.sku, [...products, other], lines)).toMatchObject({
      ok: false,
      reason: 'NO_ESTA_EN_PEDIDO',
    });
  });

  it('avance y cierre: completo, con faltantes justificados o rechazado', () => {
    const complete = pickList(
      order,
      new Map([
        [cement.sku, 12],
        [second.sku, 2],
        [third.sku, 1],
      ]),
    );
    expect(pickProgress(complete)).toMatchObject({
      picked: 15,
      ordered: 15,
      fraction: 1,
      complete: true,
    });
    expect(closePick(complete, [])).toEqual({ status: 'PICKEADO', shortages: [] });

    const partial = pickList(
      order,
      new Map([
        [cement.sku, 12],
        [second.sku, 1],
      ]),
    );
    expect(pickProgress(partial).complete).toBe(false);
    expect(() => closePick(partial, [{ sku: second.sku, reason: 'SIN_STOCK' }])).toThrow(
      expect.objectContaining({ code: 'FALTAN_PRODUCTOS' }),
    );
    expect(() =>
      closePick(partial, [
        { sku: second.sku, reason: 'SIN_STOCK' },
        { sku: third.sku, reason: 'OTRO' },
      ]),
    ).toThrow('Explique el faltante');
    expect(
      closePick(partial, [
        { sku: second.sku, reason: 'DANADO' },
        { sku: third.sku, reason: 'SIN_STOCK' },
      ]),
    ).toEqual({
      status: 'PICKEADO_PARCIAL',
      shortages: [
        { sku: second.sku, missing: 1, reason: 'DANADO', note: null },
        { sku: third.sku, missing: 1, reason: 'SIN_STOCK', note: null },
      ],
    });
    const none = pickList(order, new Map());
    expect(() =>
      closePick(
        none,
        order.map((l) => ({ sku: l.product.sku, reason: 'SIN_STOCK' as const })),
      ),
    ).toThrow(expect.objectContaining({ code: 'PICKING_VACIO' }));
  });
});
