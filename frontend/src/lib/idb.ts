/**
 * IndexedDB mínimo (clave → valor) para lo que no cabe en localStorage: comprobantes con
 * fotos pendientes de enviar y, en el modo local, los comprobantes guardados.
 */
const DB_NAME = 'torre-control';
const STORES = ['outbox', 'proofs', 'proof-images'] as const;
export type IdbStore = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no permite guardar datos (IndexedDB).'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('No se pudo abrir el almacenamiento del navegador.'));
    };
  });
  return opening;
}

async function run<T>(
  store: IdbStore,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Error del almacenamiento local.'));
  });
}

export const idbGet = <T>(store: IdbStore, key: string) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (store: IdbStore, key: string, value: unknown) =>
  run(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
export const idbDelete = (store: IdbStore, key: string) =>
  run(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
export const idbAll = <T>(store: IdbStore) =>
  run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
