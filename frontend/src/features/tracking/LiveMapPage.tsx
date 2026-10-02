import type L from 'leaflet';
import {
  Bell,
  CircleCheck,
  LoaderCircle,
  MapPin,
  MapPinned,
  Phone,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { remainingPath } from '@core/modules/routing/domain/road-route';
import { useTomTomKey } from '@/components/map/basemaps';
import {
  LOS_ANGELES_CENTER,
  depotMarker,
  destinationMarker,
  routeLine,
  signalMarker,
  stopMarker,
  toLeaflet,
  tollLine,
  tollMarker,
  trafficLine,
  truckMarker,
  useLeafletMap,
} from '@/components/map/leaflet';
import { BasemapControl, TomTomKeySection } from '@/components/map/BasemapControl';
import { StatTile, StatusBanner } from '@/components/status';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { RoadRouteDetails } from '@/features/routing/RoadRouteDetails';
import { api, apiMode, errorMessage } from '@/lib/api';
import { CLOUD_DEPLOY_URL } from '@/lib/cloud';
import { STOP_STATE_LABEL, formatClock, formatKg, formatKm } from '@/lib/format';
import {
  ROUTING_VEHICLES,
  remainingStreetRoute,
  roadsideFeatures,
  streetRoute,
  vehicleCodeFor,
  type StreetRouteQuery,
  type StreetRouteResult,
} from '@/lib/road-routing';
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

interface StreetState {
  query: StreetRouteQuery | null;
  result: StreetRouteResult | null;
  pending: boolean;
  error: string | null;
}

const NO_STREET: StreetState = { query: null, result: null, pending: false, error: null };

export function LiveMapPage() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [depot, setDepot] = useState<{ name: string; location: LatLng } | null>(null);
  const [registeredVehicles, setRegisteredVehicles] = useState<number | null>(null);
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
      .masterData()
      .then((data) => {
        if (!active) return;
        setDepot(data.depot);
        setRegisteredVehicles(data.vehicles.length);
      })
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

  // --- Ruta por calles hacia un destino marcado en el mapa -------------------------
  const hasKey = useTomTomKey() !== '';
  const [picking, setPicking] = useState(false);
  const [street, setStreet] = useState<StreetState>(NO_STREET);
  const [vehicleChoice, setVehicleChoice] = useState<string | null>(null);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const streetRequest = useRef(0);
  const vehicleCode = vehicleChoice ?? vehicleCodeFor(selected?.vehicleName);
  const origin = selected?.position
    ? { location: selected.position as LatLng, label: `${selected.vehiclePlate} (posición actual)` }
    : depot
      ? { location: depot.location, label: depot.name }
      : { location: LOS_ANGELES_CENTER, label: 'el centro de Los Ángeles' };

  async function computeStreet(query: StreetRouteQuery) {
    const id = ++streetRequest.current;
    const current = () => id === streetRequest.current;
    setStreet({ query, result: null, pending: true, error: null });
    try {
      const route = await streetRoute(query);
      if (!current()) return;
      setStreet({
        query,
        result: { route, roadside: null, roadsideError: null },
        pending: false,
        error: null,
      });
      // Semáforos y peajes llegan después: la ruta ya se ve mientras tanto.
      await loadRoadside(id, route.path);
    } catch (e) {
      if (current()) setStreet({ query, result: null, pending: false, error: errorMessage(e) });
    }
  }

  async function loadRoadside(id: number, path: LatLng[]) {
    const roadside = await roadsideFeatures(path).then(
      (features) => ({ roadside: features, roadsideError: null }),
      (e: unknown) => ({ roadside: null, roadsideError: errorMessage(e) }),
    );
    if (id === streetRequest.current) {
      setStreet((s) => (s.result ? { ...s, result: { ...s.result, ...roadside } } : s));
    }
  }

  function retryRoadside() {
    const result = street.result;
    if (!result) return;
    setStreet({ ...street, result: { ...result, roadside: null, roadsideError: null } });
    void loadRoadside(streetRequest.current, result.route.path);
  }

  function pickDestination(destination: LatLng) {
    setPicking(false);
    void computeStreet({
      origin: origin.location,
      originLabel: origin.label,
      destination,
      vehicleCode,
      loadKg: selected?.cargoWeightKg ?? 0,
      avoidTolls,
    });
  }

  function changeOptions(next: { vehicleCode?: string; avoidTolls?: boolean }) {
    if (next.vehicleCode !== undefined) setVehicleChoice(next.vehicleCode);
    if (next.avoidTolls !== undefined) setAvoidTolls(next.avoidTolls);
    if (street.query) void computeStreet({ ...street.query, ...next });
  }

  function clearStreet() {
    streetRequest.current++;
    setPicking(false);
    setStreet(NO_STREET);
  }

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
        <StatusBanner status="warning" title="Esta versión no está conectada a un servidor">
          Sólo ve el «Modo conductor» abierto en este mismo equipo, y sus datos quedan guardados
          sólo aquí. Para ver en este mapa los teléfonos de los conductores y compartir los datos
          entre equipos,{' '}
          <a
            className="font-medium text-foreground underline"
            href={CLOUD_DEPLOY_URL}
            target="_blank"
            rel="noreferrer"
          >
            active el guardado en la nube
          </a>{' '}
          (paso a paso en{' '}
          <a className="font-medium text-foreground underline" href="#flota">
            «Flota y bodega»
          </a>
          ).
        </StatusBanner>
      )}
      {devices.length === 0 && registeredVehicles !== null && (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle>Para ver un camión en el mapa</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                {registeredVehicles === 0 ? (
                  <>
                    Agregue sus camiones en{' '}
                    <a className="font-medium text-foreground underline" href="#flota">
                      Flota y bodega
                    </a>
                    .
                  </>
                ) : (
                  `Tiene ${registeredVehicles} ${registeredVehicles === 1 ? 'camión registrado' : 'camiones registrados'} en «Flota y bodega».`
                )}
              </li>
              <li>
                En el teléfono del conductor abra «Modo conductor», escriba su nombre, elija el
                camión y toque «Activar GPS e iniciar ruta».
              </li>
              <li>El camión aparece aquí con su posición y se mueve en vivo.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="gap-0 self-start overflow-hidden py-0 xl:sticky xl:top-4">
          <LiveFleetMap
            devices={devices}
            selected={selected}
            trackFixes={trackFixes}
            depot={depot}
            onSelect={setSelectedId}
            picking={picking}
            onPick={pickDestination}
            onCancelPick={() => setPicking(false)}
            street={street}
            toolbar={
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm">
                <Button
                  id="pick-destination"
                  variant={picking ? 'default' : 'outline'}
                  aria-pressed={picking}
                  disabled={!hasKey}
                  onClick={() => setPicking(!picking)}
                >
                  <MapPinned />
                  {picking ? 'Toque el destino en el mapa' : 'Marcar destino en el mapa'}
                </Button>
                {(street.query || picking) && (
                  <Button variant="ghost" onClick={clearStreet}>
                    <X /> {picking && !street.query ? 'Cancelar' : 'Quitar ruta'}
                  </Button>
                )}
                <span className="min-w-0 text-xs text-muted-foreground">
                  {hasKey
                    ? `Ruta por calles con tráfico desde ${origin.label}.`
                    : 'Para trazar rutas por calles pegue la clave gratuita de TomTom en «Ruta por calles».'}
                </span>
              </div>
            }
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
              <CardTitle>Ruta por calles</CardTitle>
              <CardDescription>
                Marque un destino en el mapa: se traza por las calles exactas con el tráfico de este
                momento, los peajes y los semáforos del camino. Con un vehículo elegido sale desde
                su posición; si no, desde la bodega.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 px-4 text-sm">
              {hasKey && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="grid gap-1.5">
                      <span className="font-medium">Vehículo</span>
                      <NativeSelect
                        id="road-vehicle"
                        value={vehicleCode}
                        onChange={(e) => changeOptions({ vehicleCode: e.target.value })}
                      >
                        {ROUTING_VEHICLES.map((v) => (
                          <option key={v.code} value={v.code}>
                            {v.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="flex h-9 items-center gap-2">
                      <input
                        id="road-avoid-tolls"
                        type="checkbox"
                        className="size-4 accent-current"
                        checked={avoidTolls}
                        onChange={(e) => changeOptions({ avoidTolls: e.target.checked })}
                      />
                      Evitar peajes
                    </label>
                  </div>
                  {street.query ? (
                    <p className="text-muted-foreground">
                      Desde {street.query.originLabel}
                      {street.query.loadKg > 0 && ` · ${formatKg(street.query.loadKg)} a bordo`}.
                      Los camiones se rutean con sus restricciones de peso.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Toque «Marcar destino en el mapa» y luego el punto al que quiere ir.
                    </p>
                  )}
                  {street.pending && (
                    <p role="status" className="flex items-center gap-2 text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden /> Calculando la
                      ruta con el tráfico actual…
                    </p>
                  )}
                  {street.error && (
                    <StatusBanner status="critical" title="No se pudo trazar la ruta">
                      {street.error}
                    </StatusBanner>
                  )}
                  {street.result && street.query && (
                    <RoadRouteDetails
                      route={street.result.route}
                      roadside={street.result.roadside}
                      roadsideError={street.result.roadsideError}
                      onRetryRoadside={retryRoadside}
                      destination={street.query.destination}
                    />
                  )}
                </>
              )}
              <TomTomKeySection />
            </CardContent>
          </Card>

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
        {device.driverPhone && (
          <LinkButton
            href={`tel:${device.driverPhone.replace(/[\s-]/g, '')}`}
            variant="outline"
            size="sm"
            className="justify-self-start"
          >
            <Phone /> Llamar a {device.driverName} ({device.driverPhone})
          </LinkButton>
        )}
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
  picking,
  onPick,
  onCancelPick,
  street,
  toolbar,
}: {
  devices: LiveDevice[];
  selected: LiveDevice | null;
  trackFixes: PositionFix[];
  depot: { name: string; location: LatLng } | null;
  onSelect: (sessionId: string) => void;
  picking: boolean;
  onPick: (destination: LatLng) => void;
  onCancelPick: () => void;
  street: StreetState;
  toolbar: ReactNode;
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

  // Lo que falta, por calles (TomTom): se consulta al elegir el vehículo y cada vez que
  // termina una obra; entre lecturas GPS sólo se recorta desde la posición actual.
  const hasKey = useTomTomKey() !== '';
  const pendingStops = selected?.stops.filter((s) => s.state !== 'COMPLETADA') ?? [];
  const remainingKey =
    hasKey && selected?.position && depot && pendingStops.length > 0
      ? `${selected.sessionId}|${pendingStops.map((s) => s.deliveryId).join(',')}`
      : '';
  const [streetRemaining, setStreetRemaining] = useState<{
    key: string;
    path: LatLng[];
  } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    const device = selectedRef.current;
    if (!remainingKey || !device?.position || !depot) return;
    let active = true;
    remainingStreetRoute({
      origin: device.position,
      stops: device.stops.filter((s) => s.state !== 'COMPLETADA').map((s) => s.location),
      depot: depot.location,
      vehicleCode: vehicleCodeFor(device.vehicleName),
      loadKg: device.cargoWeightKg,
    }).then(
      (route) => {
        if (active) setStreetRemaining({ key: remainingKey, path: route.path });
      },
      () => undefined, // Sin conexión o sin cupo: queda la línea estimada.
    );
    return () => {
      active = false;
    };
  }, [remainingKey, depot]);
  const streetRemainingPath =
    streetRemaining && streetRemaining.key === remainingKey ? streetRemaining.path : null;

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
      !selected?.position || remaining.length === 0
        ? []
        : streetRemainingPath
          ? remainingPath(streetRemainingPath, selected.position)
          : [
              selected.position,
              ...remaining.map((s) => s.location),
              ...(depot ? [depot.location] : []),
            ];
    upsert(plannedLineRef, planned, 'route-planned');
  }, [layerRef, selected, trackFixes, depot, streetRemainingPath]);

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

  // Modo "marcar destino": el próximo toque en el mapa fija el destino (Esc cancela).
  const onPickRef = useRef(onPick);
  const onCancelPickRef = useRef(onCancelPick);
  useEffect(() => {
    onPickRef.current = onPick;
    onCancelPickRef.current = onCancelPick;
  }, [onPick, onCancelPick]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !picking) return;
    const container = map.getContainer();
    container.classList.add('is-picking');
    const pick = (e: L.LeafletMouseEvent) =>
      onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onCancelPickRef.current();
    map.on('click', pick);
    document.addEventListener('keydown', escape);
    return () => {
      container.classList.remove('is-picking');
      map.off('click', pick);
      document.removeEventListener('keydown', escape);
    };
  }, [mapRef, picking]);

  // Ruta por calles: borde en tramos con peaje, ruta con contorno (para distinguirla del
  // trayecto recorrido), congestión encima,
  // semáforos, plazas de peaje y destino.
  const streetQuery = street.query;
  const streetResult = street.result;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !streetQuery) return;
    const items: L.Layer[] = [];
    const add = (item: L.Layer) => items.push(item.addTo(layer));
    if (streetResult) {
      const { route, roadside } = streetResult;
      route.tollPaths.forEach((path) => add(tollLine(path)));
      add(routeLine(route.path, 'road-casing'));
      add(routeLine(route.path, 'route-1 road-line'));
      route.traffic.forEach((span) =>
        add(
          trafficLine(
            span.path,
            span.severity,
            `${span.category}${span.delayMin > 0 ? ` · +${span.delayMin} min` : ''}`,
          ),
        ),
      );
      roadside?.trafficSignals.forEach((p) => add(signalMarker(p)));
      roadside?.tollBooths.forEach((b) => add(tollMarker(b.location, b.name)));
    }
    add(destinationMarker(streetQuery.destination, 'Destino'));
    return () => items.forEach((item) => item.remove());
  }, [layerRef, streetQuery, streetResult]);

  // Al llegar una ruta nueva, el mapa la encuadra completa.
  const streetPath = streetResult?.route.path;
  useEffect(() => {
    if (streetPath && streetPath.length > 1) {
      mapRef.current?.fitBounds(streetPath.map(toLeaflet), { padding: [40, 40], maxZoom: 16 });
    }
  }, [mapRef, streetPath]);

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
    <>
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[60vh] min-h-[360px] w-full xl:h-[calc(100vh-15rem)]"
          role="region"
          aria-label="Mapa de la flota en vivo"
        />
        {picking && (
          <p className="absolute top-3 right-3 left-14 z-[1000] rounded-md border bg-card/95 px-3 py-2 text-sm font-medium sm:right-auto">
            Toque el punto de destino en el mapa (Esc para cancelar).
          </p>
        )}
        {!baseMapAvailable && (
          <p className="absolute right-3 bottom-8 left-3 z-[1000] rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground sm:left-auto sm:max-w-xs">
            El mapa de calles no cargó (sin internet, contenido externo bloqueado o proveedor no
            disponible). Pruebe otro mapa base abajo; lo demás se muestra igual.
          </p>
        )}
      </div>
      {toolbar}
      <BasemapControl />
    </>
  );
}
