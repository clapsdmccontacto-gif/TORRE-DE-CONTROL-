import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedTestData } from './seed.js';

describe('Bodega: picking con escaneo (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
    await seedTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('un operario toma un pedido, escanea, cierra con faltante y la torre lo ve', async () => {
    const server = app.getHttpServer();
    const queue = await request(server).get('/api/v1/picking/orders').expect(200);
    expect(queue.body.length).toBeGreaterThan(0);
    const order = queue.body[0];
    const detail = await request(server).get(`/api/v1/picking/orders/${order.orderId}`).expect(200);
    const [first, ...rest] = detail.body.lines;

    await request(server)
      .post(`/api/v1/picking/orders/${order.orderId}/claim`)
      .send({ operator: 'Ana Rojas', device: 'PDA-1' })
      .expect(200);
    const taken = await request(server)
      .post(`/api/v1/picking/orders/${order.orderId}/claim`)
      .send({ operator: 'Luis' })
      .expect(422);
    expect(taken.body).toMatchObject({
      code: 'PEDIDO_TOMADO',
      message: expect.stringContaining('Ana Rojas'),
    });

    // El SKU escrito a mano vale una unidad (los productos de prueba no traen códigos).
    let last;
    for (let i = 0; i < first.ordered; i++) {
      last = await request(server)
        .post(`/api/v1/picking/orders/${order.orderId}/scans`)
        .send({ id: `SCAN-e2e-${i}`, code: first.sku, operator: 'Ana Rojas', device: 'PDA-1' })
        .expect(200);
      expect(last.body.ok).toBe(true);
    }
    const again = await request(server)
      .post(`/api/v1/picking/orders/${order.orderId}/scans`)
      .send({ id: 'SCAN-e2e-0', code: first.sku, operator: 'Ana Rojas' })
      .expect(200);
    expect(again.body.view.lines.find((l: { sku: string }) => l.sku === first.sku).picked).toBe(
      first.ordered,
    );
    const extra = await request(server)
      .post(`/api/v1/picking/orders/${order.orderId}/scans`)
      .send({ id: 'SCAN-e2e-extra', code: first.sku, operator: 'Ana Rojas' })
      .expect(200);
    expect(extra.body).toMatchObject({ ok: false, event: { result: 'EXCEDE_CANTIDAD' } });

    const shortages = rest.map((l: { sku: string }) => ({ sku: l.sku, reason: 'SIN_STOCK' }));
    const closed = await request(server)
      .post(`/api/v1/picking/orders/${order.orderId}/close`)
      .send({ operator: 'Ana Rojas', shortages })
      .expect(200);
    expect(closed.body.status).toBe(rest.length ? 'PICKEADO_PARCIAL' : 'PICKEADO');

    const monitor = await request(server).get('/api/v1/picking/monitor').expect(200);
    expect(
      monitor.body.orders.find((o: { orderId: string }) => o.orderId === order.orderId),
    ).toMatchObject({
      status: closed.body.status,
      shortages: rest.map((l: { sku: string }) => expect.objectContaining({ sku: l.sku })),
    });
    const tracks = await request(server).get('/api/v1/orders/tracks').expect(200);
    expect(
      tracks.body
        .find((t: { orderId: string }) => t.orderId === order.orderId)
        .events.map((e: { status: string }) => e.status),
    ).toEqual(['EN_PICKING', closed.body.status]);
  });

  it('valida las solicitudes', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/picking/orders/NV-1/scans')
      .send({ id: 'x', code: '' })
      .expect(400);
    const unknown = await request(server)
      .post('/api/v1/picking/orders/NO-EXISTE/claim')
      .send({ operator: 'Ana' })
      .expect(422);
    expect(unknown.body.code).toBe('PEDIDO_DESCONOCIDO');
  });

  it('transmite el monitor por Server-Sent Events', async () => {
    const server = app.getHttpServer() as unknown as Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/picking/stream`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    controller.abort();
    const text = new TextDecoder().decode(value);
    const data = JSON.parse(
      text
        .split('\n')
        .find((l) => l.startsWith('data:'))!
        .slice(5),
    );
    expect(data).toMatchObject({ generatedAt: expect.any(String), orders: expect.any(Array) });
  });
});
