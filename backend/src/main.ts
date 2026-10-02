import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // La API la protege la clave de acceso de la empresa (módulo cloud), que se crea en la
  // propia app: no hay contraseñas del navegador ni de Render que buscar.
  configureApp(app);
  // En producción el mismo servicio entrega la interfaz (build del frontend en modo API).
  if (process.env.STATIC_DIR) app.useStaticAssets(resolve(process.env.STATIC_DIR));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
