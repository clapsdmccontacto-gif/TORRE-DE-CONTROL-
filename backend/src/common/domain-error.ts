/**
 * Error de regla de negocio. La capa HTTP lo traduce a 422 con su `code`,
 * de modo que el frontend pueda reaccionar sin parsear mensajes.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
