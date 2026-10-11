/**
 * Registros JSON agrupados por colección (planes de ruta, rutas de conductores…). En el
 * servidor van a PostgreSQL (tabla `ops_records`, migración 005) o a memoria; en el modo
 * local del navegador, a localStorage. Sin framework: lo usan backend y frontend.
 */
export interface StoredRecord {
  id: string;
  value: unknown;
}

export interface RecordStore {
  list(collection: string): Promise<StoredRecord[]>;
  put(collection: string, id: string, value: unknown): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}

/** Sin persistencia: se pierde al reiniciar (desarrollo y tests). */
export class MemoryRecordStore implements RecordStore {
  private readonly collections = new Map<string, Map<string, unknown>>();

  async list(collection: string): Promise<StoredRecord[]> {
    return [...(this.collections.get(collection) ?? new Map<string, unknown>())].map(
      ([id, value]) => ({ id, value: structuredClone(value) }),
    );
  }

  async put(collection: string, id: string, value: unknown): Promise<void> {
    const records = this.collections.get(collection) ?? new Map<string, unknown>();
    records.set(id, structuredClone(value));
    this.collections.set(collection, records);
  }

  async remove(collection: string, id: string): Promise<void> {
    this.collections.get(collection)?.delete(id);
  }
}

/**
 * Cola de escrituras de un caso de uso: se guardan en orden y `flush()` espera a que
 * terminen (y falla si la última falló). Un error se informa pero no frena las siguientes.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly onError: (error: unknown) => void;

  constructor(onError: (error: unknown) => void = (error) => console.error(error)) {
    this.onError = onError;
  }

  enqueue(write: () => Promise<void>): void {
    const next = this.tail.catch(() => undefined).then(write);
    next.catch((error: unknown) => this.onError(error));
    this.tail = next;
  }

  flush(): Promise<void> {
    return this.tail;
  }
}
