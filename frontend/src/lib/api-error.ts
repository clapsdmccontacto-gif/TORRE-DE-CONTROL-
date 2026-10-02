import type { ApiErrorBody } from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.body.issues?.map((i) => `${i.path}: ${i.message}`).join('; ');
    return details ? `${error.message} (${details})` : error.message;
  }
  return error instanceof Error ? error.message : 'Error inesperado.';
}
