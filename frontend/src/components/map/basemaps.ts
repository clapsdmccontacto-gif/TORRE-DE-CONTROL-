import { useSyncExternalStore } from 'react';

/**
 * Proveedores de mapa base. Los servicios gratuitos sin clave cambian sus reglas
 * (OpenStreetMap bloquea pedidos sin Referer; CARTO pasó a exigir clave), así que el
 * proveedor se elige en la propia app y queda guardado en el dispositivo:
 * - Esri: sin clave; funciona también con el HTML abierto como archivo.
 * - MapTiler: con la clave gratuita de la empresa (maptiler.com), para uso estable.
 * - Sin mapa de calles: siempre funciona; camiones, rutas y obras se ven igual.
 * - Personalizado: el definido al compilar con VITE_MAP_TILE_URL(_DARK) y VITE_MAP_ATTRIBUTION.
 */
export type BasemapId = 'esri' | 'maptiler' | 'custom' | 'none';

export interface BasemapPreference {
  id: BasemapId;
  maptilerKey: string;
}

export interface TileSpec {
  url: string;
  attribution: string;
  maxNativeZoom: number;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> y sus proveedores de datos';
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

export const BASEMAP_OPTIONS: { id: BasemapId; label: string }[] = [
  ...(CUSTOM ? [{ id: 'custom' as const, label: 'Personalizado' }] : []),
  { id: 'esri', label: 'Esri (sin clave)' },
  { id: 'maptiler', label: 'MapTiler (con clave)' },
  { id: 'none', label: 'Sin mapa de calles' },
];

/** Capas a dibujar (base y, si corresponde, nombres encima) para el tema actual. */
export function basemapLayers(preference: BasemapPreference, dark: boolean): TileSpec[] {
  switch (preference.id) {
    case 'none':
      return [];
    case 'custom':
      return CUSTOM
        ? [
            {
              url: dark ? CUSTOM.dark : CUSTOM.light,
              attribution: CUSTOM.attribution,
              maxNativeZoom: 19,
            },
          ]
        : [];
    case 'maptiler': {
      const key = encodeURIComponent(preference.maptilerKey.trim());
      if (!key) return [];
      const style = dark ? 'streets-v2-dark' : 'streets-v2';
      return [
        {
          url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${key}`,
          attribution: MAPTILER_ATTRIBUTION,
          maxNativeZoom: 19,
        },
      ];
    }
    case 'esri':
      return dark
        ? [
            {
              url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
              attribution: ESRI_ATTRIBUTION,
              maxNativeZoom: 16,
            },
            {
              url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
              attribution: '',
              maxNativeZoom: 16,
            },
          ]
        : [
            {
              url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
              attribution: ESRI_ATTRIBUTION,
              maxNativeZoom: 19,
            },
          ];
  }
}

// --- Preferencia guardada en el dispositivo (compartida por todos los mapas abiertos) ---
const STORAGE_KEY = 'torre-control.basemap';
const DEFAULT_PREFERENCE: BasemapPreference = { id: CUSTOM ? 'custom' : 'esri', maptilerKey: '' };

function read(): BasemapPreference {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as BasemapPreference | null;
    if (saved && BASEMAP_OPTIONS.some((o) => o.id === saved.id)) {
      return { id: saved.id, maptilerKey: saved.maptilerKey ?? '' };
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
