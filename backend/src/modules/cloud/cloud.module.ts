import { Global, Module } from '@nestjs/common';
import { MasterData } from '../master-data/application/master-data.js';
import { MemoryStateStore } from '../master-data/application/state-store.port.js';
import { PostgresStateStore } from '../master-data/infrastructure/postgres-state-store.js';
import { CloudController } from './http/cloud.controller.js';
import { AccessControl } from './infrastructure/access-control.js';

/**
 * Clave de acceso de la empresa (guardada en PostgreSQL junto a los datos maestros). Se
 * puede volver a crear mientras la nube no tenga datos; con datos, sólo la variable
 * ACCESS_KEY del servidor la reemplaza (recuperación si se olvida).
 */
@Global()
@Module({
  controllers: [CloudController],
  providers: [
    {
      provide: AccessControl,
      useFactory: async (data: MasterData) => {
        const url = process.env.DATABASE_URL?.trim();
        const access = new AccessControl(
          url ? new PostgresStateStore(url, 'access') : new MemoryStateStore(),
          { canReplace: () => isEmpty(data), fixedKey: process.env.ACCESS_KEY },
        );
        await access.ready;
        return access;
      },
      inject: [MasterData],
    },
  ],
  exports: [AccessControl],
})
export class CloudModule {}

function isEmpty(data: MasterData): boolean {
  const s = data.snapshot();
  return !s.depot && !s.vehicles.length && !s.products.length && !s.sites.length && !s.orders.length;
}
