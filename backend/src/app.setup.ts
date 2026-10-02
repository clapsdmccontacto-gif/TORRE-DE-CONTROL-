import type { INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { AccessControl } from './modules/cloud/infrastructure/access-control.js';

/** Orígenes que pueden llamar a la API desde otro dominio (la app en GitHub Pages). */
export function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'https://clapsdmccontacto-gif.github.io')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Configuración compartida por main.ts y los tests e2e. */
export function configureApp(app: INestApplication): INestApplication {
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-torre-key'],
    maxAge: 600,
  });
  // Clave de acceso de la empresa en toda la API (ACCESS_CONTROL=off sólo en tests).
  if (process.env.ACCESS_CONTROL !== 'off') app.use(app.get(AccessControl).middleware());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new DomainExceptionFilter());
  return app;
}
