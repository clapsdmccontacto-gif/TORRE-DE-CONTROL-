import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import { buildOrderImport, ORDER_COLUMNS, parseOrderSheet } from './import-orders.js';
import { EMPTY_MASTER_DATA, validateSite, type MasterDataSnapshot } from './master-data.js';

const header = ORDER_COLUMNS.map((c) => c.header);
const row = (values: Record<string, unknown>) =>
  ORDER_COLUMNS.map((c) => (values[c.field] ?? null) as string | number | null);
const [cement, rebar] = DEMO_PRODUCTS;

const data: MasterDataSnapshot = {
  ...EMPTY_MASTER_DATA,
  products: [cement, rebar],
  sites: [
    validateSite({
      id: 'OBRA-1',
      name: 'Edificio Las Rosas',
      commune: 'Los Ángeles',
      location: { lat: -37.47, lng: -72.35 },
      hasUnloadingEquipment: true,
      notifyEtaMinutes: 20,
    }),
  ],
  orders: [{ id: 'NV-1', siteId: 'OBRA-1', lines: [{ sku: cement.sku, quantity: 1 }] }],
};

describe('importar pedidos', () => {
  it('agrupa las filas por pedido, reconoce obras existentes y prepara las nuevas', () => {
    const preview = parseOrderSheet(
      [
        header,
        row({
          orderId: 'nv-1',
          customerName: 'Constructora Sur',
          siteName: 'edificio las rosas',
          commune: 'Los Angeles',
          address: 'Av. Alemania 1234',
          contactName: 'Juan',
          contactPhone: '+56 9 1111 2222',
          deliveryDate: '15-10-2026',
          sku: cement.sku,
          quantity: 20,
        }),
        row({
          orderId: 'NV-1',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: rebar.sku,
          quantity: '5',
        }),
        row({
          orderId: 'NV-1',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 5,
        }),
        row({
          orderId: 'NV-2',
          siteName: 'Casa Pérez',
          commune: 'Nacimiento',
          address: 'Los Robles 45',
          sku: cement.sku,
          quantity: 3,
        }),
        row({
          orderId: 'NV-3',
          siteName: 'Galpón Norte',
          commune: 'Mulchén',
          lat: -37.72,
          lng: -72.24,
          sku: rebar.sku,
          quantity: 1,
        }),
      ],
      data,
    );
    expect(preview.issues).toEqual([]);
    expect(preview.orders.map((o) => [o.id, o.action, o.lines])).toEqual([
      ['NV-1', 'ACTUALIZA', [2, 3, 4]],
      ['NV-2', 'NUEVO', [5]],
      ['NV-3', 'NUEVO', [6]],
    ]);
    expect(preview.orders[0].record).toEqual({
      id: 'NV-1',
      siteId: 'OBRA-1',
      lines: [
        { sku: cement.sku, quantity: 25 },
        { sku: rebar.sku, quantity: 5 },
      ],
      customerName: 'Constructora Sur',
      deliveryDate: '2026-10-15',
      notes: null,
    });
    expect(preview.sites.map((s) => [s.id, s.action, s.location !== null])).toEqual([
      ['OBRA-1', 'ACTUALIZA', true],
      ['OBRA-CASA-PEREZ-NACIMIENTO', 'NUEVA', false],
      ['OBRA-GALPON-NORTE-MULCHEN', 'NUEVA', true],
    ]);
    expect(preview.sites[0]).toMatchObject({
      address: 'Av. Alemania 1234',
      contactName: 'Juan',
      hasUnloadingEquipment: true,
    });

    // Sin ubicar Casa Pérez, su pedido queda fuera; ubicada, entra.
    const partial = buildOrderImport(preview);
    expect(partial.orders.map((o) => o.id)).toEqual(['NV-1', 'NV-3']);
    expect(partial.skipped).toEqual(['NV-2']);
    expect(partial.sites.map((s) => s.id)).toEqual(['OBRA-1', 'OBRA-GALPON-NORTE-MULCHEN']);
    const full = buildOrderImport(preview, { [preview.sites[1].key]: { lat: -37.5, lng: -72.6 } });
    expect(full.orders).toHaveLength(3);
    expect(full.sites.find((s) => s.id === 'OBRA-CASA-PEREZ-NACIMIENTO')).toMatchObject({
      address: 'Los Robles 45',
      location: { lat: -37.5, lng: -72.6 },
    });
  });

  it('un pedido con una fila mala queda fuera completo, con el error de cada fila', () => {
    const preview = parseOrderSheet(
      [
        header,
        row({
          orderId: 'NV-7',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 2,
        }),
        row({
          orderId: 'NV-7',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: 'NO-EXISTE',
          quantity: 2,
        }),
        row({ orderId: 'NV-8', siteName: 'Obra sin comuna', sku: cement.sku, quantity: 2 }),
        row({
          orderId: 'NV-9',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 0,
        }),
        row({
          orderId: 'NV-10',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 1,
          deliveryDate: '32-13-2026',
        }),
        row({
          orderId: 'NV-11',
          siteName: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 1,
        }),
        row({
          orderId: 'NV-11',
          siteName: 'Otra obra',
          commune: 'Los Ángeles',
          sku: cement.sku,
          quantity: 1,
        }),
      ],
      data,
    );
    expect(preview.orders).toEqual([]);
    expect(preview.issues.map((i) => [i.line, i.message])).toEqual([
      [
        2,
        'El pedido NV-7 no se importa: corrija sus filas con error y vuelva a cargar la planilla.',
      ],
      [3, 'El producto NO-EXISTE no está en «Productos»: impórtelo primero.'],
      [4, 'Comuna: obligatoria para la obra nueva «Obra sin comuna».'],
      [5, 'Cantidad: un número mayor que 0.'],
      [6, expect.stringContaining('Fecha de entrega')],
      [
        7,
        'El pedido NV-11 no se importa: corrija sus filas con error y vuelva a cargar la planilla.',
      ],
      [8, expect.stringContaining('un pedido va a una sola obra')],
    ]);
  });
});
