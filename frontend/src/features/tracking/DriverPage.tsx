import { navigationLinks } from '@core/modules/routing/domain/road-route';
import { ExternalLink, LoaderCircle, LocateFixed, Navigation, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, apiMode, errorMessage } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { STOP_STATE_LABEL, formatKg } from '@/lib/format';
import type { DriverSession, FleetUnitView, LiveDevice, PositionFix } from '@/types/api';

const STORAGE_KEY = 'torre-control.driver-session';
const FLUSH_EVERY_MS = 5_000;

type GpsState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'ok'; accuracyM: number; at: number }
  | { kind: 'error'; message: string };

const REJECTION_TEXT: Record<string, string> = {
  PRECISION_BAJA: 'precisión insuficiente (más de 100 m)',
  FUERA_DE_ORDEN: 'lectura fuera de orden',
  SALTO_IMPOSIBLE: 'salto imposible (ruido del GPS)',
  COORDENADA_INVALIDA: 'coordenada inválida',
};

function readSaved(): DriverSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DriverSession) : null;
  } catch {
    return null;
  }
}

function save(session: DriverSession | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento disponible: la ruta sigue, sólo no se recuerda al recargar.
  }
}

function gpsUnavailableReason(): string | null {
  if (!('geolocation' in navigator)) return 'Este navegador no tiene GPS disponible.';
  if (!window.isSecureContext) {
    return 'El GPS sólo funciona si la app se abre con https:// (o en localhost).';
  }
  return null;
}

function toFix(position: GeolocationPosition): PositionFix {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;
  return {
    lat: latitude,
    lng: longitude,
    accuracyM: Number.isFinite(accuracy) ? accuracy : null,
    speedKmh: speed !== null && Number.isFinite(speed) ? speed * 3.6 : null,
    headingDeg: heading !== null && Number.isFinite(heading) ? heading : null,
    recordedAt: new Date(position.timestamp).toISOString(),
  };
}

