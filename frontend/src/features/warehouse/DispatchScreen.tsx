import { newId } from '@core/common/ids';
import { LOAD_SHORTAGE_LABEL, LOAD_SHORTAGE_REASONS } from '@core/modules/dispatch/domain/dispatch';
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  PackagePlus,
  Printer,
  Truck,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { formatClock } from '@/lib/format';
import type { LoadOrderView, LoadShortageReason, TruckLoadView, TruckSummary } from '@/types/api';
import { labelsFor, type LabelData } from '../dispatch/labels';
import { LabelSheet } from '../dispatch/OrderLabel';
import { CameraScanner } from './CameraScanner';
import { signal } from './feedback';
import { ScanField } from './ScanField';

const TRUCK_KEY = 'torre-control.dispatch-truck';
/** Varios operarios pueden cargar el mismo camión: la vista se refresca sola. */
const REFRESH_MS = 5_000;

function readTruck(): string {
  try {
    return localStorage.getItem(TRUCK_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveTruck(plate: string): void {
  try {
    localStorage.setItem(TRUCK_KEY, plate);
  } catch {
    // Sin almacenamiento: se vuelve a elegir el camión.
  }
}

const isReady = (o: LoadOrderView) => o.status === 'PICKEADO' || o.status === 'PICKEADO_PARCIAL';
const onBoard = (o: LoadOrderView) => o.lines.reduce((s, l) => s + l.loaded, 0);
const pending = (o: LoadOrderView) =>
  o.lines.reduce((s, l) => s + Math.max(0, l.picked - l.loaded), 0);

/**
 * Despacho: el operario elige el camión, ve sus pedidos en orden de carga y escanea cada
 * producto (o la etiqueta del pedido) al subirlo. Al cerrar, los pedidos quedan CARGADO.
 */
export function DispatchScreen({ operator, device }: { operator: string; device: string }) {
  const [plate, setPlate] = useState(readTruck);
  const [trucks, setTrucks] = useState<TruckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (plate) return;
    let active = true;
    api
      .dispatchTrucks()
      .then((list) => active && setTrucks(list))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [plate]);

  function choose(next: string) {
    saveTruck(next);
    setPlate(next);
  }

  if (plate) {
    return (
      <TruckLoad
        key={plate}
        plate={plate}
        operator={operator}
        device={device}
        onExit={() => choose('')}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-5" aria-hidden /> ¿Qué camión carga?
        </CardTitle>
        <CardDescription>Elija la patente para ver sus pedidos en orden de carga.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {error && <StatusLabel status="critical">{error}</StatusLabel>}
        {!trucks && !error && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Cargando camiones…
          </p>
        )}
        {trucks?.length === 0 && (
          <p className="text-muted-foreground">
            No hay camiones registrados. Agréguelos en «Flota y bodega».
          </p>
        )}
        {trucks?.map((t) => (
          <Button
            key={t.plate}
            variant="outline"
            className="h-auto min-h-14 justify-between gap-3 py-2 text-left"
            onClick={() => choose(t.plate)}
          >
            <span className="min-w-0">
              <span className="block text-base font-semibold">{t.plate}</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {t.vehicleName}
              </span>
            </span>
            <span className="text-right text-xs font-normal">
              {t.orders === 0
                ? 'Sin pedidos'
                : `${t.orders} ${t.orders === 1 ? 'pedido' : 'pedidos'} · ${t.ready} por cargar · ${t.loaded} cargados`}
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

interface Feedback {
  ok: boolean;
  message: string;
}

function TruckLoad({
  plate,
  operator,
  device,
  onExit,
}: {
  plate: string;
  operator: string;
  device: string;
  onExit: () => void;
}) {
  const [view, setView] = useState<TruckLoadView | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [camera, setCamera] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reasons, setReasons] = useState<
    Record<string, { reason: LoadShortageReason; note: string }>
  >({});
  const [labels, setLabels] = useState<LabelData[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(
    () =>
      api
        .dispatchTruck(plate)
        .then((next) => {
          setView(next);
          setError(null);
        })
        .catch((e: unknown) => setError(errorMessage(e))),
    [plate],
  );

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') queue.current = queue.current.then(reload);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  function scan(value: string) {
    const id = newId('LOAD');
    queue.current = queue.current.then(async () => {
      try {
        const result = await api.scanLoad(plate, { id, code: value, operator, device });
        setView(result.view);
        setFeedback({ ok: result.ok, message: result.message });
        signal(result.ok);
      } catch (e) {
        setFeedback({ ok: false, message: errorMessage(e) });
        signal(false);
      }
    });
  }

  async function act(action: () => Promise<TruckLoadView>, done?: (view: TruckLoadView) => void) {
    setBusy(true);
    setError(null);
    try {
      await queue.current;
      const next = await action();
      setView(next);
      done?.(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function printLabels(orders: LoadOrderView[]) {
    setError(null);
    try {
      const master = await api.masterData();
      const trucks = new Map(
        orders.map((o) => [o.orderId, { plate, position: o.routePosition }] as const),
      );
      setLabels(
        labelsFor(
          orders.map((o) => o.orderId),
          master,
          trucks,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!view) {
    return (
      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm">
          {error ? (
            <StatusLabel status="critical">{error}</StatusLabel>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Cargando {plate}…
            </p>
          )}
          <Button variant="outline" className="h-11" onClick={onExit}>
            <ArrowLeft /> Elegir otro camión
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (labels) {
    return <LabelSheet labels={labels} onClose={() => setLabels(null)} />;
  }

  const ready = view.loadOrders.filter(isReady);
  const withLoad = ready.filter((o) => onBoard(o) > 0);
  const missing = withLoad.flatMap((o) =>
    o.lines
      .filter((l) => l.picked > l.loaded)
      .map((l) => ({ order: o, line: l, key: `${o.orderId}|${l.sku}` })),
  );
  const fraction = view.progress.picked === 0 ? 0 : view.progress.loaded / view.progress.picked;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardDescription>{view.vehicleName}</CardDescription>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-xl">
            <span className="flex items-center gap-2">
              <Truck className="size-5" aria-hidden /> Carga de {view.plate}
            </span>
            <Button variant="ghost" className="h-11" onClick={onExit}>
              <ArrowLeft /> Otro camión
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Avance de la carga"
            aria-valuemin={0}
            aria-valuemax={view.progress.picked}
            aria-valuenow={view.progress.loaded}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="tabular-nums">
            {view.progress.loaded} de {view.progress.picked} unidades a bordo · {view.loaded}{' '}
            {view.loaded === 1 ? 'pedido cargado' : 'pedidos cargados'}
          </p>
          <ScanField
            id="load-code"
            label="Escanee cada producto al subirlo, o la etiqueta del pedido"
            onScan={scan}
            paused={closing}
          />
          {feedback && (
            <div
              role="status"
              aria-live="assertive"
              className="grid gap-1 rounded-lg border p-3 text-base"
            >
              <StatusLabel status={feedback.ok ? 'good' : 'critical'}>
                {feedback.message}
              </StatusLabel>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={() => setCamera((c) => !c)}>
              <Camera /> {camera ? 'Ocultar cámara' : 'Usar la cámara'}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={busy || view.progress.loaded === 0}
              onClick={() =>
                void act(
                  () => api.undoLoad(plate, { id: newId('UNDO'), operator }),
                  () => setFeedback({ ok: true, message: 'Se deshizo la última lectura.' }),
                )
              }
            >
              <Undo2 /> Deshacer último
            </Button>
          </div>
          {camera && <CameraScanner onCode={scan} onClose={() => setCamera(false)} />}
        </CardContent>
      </Card>

      {error && <StatusLabel status="critical">{error}</StatusLabel>}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            Orden de carga
            {view.loadOrders.length > 0 && (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void printLabels(view.loadOrders)}
              >
                <Printer /> Etiquetas
              </Button>
            )}
          </CardTitle>
          <CardDescription>
            Suba primero el N° 1: va al fondo porque se entrega último.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {view.loadOrders.length === 0 && (
            <p className="text-muted-foreground">
              Este camión no tiene pedidos. Publique el plan de rutas en «Optimizar rutas» o
              asígnele pedidos abajo.
            </p>
          )}
          {view.loadOrders.map((order, i) => (
            <LoadOrderCard
              key={order.orderId}
              index={i + 1}
              order={order}
              onLabel={() => void printLabels([order])}
            />
          ))}
        </CardContent>
      </Card>

      {view.unassigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pedidos sin camión</CardTitle>
            <CardDescription>
              Pickeados y fuera del plan publicado. Al asignarlos queda registrado que lo hizo{' '}
              {operator}; si el conductor ya salió, le aparecen en su ruta.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {view.unassigned.map((o) => (
              <div
                key={o.orderId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {o.orderId} · {o.siteName}
                  </span>
                  {o.customerName && (
                    <span className="block text-xs text-muted-foreground">{o.customerName}</span>
                  )}
                </span>
                <Button
                  className="h-11"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api.assignToTruck(plate, { orderId: o.orderId, operator }),
                      () =>
                        setFeedback({
                          ok: true,
                          message: `${o.orderId} quedó asignado a ${plate}.`,
                        }),
                    )
                  }
                >
                  <PackagePlus /> Asignar a {plate}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {closing ? (
        <Card>
          <CardHeader>
            <CardTitle>Cerrar con faltantes</CardTitle>
            <CardDescription>Indique por qué no sube cada producto.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {missing.map(({ order, line, key }) => {
              const current = reasons[key] ?? {
                reason: 'SIN_ESPACIO' as LoadShortageReason,
                note: '',
              };
              return (
                <div key={key} className="grid gap-2 rounded-lg border p-3">
                  <p className="font-medium">
                    {order.orderId}: no suben {line.picked - line.loaded} de {line.name}
                  </p>
                  <NativeSelect
                    aria-label={`Motivo de ${line.name} en ${order.orderId}`}
                    className="h-11"
                    value={current.reason}
                    onChange={(e) =>
                      setReasons({
                        ...reasons,
                        [key]: { ...current, reason: e.target.value as LoadShortageReason },
                      })
                    }
                  >
                    {LOAD_SHORTAGE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {LOAD_SHORTAGE_LABEL[r]}
                      </option>
                    ))}
                  </NativeSelect>
                  {current.reason === 'OTRO' && (
                    <Input
                      aria-label={`Detalle de ${line.name} en ${order.orderId}`}
                      placeholder="Explique por qué no sube"
                      value={current.note}
                      onChange={(e) =>
                        setReasons({ ...reasons, [key]: { ...current, note: e.target.value } })
                      }
                    />
                  )}
                </div>
              );
            })}
            <CloseButton
              busy={busy}
              label="Cerrar despacho con faltantes"
              onClick={() =>
                void act(
                  () =>
                    api.closeLoad(plate, {
                      operator,
                      shortages: missing.map(({ order, line, key }) => ({
                        orderId: order.orderId,
                        sku: line.sku,
                        reason: reasons[key]?.reason ?? 'SIN_ESPACIO',
                        note: reasons[key]?.note || null,
                      })),
                    }),
                  () => {
                    setClosing(false);
                    setFeedback({ ok: true, message: closedMessage(withLoad.length, plate) });
                  },
                )
              }
            />
            <Button variant="ghost" className="h-11" onClick={() => setClosing(false)}>
              Seguir escaneando
            </Button>
          </CardContent>
        </Card>
      ) : (
        withLoad.length > 0 && (
          <div className="grid gap-2">
            {ready.length > withLoad.length && (
              <StatusLabel status="warning">
                {ready.length - withLoad.length === 1
                  ? 'Un pedido listo no tiene nada a bordo: queda en bodega.'
                  : `${ready.length - withLoad.length} pedidos listos no tienen nada a bordo: quedan en bodega.`}
              </StatusLabel>
            )}
            {missing.length === 0 ? (
              <CloseButton
                busy={busy}
                label="Cerrar despacho"
                onClick={() =>
                  void act(
                    () => api.closeLoad(plate, { operator, shortages: [] }),
                    () => setFeedback({ ok: true, message: closedMessage(withLoad.length, plate) }),
                  )
                }
              />
            ) : (
              <Button
                variant="outline"
                className="h-12 text-base"
                disabled={busy}
                onClick={() => setClosing(true)}
              >
                <Truck /> Cerrar con faltantes
              </Button>
            )}
          </div>
        )
      )}

      {view.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Últimas lecturas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-xs">
            {view.events.map((e) => (
              <p key={e.id} className="flex flex-wrap items-center gap-x-2">
                <span className="tabular-nums text-muted-foreground">{formatClock(e.at)}</span>
                <StatusLabel
                  status={
                    e.result === 'OK' ? 'good' : e.result === 'DESHECHO' ? 'warning' : 'critical'
                  }
                >
                  {e.result === 'DESHECHO' ? `Deshecho: ${e.code}` : (e.message ?? e.code)}
                </StatusLabel>
                <span className="text-muted-foreground">{e.operator}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function closedMessage(count: number, plate: string): string {
  return count === 1
    ? `Despacho cerrado: un pedido quedó cargado en ${plate}.`
    : `Despacho cerrado: ${count} pedidos quedaron cargados en ${plate}.`;
}

function CloseButton({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button className="h-12 text-base" disabled={busy} onClick={onClick}>
      {busy ? <LoaderCircle className="animate-spin" /> : <Truck />} {label}
    </Button>
  );
}

function LoadOrderCard({
  index,
  order,
  onLabel,
}: {
  index: number;
  order: LoadOrderView;
  onLabel: () => void;
}) {
  const ready = isReady(order);
  const left = pending(order);
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0">
          <span className="font-semibold">
            {index}. {order.orderId} · {order.siteName}
          </span>
          <span className="block text-xs text-muted-foreground">
            {[
              order.customerName,
              order.manual ? 'asignado a mano' : `entrega N° ${order.routePosition}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </p>
        <Button variant="ghost" className="h-11" onClick={onLabel}>
          <Printer /> Etiqueta
        </Button>
      </div>
      {order.status === 'CARGADO' ? (
        <StatusLabel status="good">Cargado</StatusLabel>
      ) : !ready ? (
        <StatusLabel status="warning">
          {order.status === 'PENDIENTE'
            ? 'Falta el picking: todavía no se puede subir'
            : 'En picking: todavía no se puede subir'}
        </StatusLabel>
      ) : left === 0 ? (
        <StatusLabel status="good">Todo a bordo</StatusLabel>
      ) : (
        <Badge variant="outline" className="justify-self-start">
          Faltan {left} {left === 1 ? 'unidad' : 'unidades'} por subir
        </Badge>
      )}
      <ul className="grid gap-1">
        {order.lines.map((line) => {
          const done = line.picked > 0 && line.loaded >= line.picked;
          return (
            <li
              key={line.sku}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
            >
              {done ? (
                <CircleCheck className="size-4 text-status-good" aria-label="A bordo" />
              ) : (
                <CircleDashed className="size-4 text-muted-foreground" aria-label="Por subir" />
              )}
              <span className="min-w-0 truncate">{line.name}</span>
              <span className="font-semibold tabular-nums">
                {line.loaded}/{line.picked}
                {line.picked < line.ordered && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    (pedido {line.ordered})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
