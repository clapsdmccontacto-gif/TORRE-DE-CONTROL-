import type {
  ApiErrorBody,
  CartSpec,
  CartType,
  CubicajeRequest,
  CubicajeResponse,
  MixCheckResponse,
  Product,
  SkuQuantity,
} from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
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

export const api = {
  products: () => request<Product[]>('/catalog/products'),
  cartTypes: () => request<CartSpec[]>('/picking/cart-types'),
  mixCheck: (payload: { cartType: CartType; currentLines: SkuQuantity[]; incoming: SkuQuantity }) =>
    post<MixCheckResponse>('/picking/mix-check', payload),
  cubicaje: (payload: CubicajeRequest) =>
    post<CubicajeResponse>('/load-planning/cubicaje', payload),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.body.issues?.map((i) => `${i.path}: ${i.message}`).join('; ');
    return details ? `${error.message} (${details})` : error.message;
  }
  return error instanceof Error ? error.message : 'Error inesperado.';
}
