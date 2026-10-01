import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('API Torre de Control (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health', () =>
    request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', service: 'torre-control-api' }));

  it('POST /api/v1/picking/mix-check bloquea cemento con herramientas', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/picking/mix-check')
      .send({
        cartType: 'MODULAR',
        currentLines: [{ sku: 'MAK-HP1630', quantity: 1 }],
        incoming: { sku: 'CEM-ESP-25', quantity: 2 },
      })
      .expect(200);

    expect(res.body.decision).toBe('BLOQUEADO');
    expect(res.body.cart.type).toBe('MODULAR');
    expect(res.body.violations[0]).toMatchObject({
      rule: 'MEZCLA_INCOMPATIBLE',
      severity: 'BLOQUEO',
      skus: ['CEM-ESP-25', 'MAK-HP1630'],
    });
  });

  it('POST /api/v1/load-planning/cubicaje recomienda camión pluma para fierros', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/load-planning/cubicaje')
      .send({ lines: [{ sku: 'FIE-A630-12', quantity: 40 }] })
      .expect(200);

    expect(res.body.recommendation.vehicleCode).toBe('CAMION_PLUMA');
    expect(res.body.evaluations).toHaveLength(3);
  });

  it('responde 400 con detalle por campo cuando el body es inválido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/picking/mix-check')
      .send({ cartType: 'CARRETILLA', incoming: { sku: 'MAK-HP1630', quantity: -1 } })
      .expect(400);

    expect(res.body.code).toBe('SOLICITUD_INVALIDA');
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual([
      'cartType',
      'incoming.quantity',
    ]);
  });

  it('responde 422 cuando un SKU no existe', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/load-planning/cubicaje')
      .send({ lines: [{ sku: 'NO-EXISTE', quantity: 1 }] })
      .expect(422);

    expect(res.body).toMatchObject({ code: 'SKU_DESCONOCIDO', details: { skus: ['NO-EXISTE'] } });
  });
});
