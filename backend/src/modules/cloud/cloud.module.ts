import { Global, Module } from '@nestjs/common';
import { MemoryStateStore } from '../master-data/application/state-store.port.js';
import { PostgresStateStore } from '../master-data/infrastructure/postgres-state-store.js';
import { CloudController } from './http/cloud.controller.js';
import { AccessControl } from './infrastructure/access-control.js';

/** Clave de acceso de la empresa (guardada en PostgreSQL junto a los datos maestros). */
@Global()
@Module({
  controllers: [CloudController],
  providers: [
    {
      provide: AccessControl,
      useFactory: async () => {
        const url = process.env.DATABASE_URL?.trim();
        const access = new AccessControl(
          url ? new PostgresStateStore(url, 'access') : new MemoryStateStore(),
        );
        await access.ready;
        return access;
      },
    },
  ],
  exports: [AccessControl],
})
export class CloudModule {}
