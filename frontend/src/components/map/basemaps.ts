import { COMPANY_TOMTOM_KEY as BUILT_IN_KEY } from '@core/modules/routing/infrastructure/tomtom';
import { useSyncExternalStore } from 'react';

/**
 * Proveedores de mapa base. Los servicios gratuitos sin clave cambian sus reglas
 * (OpenStreetMap bloquea pedidos sin Referer; CARTO pasó a exigir clave), así que el
 * proveedor se elige en la propia app y queda guardado en el dispositivo:
 * - TomTom: predeterminado. Con la clave de la empresa (incluida) suma tráfico en vivo y
 *   rutas por calles para camiones. La clave también se usa para rutas aunque se elija
 *   otro mapa base, y cada equipo puede usar una propia.
 * - Esri: sin clave; funciona también con el HTML abierto como archivo.
 * - MapTiler: con la clave gratuita de la empresa (maptiler.com), para uso estable.
 * - Sin mapa de calles: siempre funciona; camiones, rutas y obras se ven igual.
 * - Personalizado: el definido al compilar con VITE_MAP_TILE_URL(_DARK) y VITE_MAP_ATTRIBUTION.
 */
export type BasemapId = 'tomtom' | 'esri' | 'maptiler' | 'custom' | 'none';

export interface BasemapPreference {
  id: BasemapId;
  maptilerKey: string;
  tomtomKey: string;
  /** Capa de tráfico en vivo de TomTom sobre cualquier mapa base (requiere su clave). */
  traffic: boolean;
}

