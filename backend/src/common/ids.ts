/**
 * Identificador aleatorio. `crypto.randomUUID` no existe fuera de contextos seguros
 * (p. ej. el HTML abierto como archivo), así que hay un respaldo.
 */
export function newId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}
