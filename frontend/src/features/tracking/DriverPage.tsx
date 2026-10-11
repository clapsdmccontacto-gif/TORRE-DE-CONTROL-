import { navigationLinks } from '@core/modules/routing/domain/road-route';
import { targetStop } from '@core/modules/tracking/domain/tracking';
import {
  CircleCheck,
  ExternalLink,
  LoaderCircle,
  LocateFixed,
  Navigation,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, apiMode, errorMessage } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { STOP_STATE_LABEL, formatKg } from '@/lib/format';
import type {
  DriverSession,
  FleetUnitView,
  LiveDevice,
  LiveStop,
  PositionFix,
} from '@/types/api';
import { useWakeLock, type WakeLockState } from './use-wake-lock';

const STORAGE_KEY = 'torre-control.driver-session';
/** Nombre, teléfono y camión del conductor: quedan en su teléfono para la próxima vez. */
const PROFILE_KEY = 'torre-control.driver-profile';

interface DriverProfile {
  driverName: string;
  driverPhone: string;
  plate: string;
}

function readProfile(): DriverProfile {
  try {
    const saved = JSON.parse(
      localStorage.getItem(PROFILE_KEY) ?? 'null',
    ) as Partial<DriverProfile> | null;
    return {
      driverName: saved?.driverName ?? '',
      driverPhone: saved?.driverPhone ?? '',
      plate: saved?.plate ?? '',
    };
  } catch {
    return { driverName: '', driverPhone: '', plate: '' };
  }
}

