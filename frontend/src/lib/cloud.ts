/**
 * Guardado en la nube: el servidor con base de datos (render.yaml) se enciende con un clic
 * en Render y la app lo encuentra sola por su dirección fija (o por la que se pegue a mano
 * si Render le dio otra); la empresa crea su clave de acceso la primera vez y la comparte
 * con enlaces que la llevan incluida.
 */
export const CLOUD_DEPLOY_URL =
  'https://render.com/deploy?repo=https://github.com/clapsdmccontacto-gif/TORRE-DE-CONTROL-';

const env = import.meta.env as Record<string, string | undefined>;

/** Dirección del servidor en Render (nombre del servicio en render.yaml). */
export const CLOUD_URL = (
  env.VITE_CLOUD_URL ?? 'https://torre-control-constructor-center.onrender.com'
).replace(/\/$/, '');

const KEY_STORAGE = 'torre-control.cloud-key';
const URL_STORAGE = 'torre-control.cloud-url';

export interface CloudStatus {
  claimed: boolean;
  /** Se puede crear la clave (o una nueva, mientras la nube no tenga datos). */
  canClaim: boolean;
}

function read(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function write(storageKey: string, value: string): void {
  try {
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch {
    // Sin almacenamiento: habrá que ingresarla de nuevo al recargar.
  }
}

export const readCloudKey = () => read(KEY_STORAGE);
export const saveCloudKey = (key: string) => write(KEY_STORAGE, key);
/** Dirección de la nube guardada en este equipo (pegada a mano o recibida en un enlace). */
export const readCloudUrl = () => read(URL_STORAGE);
export const saveCloudUrl = (url: string) => write(URL_STORAGE, url);

/**
 * Lo que se pegue («xxx.onrender.com», «https://xxx.onrender.com/#mapa»…) → su origen
 * `https://xxx.onrender.com`; `null` si no parece una dirección.
 */
export function normalizeCloudUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.includes('.') || url.hostname === 'localhost' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Enlaces compartidos traen `?clave=…` y, si la nube no está en la dirección de siempre,
 * `&nube=…` (p. ej. `#conductor?clave=…`): se guardan y se quitan de la barra.
 */
export function takeLinkParams(): void {
  const [route, query] = window.location.hash.slice(1).split('?');
  const params = new URLSearchParams(query ?? '');
  const key = params.get('clave');
  const cloud = normalizeCloudUrl(params.get('nube') ?? '');
  if (!key && !cloud) return;
  if (key) saveCloudKey(key);
  if (cloud) saveCloudUrl(cloud);
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`);
}

/** Nube a la que está conectada la app (origen del servidor), para incluirla en los enlaces. */
let connectedCloud: string | null = null;

export function setConnectedCloud(origin: string): void {
  connectedCloud = origin;
}

/** Enlace a esta misma app con la clave (y la nube, si no es la de siempre) incluidas. */
export function shareLink(route: string): string {
  const base = window.location.href.split('#')[0];
  const params = new URLSearchParams();
  const key = readCloudKey();
  if (key) params.set('clave', key);
  if (connectedCloud && connectedCloud !== CLOUD_URL && connectedCloud !== window.location.origin) {
    params.set('nube', connectedCloud);
  }
  const query = params.toString();
  return `${base}#${route}${query ? `?${query}` : ''}`;
}

/**
 * ¿Hay servidor? Responde `null` si no existe o no contesta a tiempo (el plan gratuito de
 * Render tarda hasta un minuto en despertar).
 */
export async function probeCloud(apiBase: string, timeoutMs: number): Promise<CloudStatus | null> {
  try {
    const response = await fetch(`${apiBase}/cloud/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      service?: string;
      claimed?: boolean;
      canClaim?: boolean;
    };
    if (body.service !== 'torre-control') return null;
    const claimed = Boolean(body.claimed);
    return { claimed, canClaim: body.canClaim ?? !claimed };
  } catch {
    return null;
  }
}

/** Prueba varias direcciones a la vez y se queda con la primera que contesta. */
export function findCloud(
  apiBases: string[],
  timeoutMs: number,
): Promise<{ apiBase: string; status: CloudStatus } | null> {
  return new Promise((resolve) => {
    let pending = apiBases.length;
    if (!pending) resolve(null);
    for (const apiBase of apiBases) {
      void probeCloud(apiBase, timeoutMs).then((status) => {
        if (status) resolve({ apiBase, status });
        else if (--pending === 0) resolve(null);
      });
    }
  });
}

/** `https://x.onrender.com/api/v1` → `https://x.onrender.com` (relativas: este mismo sitio). */
export function cloudOrigin(apiBase: string): string {
  return new URL(apiBase, window.location.href).origin;
}
