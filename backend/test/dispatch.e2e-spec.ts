import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Despacho: carga de camiones con escaneo (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('valida el camión, asigna a mano, exige justificar faltantes y entrega la ruta al conductor', async () => {
    const s = app.getHttpServer();
    const post = (url: string, body: unknown, status = 200) =>
      request(s)
        .post(`/api/v1${url}`)
        .send(body as object)
        .expect(status);

    await request(s)
      .put('/api/v1/master-data/depot')
      .send({ name: 'Bodega', location: { lat: -37.461, lng: -72.339 } })
      .expect(200);
    await post('/master-data/vehicles', { plate: 'AAAA11', vehicleCode: 'CAMION_3_4' });
    await post('/master-data/vehicles', { plate: 'BBBB22', vehicleCode: 'CAMION_3_4' });
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
          binLocation: null,
          barcodes: [{ code: '7802820005455', unitsPerScan: 1 }],
        },
      ],
    });
    await post('/master-data/import/orders', {
      sites: [
        {
          id: 'OBRA-A',
          name: 'Obra A',
          commune: 'Los Ángeles',
          location: { lat: -37.465, lng: -72.351 },
        },
        {
          id: 'OBRA-B',
          name: 'Obra B',
          commune: 'Los Ángeles',
          location: { lat: -37.455, lng: -72.33 },
        },
      ],
      orders: [
        { id: 'NV-A', siteId: 'OBRA-A', lines: [{ sku: 'CEM-25', quantity: 2 }] },
        { id: 'NV-B', siteId: 'OBRA-B', lines: [{ sku: 'CEM-25', quantity: 2 }] },
      ],
    });
    for (const id of ['NV-A', 'NV-B']) {
      await post(`/picking/orders/${id}/claim`, { operator: 'Ana' });
      for (let i = 0; i < 2; i++) {
        await post(`/picking/orders/${id}/scans`, {
          id: `P-${id}-${i}-xxxx`,
          code: 'CEM-25',
          operator: 'Ana',
        });
      }
      await post(`/picking/orders/${id}/close`, { operator: 'Ana', shortages: [] });
    }

    // Sin plan publicado: los pedidos pickeados aparecen sin camión y se asignan a mano.
    const before = await request(s).get('/api/v1/dispatch/trucks/AAAA11').expect(200);
    expect(before.body.unassigned.map((o: { orderId: string }) => o.orderId)).toEqual([
      'NV-A',
      'NV-B',
    ]);
    const session = await post(
      '/tracking/sessions',
      { driverName: 'Pedro', vehiclePlate: 'BBBB22' },
      201,
    );
    expect(session.body.stops).toEqual([]);
    await post('/dispatch/trucks/AAAA11/assign', { orderId: 'NV-A', operator: 'Luis Soto' });
    await post('/dispatch/trucks/BBBB22/assign', { orderId: 'NV-B', operator: 'Luis Soto' });

    // El conductor que ya salió recibe la parada asignada a mano.
    const live = await request(s).get('/api/v1/tracking/live').expect(200);
    const driver = live.body.devices.find(
      (x: { vehiclePlate: string }) => x.vehiclePlate === 'BBBB22',
    );
    expect(driver.stops.map((st: { deliveryId: string }) => st.deliveryId)).toEqual(['NV-B']);

    const units = await request(s).get('/api/v1/tracking/units').expect(200);
    expect(units.body).toEqual([
      expect.objectContaining({ plate: 'AAAA11', stops: 1 }),
      expect.objectContaining({ plate: 'BBBB22', stops: 1 }),
    ]);

    // Un producto de otro camión dice cuál es el correcto.
    const wrong = await post('/dispatch/trucks/AAAA11/scans', {
      id: 'L-wrong-xxxx',
      code: 'NV-B',
      operator: 'Luis Soto',
    });
    expect(wrong.body).toMatchObject({ ok: false, event: { result: 'OTRO_CAMION' } });
    expect(wrong.body.message).toContain('BBBB22');

    await post('/dispatch/trucks/AAAA11/scans', {
      id: 'L-1-xxxxxxxx',
      code: '7802820005455',
      operator: 'Luis Soto',
    });
    const undone = await post('/dispatch/trucks/AAAA11/undo', {
      id: 'L-undo-xxxx',
      operator: 'Luis Soto',
    });
    expect(undone.body.progress).toEqual({ loaded: 0, picked: 2 });
    await post('/dispatch/trucks/AAAA11/scans', {
      id: 'L-2-xxxxxxxx',
      code: '7802820005455',
      operator: 'Luis Soto',
    });

    // Falta una unidad: hay que justificarla para cerrar.
    const missing = await post(
      '/dispatch/trucks/AAAA11/close',
      { operator: 'Luis Soto', shortages: [] },
      422,
    );
    expect(missing.body.code).toBe('CARGA_INCOMPLETA');
    const closed = await post('/dispatch/trucks/AAAA11/close', {
      operator: 'Luis Soto',
      shortages: [{ orderId: 'NV-A', sku: 'CEM-25', reason: 'SIN_ESPACIO' }],
    });
    expect(closed.body.loaded).toBe(1);
    const empty = await post(
      '/dispatch/trucks/BBBB22/close',
      { operator: 'Luis Soto', shortages: [] },
      422,
    );
    expect(empty.body.code).toBe('CARGA_VACIA');

    const tracks = await request(s).get('/api/v1/orders/tracks').expect(200);
    const nvA = tracks.body.find((t: { orderId: string }) => t.orderId === 'NV-A');
    expect(nvA).toMatchObject({ status: 'CARGADO', vehiclePlate: 'AAAA11' });
    expect(nvA.events.at(-1)).toMatchObject({
      actor: 'Luis Soto',
      detail: expect.stringContaining('no subió: 1 Cemento 25 kg (No cupo en el camión)'),
    });
  });
});
