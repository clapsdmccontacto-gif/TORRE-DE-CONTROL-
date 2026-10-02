/**
 * Guardado en la nube: el servidor con base de datos (render.yaml) se enciende con un clic
 * en Render y la app lo encuentra sola por su dirección fija; la empresa crea su clave de
 * acceso la primera vez y la comparte con enlaces que la llevan incluida.
 */
export const CLOUD_DEPLOY_URL =
  'https://render.com/deploy?repo=https://github.com/clapsdmccontacto-gif/TORRE-DE-CONTROL-';

const env = import.meta.env as Record<string, string | undefined>;

/** Dirección del servidor en Render (nombre del servicio en render.yaml). */
export const CLOUD_URL = (
  env.VITE_CLOUD_URL ?? 'https://torre-control-constructor-center.onrender.com'
).replace(/\/$/, '');

const KEY_STORAGE = 'torre-control.cloud-key';

export function readCloudKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveCloudKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Sin almacenamiento: habrá que ingresarla de nuevo al recargar.
  }
}

/** Enlaces compartidos con `?clave=…` (p. ej. `#conductor?clave=…`): la guarda y la quita de la barra. */
export function takeKeyFromUrl(): void {
  const [route, query] = window.location.hash.slice(1).split('?');
  const key = new URLSearchParams(query ?? '').get('clave');
  if (!key) return;
  saveCloudKey(key);
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`);
}

/** Enlace a esta misma app con la clave incluida (para conductores u otros equipos). */
export function shareLink(route: string): string {
  const base = window.location.href.split('#')[0];
  const key = readCloudKey();
  return `${base}#${route}${key ? `?clave=${encodeURIComponent(key)}` : ''}`;
}

/**
 * ¿Hay servidor? Responde `null` si no existe o no contesta a tiempo (el plan gratuito de
 * Render tarda hasta un minuto en despertar).
 */
export async function probeCloud(
  apiBase: string,
  timeoutMs: number,
): Promise<{ claimed: boolean } | null> {
  try {
    const response = await fetch(`${apiBase}/cloud/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { service?: string; claimed?: boolean };
    return body.service === 'torre-control' ? { claimed: Boolean(body.claimed) } : null;
  } catch {
    return null;
  }
}
