/**
 * Error de regla de negocio. La capa HTTP lo traduce a 422 con su `code`,
 * de modo que el frontend pueda reaccionar sin parsear mensajes.
 *
 * Sin "parameter properties": el frontend compila este mismo código con
 * `erasableSyntaxOnly` para ejecutar las reglas en el navegador.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