export interface TileSpec {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  /** Capa encima del mapa base (tráfico): sus errores no ocultan el mapa y se refresca. */
  overlay: boolean;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> y sus proveedores de datos';
const TOMTOM = 'https://api.tomtom.com';
const TOMTOM_ATTRIBUTION = `&copy; 1992-${new Date().getFullYear()} <a href="https://www.tomtom.com">TomTom</a>`;
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const env = import.meta.env as Record<string, string | undefined>;
const CUSTOM = env.VITE_MAP_TILE_URL
  ? {
      light: env.VITE_MAP_TILE_URL,
      dark: env.VITE_MAP_TILE_URL_DARK ?? env.VITE_MAP_TILE_URL,
      attribution: env.VITE_MAP_ATTRIBUTION ?? '',
    }
  : null;

/**
 * Clave de TomTom de la empresa (definida en `routing/infrastructure/tomtom.ts`, la
 * comparte el servidor). VITE_TOMTOM_KEY la reemplaza al compilar; vacía = sin clave.
 */
const COMPANY_TOMTOM_KEY = (env.VITE_TOMTOM_KEY ?? BUILT_IN_KEY).trim();
export const HAS_COMPANY_TOMTOM_KEY = COMPANY_TOMTOM_KEY !== '';

/** Clave efectiva: la propia de este equipo o, si no hay, la de la empresa. */
export function tomtomKeyOf(preference: BasemapPreference): string {
  return preference.tomtomKey.trim() || COMPANY_TOMTOM_KEY;
}

export const BASEMAP_OPTIONS: { id: BasemapId; label: string }[] = [
  ...(CUSTOM ? [{ id: 'custom' as const, label: 'Personalizado' }] : []),
  { id: 'tomtom', label: 'TomTom con tráfico (recomendado)' },
  { id: 'esri', label: 'Esri (sin clave)' },
  { id: 'maptiler', label: 'MapTiler (con clave)' },
  { id: 'none', label: 'Sin mapa de calles' },
];

/** Capas a dibujar (base, nombres y tráfico encima) para el tema actual. */
export function basemapLayers(preference: BasemapPreference, dark: boolean): TileSpec[] {
  const key = encodeURIComponent(tomtomKeyOf(preference));
  const traffic: TileSpec[] =
    preference.traffic && key
      ? [
          {
            url: `${TOMTOM}/traffic/map/4/tile/flow/${dark ? 'relative0-dark' : 'relative0'}/{z}/{x}/{y}.png?key=${key}&tileSize=256`,
            attribution: '',
            maxNativeZoom: 18,
            overlay: true,
          },
        ]
      : [];
  return [...baseLayers(preference, dark), ...traffic];
}

function baseLayers(preference: BasemapPreference, dark: boolean): TileSpec[] {
  const base = (url: string, attribution: string, maxNativeZoom: number): TileSpec => ({
    url,
    attribution,
    maxNativeZoom,
    overlay: false,
  });
  switch (preference.id) {
    case 'none':
      return [];
    case 'custom':
      return CUSTOM ? [base(dark ? CUSTOM.dark : CUSTOM.light, CUSTOM.attribution, 19)] : [];
    case 'tomtom': {
      const key = encodeURIComponent(tomtomKeyOf(preference));
      if (!key) return [];
      const style = dark ? 'night' : 'main';
      return [
        base(
          `${TOMTOM}/map/1/tile/basic/${style}/{z}/{x}/{y}.png?key=${key}&tileSize=256&language=es-ES`,
          TOMTOM_ATTRIBUTION,
          20,
        ),
      ];
    }
    case 'maptiler': {
      const key = encodeURIComponent(preference.maptilerKey.trim());
      if (!key) return [];
      const style = dark ? 'streets-v2-dark' : 'streets-v2';
      return [
        base(
          `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${key}`,
          MAPTILER_ATTRIBUTION,
          19,
        ),
      ];
    }
    case 'esri':
      return dark
        ? [
            base(
              `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
              ESRI_ATTRIBUTION,
              16,
            ),
            base(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, '', 16),
          ]
        : [base(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, ESRI_ATTRIBUTION, 19)];
  }
}

// --- Preferencia guardada en el dispositivo (compartida por todos los mapas abiertos) ---
const STORAGE_KEY = 'torre-control.basemap';
const DEFAULT_PREFERENCE: BasemapPreference = {
  id: CUSTOM ? 'custom' : HAS_COMPANY_TOMTOM_KEY ? 'tomtom' : 'esri',
  maptilerKey: '',
  tomtomKey: '',
  traffic: true,
};

function read(): BasemapPreference {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<BasemapPreference> | null;
    if (saved) {
      return {
        id: BASEMAP_OPTIONS.some((o) => o.id === saved.id) ? saved.id! : DEFAULT_PREFERENCE.id,
        maptilerKey: saved.maptilerKey ?? '',
        tomtomKey: saved.tomtomKey ?? '',
        traffic: saved.traffic ?? true,
      };
    }
  } catch {
    // Sin almacenamiento: se usa el proveedor por defecto.
  }
  return DEFAULT_PREFERENCE;
}

let current = read();
const listeners = new Set<() => void>();

export function getBasemap(): BasemapPreference {
  return current;
}

export function setBasemap(next: BasemapPreference): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Se aplica igual en esta sesión aunque no se pueda recordar.
  }
  for (const listener of listeners) listener();
}

export function subscribeBasemap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBasemap(): BasemapPreference {
  return useSyncExternalStore(subscribeBasemap, getBasemap);
}

export type KeyCheck = 'ok' | 'invalid' | 'offline';

/** Prueba la clave de TomTom pidiendo un mosaico del mapa (cuenta 1 de los 50.000 diarios). */
export function checkTomTomKey(key: string): Promise<KeyCheck> {
  return new Promise((resolve) => {
    if (!navigator.onLine) {
      resolve('offline');
      return;
    }
    const image = new Image();
    image.referrerPolicy = 'strict-origin-when-cross-origin';
    image.onload = () => resolve('ok');
    image.onerror = () => resolve(navigator.onLine ? 'invalid' : 'offline');
    image.src = `${TOMTOM}/map/1/tile/basic/main/0/0/0.png?key=${encodeURIComponent(key.trim())}&tileSize=256`;
  });
}

/** Clave de TomTom efectiva en este dispositivo (vacía si no hay ninguna). */
export function tomtomKey(): string {
  return tomtomKeyOf(current);
}

export function useTomTomKey(): string {
  return tomtomKeyOf(useBasemap());
}
