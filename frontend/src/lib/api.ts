import { ApiError } from '@/lib/api-error';
import { localApi } from '@/lib/local-api';
import type { ApiErrorBody, TorreApi } from '@/types/api';

export { errorMessage } from '@/lib/api-error';

function httpApi(baseUrl: string): TorreApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch {
      throw new ApiError(0, { code: 'SIN_CONEXION', message: 'No hay conexión con la API.' });
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        response.status,
        (body as ApiErrorBody | null) ?? {
          code: 'ERROR_HTTP',
          message: `La API respondió ${response.status}. ¿Está corriendo el backend en el puerto 3000?`,
        },
      );
    }
    return body as T;
  }

  const post = <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(payload) });

  return {
    products: () => request('/catalog/products'),
    cartTypes: () => request('/picking/cart-types'),
    mixCheck: (payload) => post('/picking/mix-check', payload),
    cubicaje: (payload) => post('/load-planning/cubicaje', payload),
  };
}

/**
 * Sin VITE_API_URL la app calcula todo en el navegador (modo local).
 * Con VITE_API_URL (p. ej. `npm run dev:api`, que usa .env.api) llama al backend NestJS.
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const apiMode: 'local' | 'http' = API_URL ? 'http' : 'local';
export const api: TorreApi = API_URL ? httpApi(API_URL) : localApi;
