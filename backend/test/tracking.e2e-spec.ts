import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedTestData } from './seed.js';

describe('Rastreo y rutas (e2e)', () => {
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

  it('optimiza y publica un plan de rutas', async () => {
    const deliveries = await request(app.getHttpServer())
      .get('/api/v1/routing/deliveries')
      .expect(200);
    expect(deliveries.body).toHaveLength(10);

    const plan = await request(app.getHttpServer())
      .post('/api/v1/routing/optimize')
      .send({
        deliveryIds: deliveries.body.map((d: { id: string }) => d.id),
        dieselPriceClp: 1_100,
      })
      .expect(200);
    expect(plan.body.unassigned).toEqual([]);
    expect(plan.body.savings.fuelLiters).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/api/v1/routing/plans/${plan.body.id}/publish`)
      .expect(200);
    const active = await request(app.getHttpServer())
      .get('/api/v1/routing/plans/active')
      .expect(200);
    expect(active.body.plan.id).toBe(plan.body.id);
  });

  it('aplica la ruta por calles a una ruta del plan y valida el cuerpo', async () => {
    const plan = await request(app.getHttpServer())
      .post('/api/v1/routing/optimize')
      .send({ deliveryIds: ['NV-100231', 'NV-100235'] })
      .expect(200);
    const route = plan.body.routes[0];
    const n = route.stops.length;
    const url = `/api/v1/routing/plans/${plan.body.id}/routes/${route.unitPlate}/road`;
    const body = {
      stopOrder: route.stops.map((_: unknown, i: number) => i),
      legs: Array.from({ length: n + 1 }, () => ({ distanceKm: 6.2, durationMin: 11 })),
      path: route.path,
      trafficDelayMin: 4,
      tollKm: 0,
    };
    const adjusted = await request(app.getHttpServer()).post(url).send(body).expect(200);
    const updated = adjusted.body.routes.find(
      (r: { unitPlate: string }) => r.unitPlate === route.unitPlate,
    );
    expect(updated.road).toEqual({ trafficDelayMin: 4, tollKm: 0 });
    expect(updated.distanceKm).toBeCloseTo(6.2 * (n + 1), 1);

    await request(app.getHttpServer())
      .post(url)
      .send({ ...body, path: [] })
      .expect(400);
    const wrongOrder = await request(app.getHttpServer())
      .post(url)
      .send({ ...body, stopOrder: [99] })
      .expect(422);
    expect(wrongOrder.body.code).toBe('AJUSTE_INVALIDO');
  });

  it('registra un conductor, recibe su GPS y lo muestra en la flota en vivo', async () => {
    const units = await request(app.getHttpServer()).get('/api/v1/tracking/units').expect(200);
    expect(units.body.map((u: { plate: string }) => u.plate)).toContain('DEMO-02');

    const session = await request(app.getHttpServer())
      .post('/api/v1/tracking/sessions')
      .send({
        driverName: 'María González',
        driverPhone: '+56 9 8765 4321',
        vehiclePlate: 'DEMO-02',
      })
      .expect(201);

    const now = Date.now();
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/tracking/sessions/${session.body.id}/positions`)
      .send({
        fixes: [
          {
            lat: -37.461,
            lng: -72.339,
            accuracyM: 9,
            recordedAt: new Date(now - 30_000).toISOString(),
          },
          { lat: -37.462, lng: -72.341, accuracyM: 11, recordedAt: new Date(now).toISOString() },
        ],
      })
      .expect(200);
    expect(sent.body).toEqual({ accepted: 2, rejected: [] });

    const live = await request(app.getHttpServer()).get('/api/v1/tracking/live').expect(200);
    const device = live.body.devices.find(
      (d: { sessionId: string }) => d.sessionId === session.body.id,
    );
    expect(device).toMatchObject({
      driverName: 'María González',
      driverPhone: '+56 9 8765 4321',
      vehiclePlate: 'DEMO-02',
    });
    // Sin simulación: en el mapa sólo aparecen los teléfonos reales.
    expect(live.body.devices).toHaveLength(1);

    const track = await request(app.getHttpServer())
      .get(`/api/v1/tracking/sessions/${session.body.id}/track`)
      .expect(200);
    expect(track.body.fixes).toHaveLength(2);

    await request(app.getHttpServer())
      .post(`/api/v1/tracking/sessions/${session.body.id}/end`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/tracking/sessions/${session.body.id}/positions`)
      .send({ fixes: [{ lat: -37.46, lng: -72.34, recordedAt: new Date().toISOString() }] })
      .expect(422);
    // Una ruta que el servidor no conoce (se reinició) responde otro código: el teléfono la reanuda.
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/tracking/sessions/RUTA-de-antes-del-reinicio/positions')
      .send({ fixes: [{ lat: -37.46, lng: -72.34, recordedAt: new Date().toISOString() }] })
      .expect(422);
    expect(unknown.body.code).toBe('SESION_DESCONOCIDA');
  });

  it('valida las lecturas GPS', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tracking/sessions/RUTA-x/positions')
      .send({ fixes: [{ lat: 200, lng: -72.3, recordedAt: 'ayer' }] })
      .expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual([
      'fixes.0.lat',
      'fixes.0.recordedAt',
    ]);
  });

  it('transmite la flota en vivo por Server-Sent Events', async () => {
    const session = await request(app.getHttpServer())
      .post('/api/v1/tracking/sessions')
      .send({ driverName: 'Luis Rojas', vehiclePlate: 'DEMO-03' })
      .expect(201);
    const server = app.getHttpServer() as unknown as Server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/tracking/stream`, {
      signal: abort.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const { value } = await response.body!.getReader().read();
    abort.abort();
    const dataLine = new TextDecoder()
      .decode(value)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    const snapshot = JSON.parse(dataLine!.slice('data: '.length));
    expect(snapshot.devices.map((d: { sessionId: string }) => d.sessionId)).toContain(
      session.body.id,
    );
  });
});
