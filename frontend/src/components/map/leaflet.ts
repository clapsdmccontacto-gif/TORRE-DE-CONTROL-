import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LatLng } from '@/types/api';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const LOS_ANGELES_CENTER: LatLng = { lat: -37.47, lng: -72.35 };

export const toLeaflet = (p: LatLng): L.LatLngTuple => [p.lat, p.lng];

/**
 * Crea el mapa una vez y lo entrega en una ref. Los efectos del componente que
 * llama se ejecutan después de este, así que ya encuentran el mapa creado.
 * Si el mapa base (OpenStreetMap) no carga —sin internet o en una vista que bloquea
 * imágenes externas— `baseMapAvailable` pasa a false y rutas y camiones siguen visibles.
 */
export function useLeafletMap(containerRef: RefObject<HTMLDivElement | null>, zoom = 10) {
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [baseMapAvailable, setBaseMapAvailable] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = L.map(container, { attributionControl: true }).setView(
      toLeaflet(LOS_ANGELES_CENTER),
      zoom,
    );
    map.attributionControl.setPrefix(false);
    let failedTiles = 0;
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION, className: 'map-tiles' })
      .on('tileerror', () => {
        failedTiles++;
        if (failedTiles === 3) setBaseMapAvailable(false);
      })
      .addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [containerRef, zoom]);

  return { mapRef, layerRef, baseMapAvailable };
}

/** Elemento con texto seguro (nunca HTML armado con datos ingresados por usuarios). */
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function truckMarker(
  position: LatLng,
  label: string,
  tooltip: string,
  variant: 'normal' | 'selected' | 'lost',
): L.Marker {
  const html = el('div', `truck-marker is-${variant}`);
  html.append(el('span', 'truck-dot'), el('span', 'truck-label', label));
  return L.marker(toLeaflet(position), {
    icon: L.divIcon({ className: 'map-icon', html, iconSize: [0, 0] }),
    keyboard: true,
    title: tooltip,
    zIndexOffset: variant === 'selected' ? 1000 : 0,
  }).bindTooltip(el('span', '', tooltip), { direction: 'top', offset: [0, -10] });
}

export function stopMarker(
  position: LatLng,
  label: string,
  tooltip: string,
  routeClass: string,
): L.Marker {
  const html = el('div', `stop-marker ${routeClass}`, label);
  return L.marker(toLeaflet(position), {
    icon: L.divIcon({ className: 'map-icon', html, iconSize: [0, 0] }),
    title: tooltip,
  }).bindTooltip(el('span', '', tooltip), { direction: 'top', offset: [0, -12] });
}

export function depotMarker(position: LatLng, name: string): L.Marker {
  const html = el('div', 'depot-marker');
  html.append(el('span', 'depot-square'), el('span', 'truck-label', name));
  return L.marker(toLeaflet(position), {
    icon: L.divIcon({ className: 'map-icon', html, iconSize: [0, 0] }),
    title: name,
    zIndexOffset: -100,
  });
}

export function routeLine(path: readonly LatLng[], className: string): L.Polyline {
  return L.polyline(path.map(toLeaflet), {
    className: `route-line ${className}`,
    interactive: false,
  });
}

/** Clase de color por ruta: tres colores validados; desde la cuarta, trazo segmentado. */
export function routeClass(index: number): string {
  return index < 3 ? `route-${index + 1}` : 'route-other';
}

export function routeLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
