import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DEMO_DEPOT, DEMO_ORDERS, DEMO_SITES, DEMO_UNITS } from './fixtures/demo-network.js';
import { DEMO_PRODUCTS } from './fixtures/demo-products.js';

/** Carga los datos de prueba por la API, igual que lo haría la empresa desde la interfaz. */
export async function seedTestData(app: INestApplication<App>): Promise<void> {
  const server = app.getHttpServer();
  await request(server).put('/api/v1/master-data/depot').send(DEMO_DEPOT).expect(200);
  for (const unit of DEMO_UNITS) {
    await request(server)
      .post('/api/v1/master-data/vehicles')
      .send({ plate: unit.plate, vehicleCode: unit.vehicle.code })
      .expect(200);
  }
  for (const product of DEMO_PRODUCTS) {
    await request(server).post('/api/v1/master-data/products').send(product).expect(200);
  }
  for (const site of DEMO_SITES) {
    await request(server).post('/api/v1/master-data/sites').send(site).expect(200);
  }
  for (const order of DEMO_ORDERS) {
    await request(server)
      .post('/api/v1/master-data/orders')
      .send({
        id: order.id,
        siteId: order.site.id,
        lines: order.lines.map((l) => ({ sku: l.product.sku, quantity: l.quantity })),
      })
      .expect(200);
  }
}
