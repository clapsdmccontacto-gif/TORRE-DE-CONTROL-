/**
 * Dónde se guardan los datos maestros: un solo documento JSON. En el servidor, PostgreSQL
 * (o memoria si no hay DATABASE_URL); en el modo local del navegador, localStorage.
 */
export interface StateStore {
  load(): Promise<unknown>;
  save(snapshot: unknown): Promise<void>;
}

/** Sin persistencia: se pierde al reiniciar (desarrollo y tests). */
export class MemoryStateStore implements StateStore {
  private value: unknown = null;

  async load(): Promise<unknown> {
    return this.value === null ? null : structuredClone(this.value);
  }

  async save(snapshot: unknown): Promise<void> {
    this.value = structuredClone(snapshot);
  }
}
