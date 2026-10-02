import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DEMO_PRODUCTS } from './fixtures/demo-products.js';

describe('Datos maestros (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('la app parte vacía: sin datos de muestra ni camiones simulados', async () => {
    const data = await request(app.getHttpServer()).get('/api/v1/master-data').expect(200);
    expect(data.body).toMatchObject({
      depot: null,
      vehicles: [],
      products: [],
      sites: [],
      orders: [],
    });
    expect(data.body.vehicleTypes).toHaveLength(3);
    const live = await request(app.getHttpServer()).get('/api/v1/tracking/live').expect(200);
    expect(live.body.devices).toEqual([]);
    await request(app.getHttpServer()).get('/api/v1/catalog/products').expect(200).expect([]);
    await request(app.getHttpServer()).get('/api/v1/tracking/units').expect(200).expect([]);
    const optimize = await request(app.getHttpServer())
      .post('/api/v1/routing/optimize')
      .send({ deliveryIds: ['NV-1'] })
      .expect(422);
    expect(optimize.body.code).toBe('PEDIDO_DESCONOCIDO');
  });

  it('agrega, edita y quita camiones, productos, obras y pedidos', async () => {
    const server = app.getHttpServer();
    const truck = await request(server)
      .post('/api/v1/master-data/vehicles')
      .send({ plate: 'hjkl 34', vehicleCode: 'CAMION_PLUMA' })
      .expect(200);
    expect(truck.body.vehicles).toEqual([
      { plate: 'HJKL34', vehicleCode: 'CAMION_PLUMA', vehicleName: 'Camión pluma' },
    ]);
    const units = await request(server).get('/api/v1/tracking/units').expect(200);
    expect(units.body).toEqual([{ plate: 'HJKL34', vehicleName: 'Camión pluma', stops: 0 }]);

    await request(server).post('/api/v1/master-data/products').send(DEMO_PRODUCTS[0]).expect(200);
    const site = await request(server)
      .post('/api/v1/master-data/sites')
      .send({ name: 'Obra Centro', commune: 'Los Ángeles', location: { lat: -37.47, lng: -72.35 } })
      .expect(200);
    const siteId = site.body.sites[0].id;
    const order = await request(server)
      .post('/api/v1/master-data/orders')
      .send({ id: 'nv-9', siteId, lines: [{ sku: DEMO_PRODUCTS[0].sku, quantity: 3 }] })
      .expect(200);
    expect(order.body.orders[0]).toMatchObject({ id: 'NV-9', siteName: 'Obra Centro' });
    const deliveries = await request(server).get('/api/v1/routing/deliveries').expect(200);
    expect(deliveries.body.map((d: { id: string }) => d.id)).toEqual(['NV-9']);

    const blocked = await request(server).delete(`/api/v1/master-data/sites/${siteId}`).expect(422);
    expect(blocked.body.code).toBe('OBRA_CON_PEDIDOS');
    const noDepot = await request(server)
      .post('/api/v1/routing/optimize')
      .send({ deliveryIds: ['NV-9'] })
      .expect(422);
    expect(noDepot.body.code).toBe('SIN_BODEGA');

    await request(server).delete('/api/v1/master-data/orders/NV-9').expect(200);
    await request(server).delete(`/api/v1/master-data/sites/${siteId}`).expect(200);
    const cleared = await request(server).delete('/api/v1/master-data/vehicles/HJKL34').expect(200);
    expect(cleared.body.vehicles).toEqual([]);
  });

  it('valida lo que se ingresa', async () => {
    const server = app.getHttpServer();
    const plate = await request(server)
      .post('/api/v1/master-data/vehicles')
      .send({ plate: 'X', vehicleCode: 'CAMIONETA' })
      .expect(422);
    expect(plate.body.code).toBe('PATENTE_INVALIDA');
    await request(server)
      .post('/api/v1/master-data/products')
      .send({ sku: 'X', name: 'Y', handlingClass: 'OTRA' })
      .expect(400);
    const depot = await request(server)
      .put('/api/v1/master-data/depot')
      .send({ name: 'B', location: { lat: -37.4, lng: -72.3 } })
      .expect(422);
    expect(depot.body.code).toBe('DATO_INVALIDO');
  });
});
