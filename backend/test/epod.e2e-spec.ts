import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedTestData } from './seed.js';

// JPEG mínimo válido (1×1 px) para la foto y la firma.
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

describe('Entregas con comprobante (e2e)', () => {
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

  it('el conductor entrega con firma y foto; la torre ve el comprobante y el pedido entregado', async () => {
    const server = app.getHttpServer();
    const deliveries = await request(server).get('/api/v1/routing/deliveries').expect(200);
    const plan = await request(server)
      .post('/api/v1/routing/optimize')
      .send({
        deliveryIds: deliveries.body.map((d: { id: string }) => d.id),
        dieselPriceClp: 1_100,
      })
      .expect(200);
    await request(server).post(`/api/v1/routing/plans/${plan.body.id}/publish`).expect(200);
    const route = plan.body.routes.find((r: { stops: unknown[] }) => r.stops.length > 0);
    const stop = route.stops[0];
    const session = await request(server)
      .post('/api/v1/tracking/sessions')
      .send({ driverName: 'Pedro Soto', vehiclePlate: route.unitPlate })
      .expect(201);

    // Al iniciar la ruta, sus pedidos salen a ruta y ya no se planifican de nuevo.
    const tracks = await request(server).get('/api/v1/orders/tracks').expect(200);
    expect(
      tracks.body.find((t: { orderId: string }) => t.orderId === stop.deliveryId),
    ).toMatchObject({
      status: 'EN_RUTA',
      vehiclePlate: route.unitPlate,
    });
    const live = await request(server).get('/api/v1/tracking/live').expect(200);
    expect(live.body.devices[0].stops[0]).toMatchObject({
      deliveryId: stop.deliveryId,
      details: { commune: expect.any(String) },
      outcome: null,
    });

    const submission = {
      id: 'POD-e2e-0000001',
      orderId: stop.deliveryId,
      sessionId: session.body.id,
      receiverName: 'Juan Pérez',
      receiverRut: '12.345.678-5',
      lines: stop.lines.map((l: { sku: string; quantity: number }) => ({
        sku: l.sku,
        delivered: l.quantity,
      })),
      signature: JPEG,
      photos: [JPEG],
      position: { lat: stop.location.lat + 0.0003, lng: stop.location.lng, accuracyM: 9 },
      capturedAt: new Date().toISOString(),
    };
    const proof = await request(server).post('/api/v1/deliveries').send(submission).expect(200);
    expect(proof.body).toMatchObject({
      outcome: 'ENTREGADO',
      farFromSite: false,
      receiverRut: '12345678-5',
    });
    // Reintento sin señal: mismo comprobante.
    const again = await request(server).post('/api/v1/deliveries').send(submission).expect(200);
    expect(again.body.receivedAt).toBe(proof.body.receivedAt);

    const list = await request(server)
      .get('/api/v1/deliveries')
      .query({ outcome: 'ENTREGADO' })
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual(['POD-e2e-0000001']);
    const photo = proof.body.images.find((i: { kind: string }) => i.kind === 'FOTO');
    const image = await request(server)
      .get(`/api/v1/deliveries/${proof.body.id}/images/${photo.id}`)
      .expect(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.body.length).toBeGreaterThan(100);

    const after = await request(server).get('/api/v1/orders/tracks').expect(200);
    expect(after.body.find((t: { orderId: string }) => t.orderId === stop.deliveryId).status).toBe(
      'ENTREGADO',
    );
    const liveAfter = await request(server).get('/api/v1/tracking/live').expect(200);
    expect(liveAfter.body.devices[0].stops[0]).toMatchObject({
      state: 'COMPLETADA',
      outcome: 'ENTREGADO',
    });
    expect(liveAfter.body.events[0]).toMatchObject({
      type: 'ENTREGA_REGISTRADA',
      outcome: 'ENTREGADO',
    });
    const plannable = await request(server).get('/api/v1/routing/deliveries').expect(200);
    expect(plannable.body.map((d: { id: string }) => d.id)).not.toContain(stop.deliveryId);
  });

  it('valida el comprobante y los filtros', async () => {
    const server = app.getHttpServer();
    const bad = await request(server)
      .post('/api/v1/deliveries')
      .send({ id: 'x', orderId: 'NV-1', sessionId: 'S', lines: [], photos: [], capturedAt: 'hoy' })
      .expect(400);
    expect(bad.body.code).toBe('SOLICITUD_INVALIDA');
    const unknown = await request(server)
      .post('/api/v1/deliveries')
      .send({
        id: 'POD-e2e-0000002',
        orderId: 'NV-1',
        sessionId: 'RUTA-inexistente',
        lines: [],
        photos: [JPEG],
        capturedAt: new Date().toISOString(),
      })
      .expect(422);
    expect(unknown.body.code).toBe('RUTA_DESCONOCIDA');
    await request(server).get('/api/v1/deliveries').query({ from: 'ayer' }).expect(400);
  });
});
