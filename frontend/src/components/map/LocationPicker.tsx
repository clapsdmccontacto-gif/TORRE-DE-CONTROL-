import type L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LatLng } from '@/types/api';
import { parseLatLng } from './lat-lng';
import {
  LOS_ANGELES_CENTER,
  depotMarker,
  destinationMarker,
  toLeaflet,
  useLeafletMap,
} from './leaflet';

const format = (p: LatLng) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/**
 * Elegir una ubicación: tocando el mapa, con la posición actual del teléfono o pegando
 * coordenadas (o un enlace de Google Maps). `others` muestra lo ya registrado como guía.
 */
export function LocationPicker({
  id,
  value,
  onChange,
  others = [],
}: {
  id: string;
  value: LatLng | null;
  onChange: (location: LatLng) => void;
  others?: { location: LatLng; label: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, layerRef } = useLeafletMap(containerRef, 12);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.add('is-picking');
    const pick = (e: L.LeafletMouseEvent) =>
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on('click', pick);
    return () => {
      map.off('click', pick);
    };
  }, [mapRef]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const markers = [
      ...others.map((o) => depotMarker(o.location, o.label)),
      ...(value ? [destinationMarker(value, 'Aquí')] : []),
    ];
    markers.forEach((m) => m.addTo(layer));
    return () => markers.forEach((m) => m.remove());
  }, [layerRef, value, others]);

  // Centra en la ubicación elegida (o en lo registrado) sin perseguir cada clic.
  const centeredRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (value) {
      if (!map.getBounds().contains(toLeaflet(value))) map.setView(toLeaflet(value), 15);
      centeredRef.current = true;
    } else if (!centeredRef.current && others.length > 0) {
      map.fitBounds(
        others.map((o) => toLeaflet(o.location)),
        { padding: [30, 30], maxZoom: 14 },
      );
      centeredRef.current = true;
    } else if (!centeredRef.current) {
      map.setView(toLeaflet(LOS_ANGELES_CENTER), 12);
    }
  }, [mapRef, value, others]);

  function locateMe() {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setHint('El GPS sólo funciona con https:// o en este mismo equipo.');
      return;
    }
    setHint('Buscando su ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setHint(null);
        onChange({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => setHint('No se pudo leer la ubicación (permiso denegado o sin GPS).'),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-lg border"
        role="region"
        aria-label="Mapa para elegir la ubicación"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={locateMe}>
          <LocateFixed /> Usar mi ubicación actual
        </Button>
        <span className="text-xs text-muted-foreground">
          {value ? `Elegida: ${format(value)}` : 'Toque el mapa en el punto exacto.'}
        </span>
      </div>
      <Input
        id={id}
        placeholder="o pegue coordenadas / enlace de Google Maps"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseLatLng(e.target.value);
          if (parsed) onChange(parsed);
        }}
        autoComplete="off"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
