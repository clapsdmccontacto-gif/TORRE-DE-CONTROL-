import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MemoryRecordStore, type RecordStore } from '../../common/record-store.js';
import { PostgresRecordStore } from './infrastructure/postgres-record-store.js';

/** Token de inyección del almacén de registros de la operación. */
export const RECORD_STORE = Symbol('RecordStore');

/**
 * Registros de la operación (planes publicados, rutas de conductores…) en PostgreSQL si hay
 * DATABASE_URL; si no, en memoria (se pierden al reiniciar).
 */
@Global()
@Module({
  providers: [
    {
      provide: RECORD_STORE,
      useFactory: (): RecordStore => {
        const url = process.env.DATABASE_URL?.trim();
        if (!url) {
          new Logger('Storage').log('Sin DATABASE_URL: planes y rutas se guardan en memoria.');
          return new MemoryRecordStore();
        }
        return new PostgresRecordStore(url);
      },
    },
  ],
  exports: [RECORD_STORE],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(RECORD_STORE) private readonly store: RecordStore) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.store instanceof PostgresRecordStore) await this.store.close();
  }
}
