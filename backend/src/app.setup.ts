import type { INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';

/** Configuración compartida por main.ts y los tests e2e. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new DomainExceptionFilter());
  return app;
}