function saveProfile(profile: DriverProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Sin almacenamiento: se vuelve a escribir la próxima vez.
  }
}
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
  const [profile] = useState(readProfile);
  const [units, setUnits] = useState<FleetUnitView[] | null>(null);
  const [driverName, setDriverName] = useState(profile.driverName);
  const [driverPhone, setDriverPhone] = useState(profile.driverPhone);
  const [plate, setPlate] = useState(profile.plate);
  const [session, setSession] = useState<DriverSession | null>(readSaved);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsState>({ kind: 'idle' });
  const [sent, setSent] = useState({ accepted: 0, lastRejection: null as string | null });
  const [pending, setPending] = useState(0);
  const [device, setDevice] = useState<LiveDevice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [completing, setCompleting] = useState<string | null>(null);
  const queueRef = useRef<PositionFix[]>([]);
  const wakeLock = useWakeLock(session !== null);

  useEffect(() => {
    let active = true;
    api
      .fleetUnits()
      .then((list) => {
        if (!active) return;
        setUnits(list);
        setPlate((current) =>
          list.some((u) => u.plate === current)
            ? current
            : list.find((u) => u.stops > 0)?.plate || list[0]?.plate || '',
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
      if (e instanceof ApiError && e.body.code === 'SESION_DESCONOCIDA') {
        // El servidor se reinició: se retoma la ruta sola y las lecturas no se pierden.
        queueRef.current = [...batch, ...queueRef.current];
        setPending(queueRef.current.length);
        try {
          const resumed = await api.startDriverSession({
            driverName: session.driverName,
            driverPhone: session.driverPhone,
            vehiclePlate: session.vehiclePlate,
          });
          save(resumed);
          setSession(resumed);
        } catch (restartError) {
          if (restartError instanceof ApiError && restartError.status === 422) {
            stopRoute(errorMessage(restartError));
          }
        }
        return;
      }
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
      const started = await api.startDriverSession({
        driverName,
        driverPhone: driverPhone.trim() || null,
        vehiclePlate: plate,
      });
      saveProfile({ driverName, driverPhone, plate });
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

  /** El conductor registra la entrega de un pedido (la geocerca sólo sugiere la llegada). */
  async function completeStop(stop: LiveStop) {
    if (!session) return;
    setError(null);
    setCompleting(stop.deliveryId);
    try {
      await flush();
      const updated = await api.completeStop(session.id, stop.deliveryId);
      // Se muestra de inmediato; la flota en vivo trae después la carga y la ETA al día.
      setDevice((current) => (current ? { ...current, stops: updated.stops } : current));
    } catch (e) {
      setError(`No se pudo registrar la entrega en ${stop.siteName}: ${errorMessage(e)}`);
    } finally {
      setCompleting(null);
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

  const target = device ? targetStop(device.stops) : null;

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
              <span className="font-medium">Teléfono (opcional, para que la torre lo llame)</span>
              <Input
                id="driver-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                placeholder="Ej.: +56 9 1234 5678"
                className="h-11 text-base"
              />
            </label>
            {units !== null && units.length === 0 ? (
              <StatusBanner status="warning" title="No hay camiones registrados">
                Pida a la torre de control que agregue su camión en «Flota y bodega» y vuelva a
                abrir esta pantalla.
              </StatusBanner>
            ) : (
              <label className="grid grid-cols-1 gap-1.5 text-sm">
                <span className="font-medium">Camión</span>
                <NativeSelect
                  id="driver-vehicle"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  className="h-11 text-base"
                >
                  {(units ?? []).map((u) => (
                    <option key={u.plate} value={u.plate}>
                      {u.plate} · {u.vehicleName} ·{' '}
                      {u.stops === 0
                        ? 'sin ruta asignada'
                        : `${u.stops} ${u.stops === 1 ? 'parada asignada' : 'paradas asignadas'}`}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
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
                Este teléfono no está conectado a la nube: la ubicación sólo se ve aquí. Pida a la
                torre de control el enlace para conductores (está en «Flota y bodega»).
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
              <WakeLockStatus state={wakeLock} />
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

          {device && device.stops.length === 0 && (
            <StatusBanner status="warning" title="Su camión no tiene pedidos asignados">
              La ruta y el GPS ya están activos. Pida a la torre de control que publique el plan de
              rutas («Optimizar rutas» → «Publicar a la flota»): los pedidos aparecen aquí solos, sin
              reiniciar la ruta.
            </StatusBanner>
          )}

          {device && device.stops.length > 0 && !target && (
            <StatusBanner status="good" title="Entregó todos los pedidos">
              Al volver a la bodega toque «Terminar ruta».
            </StatusBanner>
          )}

          {device && target && (
            <Card>
              <CardHeader>
                <CardDescription>
                  {target.state === 'EN_OBRA' ? 'Está en la obra' : 'Próxima obra'}
                </CardDescription>
                <CardTitle className="text-xl">{target.siteName}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-sm">
                {target.state === 'EN_OBRA' ? (
                  <StatusLabel status="good">
                    Llegó a la obra. Cuando termine de descargar, registre la entrega.
                  </StatusLabel>
                ) : (
                  <p className="text-muted-foreground">
                    {device.nextStop?.siteName === target.siteName &&
                    device.nextStop.etaMin != null
                      ? `Llegada estimada en ${device.nextStop.etaMin} min. Se avisa al capataz antes de llegar.`
                      : 'Calculando la hora de llegada con el GPS…'}
                  </p>
                )}
                <DeliverButton
                  stop={target}
                  busy={completing === target.deliveryId}
                  primary={target.state === 'EN_OBRA'}
                  onConfirm={() => void completeStop(target)}
                />
                <NavigateButtons stop={target} />
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
                  <div key={stop.deliveryId} className="grid gap-2 rounded-lg border p-3">
                    <p className="flex justify-between gap-2 font-medium">
                      <span className="min-w-0">
                        {i + 1}. {stop.siteName}
                      </span>
                      {stop.state === 'COMPLETADA' ? (
                        <StatusLabel status="good">{STOP_STATE_LABEL[stop.state]}</StatusLabel>
                      ) : (
                        <span className="shrink-0 text-muted-foreground">
                          {STOP_STATE_LABEL[stop.state]}
                        </span>
                      )}
                    </p>
                    <ul className="text-muted-foreground">
                      {stop.cargo.map((line) => (
                        <li key={line.sku}>
                          {line.quantity} × {line.name}
                        </li>
                      ))}
                    </ul>
                    {stop.state !== 'COMPLETADA' && stop !== target && (
                      <DeliverButton
                        stop={stop}
                        busy={completing === stop.deliveryId}
                        primary={false}
                        onConfirm={() => void completeStop(stop)}
                      />
                    )}
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
function NavigateButtons({ stop }: { stop: LiveStop }) {
  const links = navigationLinks(stop.location);
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

function WakeLockStatus({ state }: { state: WakeLockState }) {
  if (state === 'on') {
    return <StatusLabel status="good">Pantalla encendida mientras dure la ruta</StatusLabel>;
  }
  if (state === 'idle') return null;
  return (
    <StatusLabel status="warning">
      {state === 'unsupported'
        ? 'Este navegador no puede mantener la pantalla encendida: deje el bloqueo automático del teléfono en «Nunca» durante la ruta.'
        : 'La pantalla puede apagarse sola: toque la pantalla de vez en cuando o deje el bloqueo automático en «Nunca».'}
    </StatusLabel>
  );
}

/** Registrar la entrega pide confirmar (evita marcarla con un toque accidental). */
function DeliverButton({
  stop,
  busy,
  primary,
  onConfirm,
}: {
  stop: LiveStop;
  busy: boolean;
  primary: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <p className="font-medium">¿Confirma que entregó el pedido en {stop.siteName}?</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-11"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              onConfirm();
            }}
          >
            <CircleCheck /> Sí, entregado
          </Button>
          <Button variant="outline" className="h-11" onClick={() => setAsking(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button
      variant={primary ? 'default' : 'outline'}
      className="h-11"
      disabled={busy}
      onClick={() => setAsking(true)}
    >
      {busy ? <LoaderCircle className="animate-spin" /> : <CircleCheck />} Registrar entrega
    </Button>
  );
}
