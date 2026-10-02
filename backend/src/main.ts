import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { basicAuth } from './common/basic-auth.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Publicada en internet: exigir clave hasta que exista el login por roles.
  if (process.env.BASIC_AUTH_PASSWORD) {
    app.use(
      basicAuth(process.env.BASIC_AUTH_USER ?? 'torre', process.env.BASIC_AUTH_PASSWORD, [
        '/api/v1/health',
      ]),
    );
  }
  configureApp(app);
  // En producción el mismo servicio entrega la interfaz (build del frontend en modo API).
  if (process.env.STATIC_DIR) app.useStaticAssets(resolve(process.env.STATIC_DIR));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
