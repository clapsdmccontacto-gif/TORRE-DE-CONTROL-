import { ApiError } from '@/lib/api-error';
import { localApi } from '@/lib/local-api';
import type { ApiErrorBody, FleetSnapshot, RoutePlan, TorreApi } from '@/types/api';

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

    deliveries: () => request('/routing/deliveries'),
    optimizeRoutes: (payload) => post('/routing/optimize', payload),
    applyRoadAdjustment: (planId, unitPlate, adjustment) =>
      post(
        `/routing/plans/${encodeURIComponent(planId)}/routes/${encodeURIComponent(unitPlate)}/road`,
        adjustment,
      ),
    publishPlan: (planId) => post(`/routing/plans/${encodeURIComponent(planId)}/publish`, {}),
    activePlan: async () =>
      (await request<{ plan: RoutePlan | null }>('/routing/plans/active')).plan,

    fleetUnits: () => request('/tracking/units'),
    startDriverSession: (input) => post('/tracking/sessions', input),
    sendPositions: (sessionId, fixes) =>
      post(`/tracking/sessions/${encodeURIComponent(sessionId)}/positions`, { fixes }),
    endDriverSession: (sessionId) =>
      post(`/tracking/sessions/${encodeURIComponent(sessionId)}/end`, {}),
    deviceTrack: (sessionId) =>
      request(`/tracking/sessions/${encodeURIComponent(sessionId)}/track`),
    liveFleet: () => request('/tracking/live'),
    subscribeFleet: (onSnapshot, onError) => {
      // EventSource reintenta solo si se corta la conexión.
      const source = new EventSource(`${baseUrl}/tracking/stream`);
      source.onmessage = (event) => onSnapshot(JSON.parse(event.data) as FleetSnapshot);
      source.onerror = () => onError?.();
      return () => source.close();
    },
  };
}

/**
 * Sin VITE_API_URL la app calcula todo en el navegador (modo local).
 * Con VITE_API_URL (p. ej. `npm run dev:api`, que usa .env.api) llama al backend NestJS.
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const apiMode: 'local' | 'http' = API_URL ? 'http' : 'local';
export const api: TorreApi = API_URL ? httpApi(API_URL) : localApi;
