import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Nube: clave de acceso y CORS (e2e)', () => {
  let app: INestApplication<App>;
  const previous = process.env.ACCESS_CONTROL;

  beforeAll(async () => {
    process.env.ACCESS_CONTROL = 'on';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    process.env.ACCESS_CONTROL = previous;
    await app.close();
  });

  it('pide crear la clave la primera vez y después la exige en toda la API', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/api/v1/cloud/status')
      .expect(200)
      .expect({ service: 'torre-control', claimed: false, canClaim: true });
    const blocked = await request(server).get('/api/v1/master-data').expect(403);
    expect(blocked.body.code).toBe('NUBE_SIN_CLAVE');

    // Sin datos todavía, una clave mal escrita u olvidada se reemplaza creando otra.
    await request(server).post('/api/v1/cloud/claim').send({ key: 'mal-escrita' }).expect(200);
    await request(server)
      .get('/api/v1/cloud/status')
      .expect({ service: 'torre-control', claimed: true, canClaim: true });
    await request(server).post('/api/v1/cloud/claim').send({ key: 'Bodega-2026' }).expect(200);
    await request(server).get('/api/v1/master-data').set('x-torre-key', 'mal-escrita').expect(401);
    await request(server)
      .put('/api/v1/master-data/depot')
      .set('x-torre-key', 'bodega-2026')
      .send({ name: 'Bodega Los Ángeles', location: { lat: -37.47, lng: -72.35 } })
      .expect(200);

    // Con datos, la clave queda fija.
    await request(server)
      .get('/api/v1/cloud/status')
      .expect({ service: 'torre-control', claimed: true, canClaim: false });
    const again = await request(server)
      .post('/api/v1/cloud/claim')
      .send({ key: 'me-la-robo' })
      .expect(422);
    expect(again.body.code).toBe('NUBE_YA_CONFIGURADA');

    await request(server).get('/api/v1/master-data').expect(401);
    await request(server).get('/api/v1/master-data').set('x-torre-key', 'mala').expect(401);
    await request(server).get('/api/v1/master-data').set('x-torre-key', 'BODEGA-2026').expect(200);
    await request(server)
      .get('/api/v1/cloud/session')
      .query({ key: 'bodega-2026' })
      .expect(200)
      .expect({ ok: true });
    await request(server).get('/api/v1/health').expect(200);
  });

  it('deja llamar a la API desde la app en GitHub Pages (CORS)', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/master-data')
      .set('Origin', 'https://clapsdmccontacto-gif.github.io')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-torre-key')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://clapsdmccontacto-gif.github.io',
    );
    expect(preflight.headers['access-control-allow-headers']).toContain('x-torre-key');
    const other = await request(app.getHttpServer())
      .get('/api/v1/cloud/status')
      .set('Origin', 'https://sitio-ajeno.example')
      .expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('bloquea por 10 minutos tras 10 claves incorrectas', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 10; i++) {
      await request(server)
        .get('/api/v1/master-data')
        .set('x-forwarded-for', '203.0.113.9')
        .set('x-torre-key', `intento-${i}`)
        .expect(401);
    }
    const locked = await request(server)
      .get('/api/v1/master-data')
      .set('x-forwarded-for', '203.0.113.9')
      .set('x-torre-key', 'bodega-2026')
      .expect(429);
    expect(locked.body.code).toBe('DEMASIADOS_INTENTOS');
  });
});
