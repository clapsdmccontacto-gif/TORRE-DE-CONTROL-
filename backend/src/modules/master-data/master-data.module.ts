import { Global, Logger, Module } from '@nestjs/common';
import { maxPayloadKg } from '../load-planning/domain/vehicle.js';
import { DEFAULT_FLEET } from '../load-planning/infrastructure/default-fleet.js';
import { MasterData } from './application/master-data.js';
import { MemoryStateStore } from './application/state-store.port.js';
import { MasterDataController } from './http/master-data.controller.js';
import { PostgresStateStore } from './infrastructure/postgres-state-store.js';

/**
 * Datos maestros guardados en PostgreSQL si hay DATABASE_URL; si no, en memoria (se
 * pierden al reiniciar). Global: catálogo, rutas y rastreo los leen.
 */
@Global()
@Module({
  controllers: [MasterDataController],
  providers: [
    {
      provide: MasterData,
      useFactory: async () => {
        const url = process.env.DATABASE_URL?.trim();
        const logger = new Logger('MasterData');
        const data = new MasterData({
          store: url ? new PostgresStateStore(url) : new MemoryStateStore(),
          vehicleTypes: DEFAULT_FLEET,
          maxPayloadKg,
        });
        await data.ready;
        logger.log(
          url
            ? 'Datos guardados en PostgreSQL.'
            : 'Sin DATABASE_URL: los datos se guardan en memoria y se pierden al reiniciar.',
        );
        return data;
      },
    },
  ],
  exports: [MasterData],
})
export class MasterDataModule {}
