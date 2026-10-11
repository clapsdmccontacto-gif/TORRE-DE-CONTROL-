import { ApiError } from '@/lib/api-error';
import { readCloudKey } from '@/lib/cloud';
import { localApi } from '@/lib/local-api';
import type { ApiErrorBody, FleetSnapshot, RoutePlan, TorreApi } from '@/types/api';

export { errorMessage } from '@/lib/api-error';

function httpApi(baseUrl: string): TorreApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      const key = readCloudKey();
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(key ? { 'x-torre-key': key } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new ApiError(0, {
        code: 'SIN_CONEXION',
        message: 'No hay conexión con la nube. Revise internet; se reintenta solo.',
      });
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        response.status,
        (body as ApiErrorBody | null) ?? {
          code: 'ERROR_HTTP',
          message: `El servidor respondió ${response.status}. Intente de nuevo en un momento.`,
        },
      );
    }
    return body as T;
  }

  const post = <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
  const put = <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(payload) });
  const remove = <T>(path: string) => request<T>(path, { method: 'DELETE' });
  const id = encodeURIComponent;

  return {
    masterData: () => request('/master-data'),
    saveDepot: (depot) => put('/master-data/depot', depot),
    saveVehicle: (vehicle) => post('/master-data/vehicles', vehicle),
    removeVehicle: (plate) => remove(`/master-data/vehicles/${id(plate)}`),
    saveProduct: (product) => post('/master-data/products', product),
    removeProduct: (sku) => remove(`/master-data/products/${id(sku)}`),
    saveSite: (site) => post('/master-data/sites', site),
    removeSite: (siteId) => remove(`/master-data/sites/${id(siteId)}`),
    saveOrder: (order) => post('/master-data/orders', order),
    removeOrder: (orderId) => remove(`/master-data/orders/${id(orderId)}`),

    products: () => request('/catalog/products'),
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
    completeStop: (sessionId, deliveryId) =>
      post(
        `/tracking/sessions/${encodeURIComponent(sessionId)}/stops/${encodeURIComponent(deliveryId)}/complete`,
        {},
      ),
    deviceTrack: (sessionId) =>
      request(`/tracking/sessions/${encodeURIComponent(sessionId)}/track`),
    liveFleet: () => request('/tracking/live'),
    subscribeFleet: (onSnapshot, onError) => {
      // EventSource no admite cabeceras: la clave va en la dirección. Reintenta solo si se
      // corta la conexión, pero se rinde si el servidor no contesta (reinicio o despliegue
      // en Render): entonces se vuelve a abrir cada 5 s.
      const key = readCloudKey();
      const url = `${baseUrl}/tracking/stream${key ? `?key=${encodeURIComponent(key)}` : ''}`;
      let source: EventSource | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const open = () => {
        const current = new EventSource(url);
        source = current;
        current.onmessage = (event) => onSnapshot(JSON.parse(event.data) as FleetSnapshot);
        current.onerror = () => {
          onError?.();
          if (current.readyState === EventSource.CLOSED && !stopped) {
            retry = setTimeout(open, 5_000);
          }
        };
      };
      open();
      return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        source?.close();
      };
    },
  };
}

/**
 * La app parte en modo local (todo en el navegador) y `CloudGate` la conecta a la nube al
 * abrir: con VITE_API_URL (la interfaz que sirve el propio servidor, `.env.api`) o con el
 * servidor de Render que encuentra en `CLOUD_URL` (la versión de GitHub Pages).
 */
export const API_URL = import.meta.env.VITE_API_URL as string | undefined;

let implementation: TorreApi = localApi;
export let apiMode: 'local' | 'http' = 'local';

export function connectApi(baseUrl: string): void {
  implementation = httpApi(baseUrl);
  apiMode = 'http';
}

/** Siempre llama a la implementación vigente (local o nube). */
export const api: TorreApi = new Proxy({} as TorreApi, {
  get: (_target, operation) => implementation[operation as keyof TorreApi],
});