export function DriverPage() {
  const [units, setUnits] = useState<FleetUnitView[]>([]);
  const [driverName, setDriverName] = useState('');
  const [plate, setPlate] = useState('');
  const [session, setSession] = useState<DriverSession | null>(readSaved);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsState>({ kind: 'idle' });
  const [sent, setSent] = useState({ accepted: 0, lastRejection: null as string | null });
  const [pending, setPending] = useState(0);
  const [device, setDevice] = useState<LiveDevice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const queueRef = useRef<PositionFix[]>([]);

  useEffect(() => {
    let active = true;
    api
      .fleetUnits()
      .then((list) => {
        if (!active) return;
        setUnits(list);
        setPlate(
          (current) => current || list.find((u) => u.stops > 0)?.plate || list[0]?.plate || '',
        );
      })
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, []);

  const stopRoute = useCallback((message: string | null) => {
    save(null);
    queueRef.current = [];
    setSession(null);
    setDevice(null);
    setGps({ kind: 'idle' });
    setPending(0);
    if (message) setError(message);
  }, []);

  const flush = useCallback(async () => {
    if (!session || queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0);
    setPending(0);
    try {
      const result = await api.sendPositions(session.id, batch);
      setSent((s) => ({
        accepted: s.accepted + result.accepted,
        lastRejection: result.rejected.at(-1)?.reason ?? s.lastRejection,
      }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        stopRoute(
          'La ruta ya no está activa (se cerró o la tomó otro teléfono). Iníciela de nuevo.',
        );
        return;
      }
      // Sin señal: se reintenta en el próximo envío sin perder lecturas.
      queueRef.current = [...batch, ...queueRef.current];
      setPending(queueRef.current.length);
    }
  }, [session, stopRoute]);

  // GPS + envío periódico mientras la ruta está activa.
  useEffect(() => {
    if (!session || gpsUnavailableReason()) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        queueRef.current.push(toFix(position));
        setPending(queueRef.current.length);
        setGps({ kind: 'ok', accuracyM: position.coords.accuracy, at: position.timestamp });
      },
      (failure) =>
        setGps({
          kind: 'error',
          message:
            failure.code === failure.PERMISSION_DENIED
              ? 'Permiso de ubicación denegado. Actívelo en la configuración del navegador.'
              : 'No se pudo leer el GPS. Revise que la ubicación del teléfono esté activa.',
        }),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    const timer = setInterval(() => void flush(), FLUSH_EVERY_MS);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
    };
  }, [session, flush]);

  // Pantalla encendida mientras se conduce (si el navegador lo permite).
  useEffect(() => {
    if (!session || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined);
    void acquire();
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [session]);

  // Estado de la ruta (próxima obra, ETA, carga) desde la flota en vivo.
  useEffect(() => {
    if (!session) return;
    return api.subscribeFleet((snapshot) =>
      setDevice(snapshot.devices.find((d) => d.sessionId === session.id) ?? null),
    );
  }, [session]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  async function start() {
    setError(null);
    const unavailable = gpsUnavailableReason();
    if (unavailable) {
      setError(unavailable);
      return;
    }
    setStarting(true);
    try {
      const started = await api.startDriverSession({ driverName, vehiclePlate: plate });
      save(started);
      setSent({ accepted: 0, lastRejection: null });
      setGps({ kind: 'waiting' });
      setSession(started);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  async function finish() {
    if (!session) return;
    await flush();
    try {
      await api.endDriverSession(session.id);
    } catch {
      // Si el servidor ya la había cerrado, igual se limpia en el teléfono.
    }
    stopRoute(null);
  }

  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-1 gap-4">
      {error && (
        <StatusBanner status="critical" title="Atención">
          {error}
        </StatusBanner>
      )}

      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Iniciar ruta</CardTitle>
            <CardDescription>
              Se activa el GPS del teléfono y la torre de control ve el camión en el mapa.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <label className="grid grid-cols-1 gap-1.5 text-sm">
              <span className="font-medium">Nombre del conductor</span>
              <Input
                id="driver-name"
                autoComplete="name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Ej.: Juan Pérez"
                className="h-11 text-base"
              />
            </label>
            <label className="grid grid-cols-1 gap-1.5 text-sm">
              <span className="font-medium">Vehículo</span>
              <NativeSelect
                id="driver-vehicle"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="h-11 text-base"
              >
                {units.map((u) => (
                  <option key={u.plate} value={u.plate}>
                    {u.plate} · {u.vehicleName} ·{' '}
                    {u.stops === 0
                      ? 'sin ruta asignada'
                      : `${u.stops} ${u.stops === 1 ? 'parada asignada' : 'paradas asignadas'}`}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button
              className="h-12 text-base"
              onClick={start}
              disabled={starting || driverName.trim().length < 2 || !plate}
            >
              {starting ? <LoaderCircle className="animate-spin" /> : <LocateFixed />}
              Activar GPS e iniciar ruta
            </Button>
            {apiMode === 'local' && (
              <p className="text-xs text-muted-foreground">
                Modo demostración: la ubicación se ve en el mapa de este mismo dispositivo. Para que
                la torre de control la vea desde otro equipo, use la app publicada con el servidor.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {session.vehiclePlate} · {session.driverName}
              </CardTitle>
              <CardDescription>{session.vehicleName}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm">
              <GpsStatus gps={gps} now={now} blockedReason={gpsUnavailableReason()} />
              <p className="text-muted-foreground tabular-nums">
                Enviadas: {sent.accepted} · Pendientes por enviar: {pending}
                {sent.lastRejection &&
                  ` · Última descartada: ${REJECTION_TEXT[sent.lastRejection] ?? sent.lastRejection}`}
              </p>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Mantenga esta pantalla abierta: si bloquea el teléfono o cambia de app, el navegador
                deja de enviar la ubicación. No manipule el teléfono mientras conduce.
              </p>
            </CardContent>
          </Card>

          {device?.nextStop && (
            <Card>
              <CardHeader>
                <CardDescription>Próxima obra</CardDescription>
                <CardTitle className="text-xl">{device.nextStop.siteName}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-sm">
                <p className="text-muted-foreground">
                  {device.nextStop.etaMin === 0
                    ? 'En la obra. Al salir se marca la descarga como terminada.'
                    : device.nextStop.etaMin !== null
                      ? `Llegada estimada en ${device.nextStop.etaMin} min. Se avisa al capataz 15 min antes.`
                      : 'Esperando la primera lectura del GPS para estimar la llegada.'}
                </p>
                <NavigateButtons device={device} />
              </CardContent>
            </Card>
          )}

          {device && device.stops.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Ruta y carga</CardTitle>
                <CardDescription>A bordo: {formatKg(device.cargoWeightKg)}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-sm">
                {device.stops.map((stop, i) => (
                  <div key={stop.deliveryId} className="grid gap-1 rounded-lg border p-3">
                    <p className="flex justify-between gap-2 font-medium">
                      <span className="min-w-0">
                        {i + 1}. {stop.siteName}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {STOP_STATE_LABEL[stop.state]}
                      </span>
                    </p>
                    <ul className="text-muted-foreground">
                      {stop.cargo.map((line) => (
                        <li key={line.sku}>
                          {line.quantity} × {line.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Button variant="outline" className="h-12 text-base" onClick={finish}>
            <Square /> Terminar ruta
          </Button>
        </>
      )}
    </div>
  );
}

function GpsStatus({
  gps,
  now,
  blockedReason,
}: {
  gps: GpsState;
  now: number;
  blockedReason: string | null;
}) {
  if (blockedReason) return <StatusLabel status="critical">{blockedReason}</StatusLabel>;
  if (gps.kind === 'ok') {
    const seconds = Math.max(0, Math.round((now - gps.at) / 1000));
    return (
      <StatusLabel status={seconds > 60 ? 'warning' : 'good'}>
        GPS activo · ±{Math.round(gps.accuracyM)} m · última lectura hace {seconds} s
      </StatusLabel>
    );
  }
  if (gps.kind === 'error') return <StatusLabel status="critical">{gps.message}</StatusLabel>;
  return <StatusLabel status="warning">Buscando señal GPS…</StatusLabel>;
}

/**
 * Navegación por voz a la próxima obra con la app del teléfono. Al volver a esta pestaña
 * el GPS sigue enviando; mientras Waze o Maps estén al frente, el navegador puede pausarlo.
 */
function NavigateButtons({ device }: { device: LiveDevice }) {
  const next = device.stops.find((s) => s.state !== 'COMPLETADA');
  if (!next) return null;
  const links = navigationLinks(next.location);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <LinkButton href={links.waze} target="_blank" rel="noreferrer">
          <Navigation /> Navegar con Waze
        </LinkButton>
        <LinkButton href={links.googleMaps} target="_blank" rel="noreferrer" variant="outline">
          <ExternalLink /> Google Maps
        </LinkButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Mientras navega con otra app el teléfono puede pausar el envío de ubicación: vuelva a esta
        pantalla al llegar a la obra.
      </p>
    </div>
  );
}
