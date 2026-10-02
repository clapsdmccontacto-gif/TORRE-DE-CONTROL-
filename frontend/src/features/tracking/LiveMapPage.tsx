import type L from 'leaflet';
import { Bell, CircleCheck, MapPin, Truck, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  depotMarker,
  routeLine,
  stopMarker,
  toLeaflet,
  truckMarker,
  useLeafletMap,
} from '@/components/map/leaflet';
import { StatTile, StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, apiMode } from '@/lib/api';
import { STOP_STATE_LABEL, formatClock, formatKg, formatKm } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FleetSnapshot, LatLng, LiveDevice, PositionFix, TrackingEvent } from '@/types/api';
import { DeviceStatusLabel } from './device-status';

const EVENT_ICON: Record<TrackingEvent['type'], LucideIcon> = {
  AVISO_PROXIMIDAD: Bell,
  LLEGADA_OBRA: MapPin,
  SALIDA_OBRA: CircleCheck,
  INICIO_RUTA: Truck,
  FIN_RUTA: Truck,
};

const TRACK_REFRESH_MS = 10_000;

export function LiveMapPage() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [depot, setDepot] = useState<{ name: string; location: LatLng } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [track, setTrack] = useState<{ sessionId: string; fixes: PositionFix[] } | null>(null);

  useEffect(
    () =>
      api.subscribeFleet(
        (next) => {
          setSnapshot(next);
          setConnectionLost(false);
        },
        () => setConnectionLost(true),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    api
      .activePlan()
      .then((plan) => active && setDepot(plan?.depot ?? null))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const load = () =>
      api
        .deviceTrack(selectedId)
        .then((r) => active && setTrack({ sessionId: selectedId, fixes: r.fixes }))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, TRACK_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedId]);

  const devices = useMemo(() => snapshot?.devices ?? [], [snapshot]);
  const selected = devices.find((d) => d.sessionId === selectedId) ?? null;
  const trackFixes = useMemo(() => {
    const fixes = track && track.sessionId === selectedId ? track.fixes : [];
    const last = selected?.position;
    return last && fixes.at(-1)?.recordedAt !== last.recordedAt ? [...fixes, last] : fixes;
  }, [track, selectedId, selected]);

  const counts = {
    moving: devices.filter((d) => d.status === 'EN_MOVIMIENTO').length,
    stopped: devices.filter((d) => d.status === 'DETENIDO').length,
    lost: devices.filter((d) => d.status === 'SIN_SENAL').length,
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Vehículos en ruta" value={String(devices.length)} />
        <StatTile label="En movimiento" value={String(counts.moving)} />
        <StatTile label="Detenidos" value={String(counts.stopped)} hint="Descargando o en espera" />
        <StatTile label="Sin señal" value={String(counts.lost)} hint="Más de 2 min sin reportar" />
      </div>

      {connectionLost && (
        <StatusBanner status="critical" title="Se perdió la conexión en vivo">
          Reintentando automáticamente. Los datos del mapa pueden estar desactualizados.
        </StatusBanner>
      )}
      {apiMode === 'local' && (
        <StatusBanner status="warning" title="Demostración en este dispositivo">
          Los camiones simulados recorren el plan publicado. Para ver los teléfonos de los
          conductores en vivo, la app debe correr con el servidor (ver README, sección 6).
        </StatusBanner>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="gap-0 self-start overflow-hidden py-0 xl:sticky xl:top-4">
          <LiveFleetMap
            devices={devices}
            selected={selected}
            trackFixes={trackFixes}
            depot={depot}
            onSelect={setSelectedId}
          />
        </Card>

        <div className="grid grid-cols-1 content-start gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle>Flota</CardTitle>
              <CardDescription>
                Toque un vehículo para ver su trayecto y lo que lleva.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 px-4">
              {devices.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay vehículos en ruta. Aparecen cuando un conductor inicia su ruta en «Modo
                  conductor».
                </p>
              )}
              {devices.map((device) => (
                <DeviceRow
                  key={device.sessionId}
                  device={device}
                  selected={device.sessionId === selectedId}
                  onSelect={() =>
                    setSelectedId(device.sessionId === selectedId ? null : device.sessionId)
                  }
                />
              ))}
            </CardContent>
          </Card>

          {selected && <DeviceDetail device={selected} trackFixes={trackFixes} />}

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle>Eventos</CardTitle>
              <CardDescription>Avisos al capataz, llegadas y salidas de obra.</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="grid grid-cols-1 gap-2 text-sm">
                {(snapshot?.events ?? []).slice(0, 12).map((event) => {
                  const Icon = EVENT_ICON[event.type];
                  return (
                    <li key={event.id} className="flex gap-2">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="tabular-nums text-muted-foreground">
                          {formatClock(event.at)}
                        </span>{' '}
                        {event.message}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: LiveDevice;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'grid w-full gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/60',
        selected && 'border-[var(--series-1)] bg-accent',
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {device.vehiclePlate}{' '}
          <span className="font-normal text-muted-foreground">· {device.vehicleName}</span>
        </span>
        {device.simulated && <Badge variant="secondary">Simulado</Badge>}
      </span>
      <span className="text-muted-foreground">{device.driverName}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DeviceStatusLabel status={device.status} />
        {device.speedKmh !== null && device.status === 'EN_MOVIMIENTO' && (
          <span className="tabular-nums text-muted-foreground">{device.speedKmh} km/h</span>
        )}
      </span>
      <span className="text-muted-foreground">
        {device.nextStop
          ? `Próxima: ${device.nextStop.siteName}${
              device.nextStop.etaMin !== null
                ? device.nextStop.etaMin === 0
                  ? ' (en obra)'
                  : ` · ${device.nextStop.etaMin} min`
                : ''
            }`
          : device.stops.length > 0
            ? 'Entregas terminadas · regreso a bodega'
            : 'Sin ruta asignada'}
        {device.cargoWeightKg > 0 && ` · lleva ${formatKg(device.cargoWeightKg)}`}
      </span>
    </button>
  );
}

function DeviceDetail({ device, trackFixes }: { device: LiveDevice; trackFixes: PositionFix[] }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>
          {device.vehiclePlate} · {device.driverName}
        </CardTitle>
        <CardDescription>
          Recorrido: {formatKm(device.distanceKm)} · {trackFixes.length} lecturas GPS · desde{' '}
          {formatClock(device.startedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 px-4 text-sm">
        <div className="grid gap-1">
          <p className="font-medium">A bordo ({formatKg(device.cargoWeightKg)})</p>
          {device.cargo.length === 0 ? (
            <p className="text-muted-foreground">Sin carga pendiente.</p>
          ) : (
            <ul className="grid gap-0.5">
              {device.cargo.map((line) => (
                <li key={line.sku} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{line.name}</span>
                  <span className="tabular-nums text-muted-foreground">{line.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {device.stops.length > 0 && (
          <div className="grid gap-1">
            <p className="font-medium">Paradas</p>
            <ol className="grid gap-0.5">
              {device.stops.map((stop, i) => (
                <li key={stop.deliveryId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {i + 1}. {stop.siteName}
                  </span>
                  <span className="text-muted-foreground">{STOP_STATE_LABEL[stop.state]}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveFleetMap({
  devices,
  selected,
  trackFixes,
  depot,
  onSelect,
}: {
  devices: LiveDevice[];
  selected: LiveDevice | null;
  trackFixes: PositionFix[];
  depot: { name: string; location: LatLng } | null;
  onSelect: (sessionId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, layerRef, baseMapAvailable } = useLeafletMap(containerRef, 10);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Los marcadores se mueven en su lugar (no se recrean) para que el clic y el
  // tooltip funcionen aunque lleguen posiciones cada pocos segundos.
  const trucksRef = useRef(new Map<string, { marker: L.Marker; key: string }>());
  const fittedRef = useRef(false);
  const selectedId = selected?.sessionId ?? null;

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    const trucks = trucksRef.current;
    const present = new Set<string>();
    for (const device of devices) {
      if (!device.position) continue;
      present.add(device.sessionId);
      const variant =
        device.sessionId === selectedId
          ? 'selected'
          : device.status === 'SIN_SENAL'
            ? 'lost'
            : 'normal';
      const key = `${variant}|${device.vehiclePlate}|${device.driverName}`;
      const existing = trucks.get(device.sessionId);
      if (existing && existing.key === key && layer.hasLayer(existing.marker)) {
        existing.marker.setLatLng(toLeaflet(device.position));
        continue;
      }
      existing?.marker.remove();
      const marker = truckMarker(
        device.position,
        device.vehiclePlate,
        `${device.vehiclePlate} · ${device.driverName}`,
        variant,
      )
        .on('click', () => onSelectRef.current(device.sessionId))
        .addTo(layer);
      trucks.set(device.sessionId, { marker, key });
    }
    for (const [id, entry] of trucks) {
      if (!present.has(id)) {
        entry.marker.remove();
        trucks.delete(id);
      }
    }

    const positions = devices.flatMap((d) => (d.position ? [toLeaflet(d.position)] : []));
    if (!fittedRef.current && positions.length > 0) {
      if (depot) positions.push(toLeaflet(depot.location));
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 13 });
      fittedRef.current = true;
    }
  }, [mapRef, layerRef, devices, selectedId, depot]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !depot) return;
    const marker = depotMarker(depot.location, depot.name).addTo(layer);
    return () => {
      marker.remove();
    };
  }, [layerRef, depot]);

  // Trayecto recorrido (línea) y lo que falta (punteado) del vehículo elegido.
  const trackLineRef = useRef<L.Polyline | null>(null);
  const plannedLineRef = useRef<L.Polyline | null>(null);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const upsert = (ref: { current: L.Polyline | null }, path: LatLng[], className: string) => {
      if (path.length < 2) {
        ref.current?.remove();
        ref.current = null;
      } else if (ref.current && layer.hasLayer(ref.current)) {
        ref.current.setLatLngs(path.map(toLeaflet));
      } else {
        ref.current = routeLine(path, className).addTo(layer);
      }
    };
    upsert(trackLineRef, selected ? trackFixes : [], 'route-1');
    const remaining = selected?.stops.filter((s) => s.state !== 'COMPLETADA') ?? [];
    const planned =
      selected?.position && remaining.length > 0
        ? [
            selected.position,
            ...remaining.map((s) => s.location),
            ...(depot ? [depot.location] : []),
          ]
        : [];
    upsert(plannedLineRef, planned, 'route-planned');
  }, [layerRef, selected, trackFixes, depot]);

  // Paradas del vehículo elegido: se redibujan sólo si cambia su estado.
  const stopsKey = selected
    ? `${selected.sessionId}|${selected.stops.map((s) => s.state).join(',')}`
    : '';
  const stopsRef = useRef(selected?.stops ?? []);
  useEffect(() => {
    stopsRef.current = selected?.stops ?? [];
  }, [selected]);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !stopsKey) return;
    const markers = stopsRef.current.map((stop, i) =>
      stopMarker(
        stop.location,
        String(i + 1),
        `${stop.siteName} · ${STOP_STATE_LABEL[stop.state]}`,
        cn('route-1', stop.state === 'COMPLETADA' && 'is-done'),
      ).addTo(layer),
    );
    return () => markers.forEach((m) => m.remove());
  }, [layerRef, stopsKey]);

  // Al elegir un vehículo el mapa lo centra (sólo al cambiar la selección, no en cada lectura).
  const devicesRef = useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);
  useEffect(() => {
    const position = devicesRef.current.find((d) => d.sessionId === selectedId)?.position;
    if (selectedId && position) mapRef.current?.panTo(toLeaflet(position));
  }, [mapRef, selectedId]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[60vh] min-h-[360px] w-full xl:h-[calc(100vh-15rem)]"
        role="region"
        aria-label="Mapa de la flota en vivo"
      />
      {!baseMapAvailable && (
        <p className="absolute right-3 bottom-8 left-3 z-[1000] rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground sm:left-auto sm:max-w-xs">
          Mapa de calles no disponible en esta vista (sin internet o contenido externo bloqueado).
          Posiciones, trayectos y obras se muestran igual.
        </p>
      )}
    </div>
  );
}
