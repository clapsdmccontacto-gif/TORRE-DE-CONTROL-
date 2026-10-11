import { remainingPath } from '@core/modules/routing/domain/road-route';
import type L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { useTomTomKey } from '@/components/map/basemaps';
import {
  depotMarker,
  routeLine,
  stopMarker,
  toLeaflet,
  truckMarker,
  useLeafletMap,
} from '@/components/map/leaflet';
import { STOP_STATE_LABEL } from '@/lib/format';
import { remainingStreetRoute, vehicleCodeFor } from '@/lib/road-routing';
import { cn } from '@/lib/utils';
import type { LatLng, LiveDevice } from '@/types/api';

/**
 * Mapa del conductor: su posición, sus paradas numeradas y lo que le falta por calles
 * (TomTom, una consulta al empezar y cada vez que entrega; entre lecturas GPS sólo se
 * recorta). Sin conexión a TomTom queda la línea recta entre paradas.
 */
export function DriverMap({
  device,
  depot,
}: {
  device: LiveDevice;
  depot: { name: string; location: LatLng } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, layerRef, baseMapAvailable } = useLeafletMap(containerRef, 13);
  const hasKey = useTomTomKey() !== '';
  const pending = device.stops.filter((s) => s.state !== 'COMPLETADA');
  const routeKey =
    hasKey && device.position && pending.length > 0
      ? pending.map((s) => s.deliveryId).join(',')
      : '';
  const [street, setStreet] = useState<{ key: string; path: LatLng[] } | null>(null);
  const deviceRef = useRef(device);
  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  useEffect(() => {
    const current = deviceRef.current;
    if (!routeKey || !current.position) return;
    let active = true;
    const stops = current.stops.filter((s) => s.state !== 'COMPLETADA').map((s) => s.location);
    remainingStreetRoute({
      origin: current.position,
      stops: depot ? stops : stops.slice(0, -1),
      depot: depot?.location ?? stops.at(-1)!,
      vehicleCode: vehicleCodeFor(current.vehicleName),
      loadKg: current.cargoWeightKg,
    }).then(
      (route) => active && setStreet({ key: routeKey, path: route.path }),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [routeKey, depot]);

  // Paradas: se redibujan cuando cambia su estado.
  const stopsKey = device.stops.map((s) => `${s.deliveryId}:${s.state}`).join('|');
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const markers = deviceRef.current.stops.map((stop, i) =>
      stopMarker(
        stop.location,
        String(i + 1),
        `${i + 1}. ${stop.siteName} · ${STOP_STATE_LABEL[stop.state]}`,
        cn('route-1', stop.state === 'COMPLETADA' && 'is-done'),
      ).addTo(layer),
    );
    const depotPin = depot ? depotMarker(depot.location, depot.name).addTo(layer) : null;
    return () => {
      markers.forEach((m) => m.remove());
      depotPin?.remove();
    };
  }, [layerRef, stopsKey, depot]);

  // Camión y lo que falta (punteado).
  const truckRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const centeredRef = useRef(false);
  const position = device.position;
  const streetPath = street && street.key === routeKey ? street.path : null;
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    truckRef.current?.remove();
    lineRef.current?.remove();
    truckRef.current = null;
    lineRef.current = null;
    const remaining = deviceRef.current.stops.filter((s) => s.state !== 'COMPLETADA');
    if (position) {
      truckRef.current = truckMarker(
        position,
        device.vehiclePlate,
        'Usted está aquí',
        'selected',
      ).addTo(layer);
      const path = streetPath
        ? remainingPath(streetPath, position)
        : remaining.length > 0
          ? [position, ...remaining.map((s) => s.location)]
          : [];
      if (path.length > 1) lineRef.current = routeLine(path, 'route-planned').addTo(layer);
    }
    if (!centeredRef.current) {
      const points = [
        ...(position ? [position] : []),
        ...deviceRef.current.stops.map((s) => s.location),
      ];
      if (points.length > 0) {
        // Sin animación: si el conductor abre «Entregar» enseguida, el mapa se desmonta.
        map.fitBounds(points.map(toLeaflet), { padding: [32, 32], maxZoom: 15, animate: false });
        centeredRef.current = true;
      }
    }
  }, [layerRef, mapRef, position, streetPath, device.vehiclePlate, stopsKey]);

  return (
    <div className="grid gap-1">
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-lg border"
        role="region"
        aria-label="Mapa de su ruta"
      />
      <p className="text-xs text-muted-foreground">
        {streetPath
          ? 'Punteado: lo que falta, por calles.'
          : 'Punteado: orden de las paradas (línea recta).'}
        {!baseMapAvailable && ' Sin mapa de calles: se muestran sólo las paradas.'}
      </p>
    </div>
  );
}
