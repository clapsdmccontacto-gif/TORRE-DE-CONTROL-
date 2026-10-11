import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

describe('Flujo completo: importar → pickear → despachar → entregar (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sigue cada pedido de punta a punta con su historial', async () => {
    const s = app.getHttpServer();
    const post = (url: string, body: unknown, status = 200) =>
      request(s)
        .post(`/api/v1${url}`)
        .send(body as object)
        .expect(status);

    // 1. Datos de la empresa e importación desde planilla.
    await request(s)
      .put('/api/v1/master-data/depot')
      .send({ name: 'Bodega', location: { lat: -37.461, lng: -72.339 } })
      .expect(200);
    await post('/master-data/vehicles', { plate: 'LXCD21', vehicleCode: 'CAMION_3_4' });
    await post('/master-data/import/products', {
      products: [
        {
          sku: 'CEM-25',
          name: 'Cemento 25 kg',
          handlingClass: 'GRANEL_PESADO',
          unitWeightKg: 25,
          lengthCm: 60,
          widthCm: 40,
          heightCm: 12,
          binLocation: 'P1-R1',
          barcodes: [
            { code: '7802820005455', unitsPerScan: 1 },
            { code: '17802820005452', unitsPerScan: 10 },
          ],
        },
        {
          sku: 'ADI-5',
          name: 'Aditivo 5 L',
          handlingClass: 'QUIMICO',
          unitWeightKg: 5,
          lengthCm: 20,
          widthCm: 20,
          heightCm: 30,
          binLocation: 'P2-R1',
          barcodes: [{ code: '036000291452', unitsPerScan: 1 }],
        },
      ],
    });
    await post('/master-data/import/orders', {
      sites: [
        {
          id: 'OBRA-1',
          name: 'Edificio Las Rosas',
          commune: 'Los Ángeles',
          location: { lat: -37.465, lng: -72.351 },
          address: 'Av. Alemania 1234',
        },
        {
          id: 'OBRA-2',
          name: 'Casa Muñoz',
          commune: 'Los Ángeles',
          location: { lat: -37.455, lng: -72.33 },
        },
      ],
      orders: [
        {
          id: 'NV-1',
          siteId: 'OBRA-1',
          customerName: 'Constructora Sur',
          lines: [
            { sku: 'CEM-25', quantity: 11 },
            { sku: 'ADI-5', quantity: 2 },
          ],
        },
        { id: 'NV-2', siteId: 'OBRA-2', lines: [{ sku: 'ADI-5', quantity: 3 }] },
      ],
    });
    const plan = await post('/routing/optimize', {
      deliveryIds: ['NV-1', 'NV-2'],
      dieselPriceClp: 1_100,
    });
    expect(plan.body.unassigned).toEqual([]);
    await post(`/routing/plans/${plan.body.id}/publish`, {});

    // 2. Picking con escaneo (con errores).
    let n = 0;
    const pick = (order: string, code: string) =>
      post(`/picking/orders/${order}/scans`, {
        id: `PICK-${++n}-xxxx`,
        code,
        operator: 'Ana Rojas',
      });
    await post('/picking/orders/NV-1/claim', { operator: 'Ana Rojas' });
    expect((await pick('NV-1', '17802820005452')).body.ok).toBe(true);
    expect((await pick('NV-1', '7802820005455')).body.ok).toBe(true);
    expect((await pick('NV-1', '7802820005455')).body.event.result).toBe('EXCEDE_CANTIDAD');
    expect((await pick('NV-1', '9999')).body.event.result).toBe('CODIGO_DESCONOCIDO');
    expect((await pick('NV-1', '0036000291452')).body.ok).toBe(true);
    await post('/picking/orders/NV-1/close', {
      operator: 'Ana Rojas',
      shortages: [{ sku: 'ADI-5', reason: 'SIN_STOCK' }],
    });
    await post('/picking/orders/NV-2/claim', { operator: 'Ana Rojas' });
    for (let i = 0; i < 3; i++) await pick('NV-2', '036000291452');
    await post('/picking/orders/NV-2/close', { operator: 'Ana Rojas', shortages: [] });

    // 3. Despacho: etiqueta de un pedido, productos del otro.
    let m = 0;
    const load = (code: string) =>
      post('/dispatch/trucks/LXCD21/scans', {
        id: `LOAD-${++m}-xxxx`,
        code,
        operator: 'Luis Soto',
      });
    const truck = await request(s).get('/api/v1/dispatch/trucks/LXCD21').expect(200);
    expect(truck.body.loadOrders.map((o: { orderId: string }) => o.orderId)).toEqual(
      [...plan.body.routes[0].stops].reverse().map((st: { deliveryId: string }) => st.deliveryId),
    );
    expect((await load('NV-1')).body).toMatchObject({ ok: true, event: { kind: 'BULTO' } });
    expect((await load('NV-1')).body.event.result).toBe('YA_CARGADO');
    for (let i = 0; i < 3; i++) expect((await load('036000291452')).body.ok).toBe(true);
    expect((await load('036000291452')).body.event.result).toBe('YA_CARGADO');
    const closed = await post('/dispatch/trucks/LXCD21/close', {
      operator: 'Luis Soto',
      shortages: [],
    });
    expect(closed.body.loaded).toBe(2);

    // 4. Ruta y entrega con comprobante.
    const session = await post(
      '/tracking/sessions',
      { driverName: 'Pedro Soto', vehiclePlate: 'LXCD21' },
      201,
    );
    await post('/deliveries', {
      id: 'POD-flujo-0000001',
      orderId: 'NV-1',
      sessionId: session.body.id,
      receiverName: 'Juan Pérez',
      receiverRut: '12.345.678-5',
      lines: [
        { sku: 'CEM-25', delivered: 11 },
        { sku: 'ADI-5', delivered: 1 },
      ],
      reason: 'Faltó un aditivo en bodega',
      signature: JPEG,
      photos: [JPEG],
      capturedAt: new Date().toISOString(),
    });

    // 5. Historial completo del pedido.
    const tracks = await request(s).get('/api/v1/orders/tracks').expect(200);
    const nv1 = tracks.body.find((t: { orderId: string }) => t.orderId === 'NV-1');
    expect(
      nv1.events.map((e: { status: string; actor: string }) => `${e.status}:${e.actor}`),
    ).toEqual([
      'EN_PICKING:Ana Rojas',
      'PICKEADO_PARCIAL:Ana Rojas',
      'CARGADO:Luis Soto',
      'EN_RUTA:Pedro Soto',
      'ENTREGA_PARCIAL:Pedro Soto',
    ]);
    expect(nv1.vehiclePlate).toBe('LXCD21');
    const nv2 = tracks.body.find((t: { orderId: string }) => t.orderId === 'NV-2');
    expect(nv2.status).toBe('EN_RUTA');
  });
});
