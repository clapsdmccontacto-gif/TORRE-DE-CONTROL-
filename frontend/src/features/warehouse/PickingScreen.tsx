import { newId } from '@core/common/ids';
import { SHORTAGE_LABEL, SHORTAGE_REASONS } from '@core/modules/picking/domain/pick-task';
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Undo2,
  Unlock,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import type { CartType, MixViolation, PickView, ShortageReason } from '@/types/api';
import { CameraScanner } from './CameraScanner';
import { signal } from './feedback';
import { ScanField } from './ScanField';

const CART_LABEL: Record<CartType, string> = {
  MODULAR: 'Carro modular',
  PLATAFORMA_PESADA: 'Plataforma pesada',
  CARRO_LARGOS: 'Carro de largos',
};

interface Feedback {
  ok: boolean;
  message: string;
  mix: MixViolation[];
}

/**
 * Picking de un pedido: lista por ubicación, campo siempre listo para la pistola (cada
 * lectura termina en Enter), cámara del celular o código escrito. Las lecturas se envían
 * en orden, una tras otra.
 */
export function PickingScreen({
  initial,
  operator,
  device,
  onExit,
}: {
  initial: PickView;
  operator: string;
  device: string;
  onExit: () => void;
}) {
  const [view, setView] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [camera, setCamera] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reasons, setReasons] = useState<Record<string, { reason: ShortageReason; note: string }>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const cartRef = useRef<CartType>(initial.cartType);
  const [cartType, setCartType] = useState<CartType>(initial.cartType);
  const orderId = initial.orderId;

  function scan(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const id = newId('SCAN');
    queue.current = queue.current.then(async () => {
      try {
        const result = await api.scanPick(orderId, {
          id,
          code: value,
          operator,
          device,
          cartType: cartRef.current,
        });
        setView(result.view);
        setFeedback({ ok: result.ok, message: result.message, mix: result.mix });
        signal(result.ok && !result.mix.some((m) => m.severity === 'BLOQUEO'));
      } catch (e) {
        setFeedback({ ok: false, message: errorMessage(e), mix: [] });
        signal(false);
      }
    });
  }

  async function act(action: () => Promise<PickView>, after?: (view: PickView) => void) {
    setBusy(true);
    setError(null);
    try {
      await queue.current;
      const next = await action();
      setView(next);
      after?.(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const incomplete = view.lines.filter((l) => l.picked < l.ordered);
  const finished = view.status === 'PICKEADO' || view.status === 'PICKEADO_PARCIAL';

  if (finished) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="size-5" aria-hidden /> Pedido {view.orderId} listo
          </CardTitle>
          <CardDescription>{view.siteName}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <StatusLabel status={view.status === 'PICKEADO' ? 'good' : 'warning'}>
            {view.status === 'PICKEADO'
              ? 'Picking completo.'
              : `Cerrado con ${view.shortages.length === 1 ? 'un faltante' : `${view.shortages.length} faltantes`}: la torre ya lo ve.`}
          </StatusLabel>
          <Button className="h-12 text-base" onClick={onExit}>
            <ArrowLeft /> Volver a la lista
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardDescription>
            {view.customerName ?? 'Pedido'} ·{' '}
            {view.deliveryDate ? `entrega ${view.deliveryDate}` : 'sin fecha'}
            {view.vehiclePlate && ` · camión ${view.vehiclePlate}`}
          </CardDescription>
          <CardTitle className="text-xl">
            {view.orderId} · {view.siteName}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Avance del picking"
            aria-valuemin={0}
            aria-valuemax={view.progress.ordered}
            aria-valuenow={view.progress.picked}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(view.progress.fraction * 100)}%` }}
            />
          </div>
          <p className="tabular-nums">
            {view.progress.picked} de {view.progress.ordered} unidades ·{' '}
            {Math.round(view.progress.fraction * 100)} %
          </p>
          {view.notes && <p className="text-muted-foreground italic">{view.notes}</p>}
          <ScanField
            id="pick-code"
            label="Escanee con la pistola o escriba el código"
            onScan={scan}
            paused={closing}
          />
          {feedback && (
            <div
              role="status"
              className="grid gap-1 rounded-lg border p-3 text-base"
              aria-live="assertive"
            >
              <StatusLabel status={feedback.ok ? 'good' : 'critical'}>
                {feedback.message}
              </StatusLabel>
              {feedback.mix.map((m) => (
                <StatusLabel
                  key={m.rule + m.skus.join()}
                  status={m.severity === 'BLOQUEO' ? 'critical' : 'warning'}
                >
                  {m.message}
                  {m.severity === 'BLOQUEO' && ' Póngalo en otro carro.'}
                </StatusLabel>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={() => setCamera((c) => !c)}>
              <Camera /> {camera ? 'Ocultar cámara' : 'Usar la cámara'}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={busy || view.progress.picked === 0}
              onClick={() =>
                void act(
                  () => api.undoPick(orderId, { id: newId('UNDO'), operator }),
                  () =>
                    setFeedback({ ok: true, message: 'Se deshizo la última lectura.', mix: [] }),
                )
              }
            >
              <Undo2 /> Deshacer último
            </Button>
          </div>
          {camera && <CameraScanner onCode={scan} onClose={() => setCamera(false)} />}
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">
              Carro (para avisar mezclas prohibidas)
            </span>
            <NativeSelect
              id="pick-cart"
              value={cartType}
              onChange={(e) => {
                cartRef.current = e.target.value as CartType;
                setCartType(cartRef.current);
              }}
            >
              {(Object.keys(CART_LABEL) as CartType[]).map((c) => (
                <option key={c} value={c}>
                  {CART_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista de picking</CardTitle>
          <CardDescription>Ordenada por ubicación en bodega</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {view.lines.map((line) => {
            const done = line.picked >= line.ordered;
            return (
              <div
                key={line.sku}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3"
              >
                {done ? (
                  <CircleCheck className="size-5 text-status-good" aria-label="Completo" />
                ) : (
                  <CircleDashed className="size-5 text-muted-foreground" aria-label="Pendiente" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">{line.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {line.sku}
                    {line.binLocation && (
                      <Badge variant="outline">
                        <MapPin aria-hidden /> {line.binLocation}
                      </Badge>
                    )}
                  </span>
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {line.picked}/{line.ordered}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {error && <StatusLabel status="critical">{error}</StatusLabel>}

      {closing ? (
        <Card>
          <CardHeader>
            <CardTitle>Cerrar con faltantes</CardTitle>
            <CardDescription>Indique por qué falta cada producto.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {incomplete.map((line) => {
              const current = reasons[line.sku] ?? {
                reason: 'SIN_STOCK' as ShortageReason,
                note: '',
              };
              return (
                <div key={line.sku} className="grid gap-2 rounded-lg border p-3">
                  <p className="font-medium">
                    Faltan {line.ordered - line.picked} de {line.name}
                  </p>
                  <NativeSelect
                    aria-label={`Motivo del faltante de ${line.name}`}
                    className="h-11"
                    value={current.reason}
                    onChange={(e) =>
                      setReasons({
                        ...reasons,
                        [line.sku]: { ...current, reason: e.target.value as ShortageReason },
                      })
                    }
                  >
                    {SHORTAGE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {SHORTAGE_LABEL[r]}
                      </option>
                    ))}
                  </NativeSelect>
                  {current.reason === 'OTRO' && (
                    <Input
                      aria-label={`Detalle del faltante de ${line.name}`}
                      placeholder="Explique el faltante"
                      value={current.note}
                      onChange={(e) =>
                        setReasons({ ...reasons, [line.sku]: { ...current, note: e.target.value } })
                      }
                    />
                  )}
                </div>
              );
            })}
            <Button
              className="h-12 text-base"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.closePick(orderId, {
                    operator,
                    shortages: incomplete.map((l) => ({
                      sku: l.sku,
                      reason: reasons[l.sku]?.reason ?? 'SIN_STOCK',
                      note: reasons[l.sku]?.note || null,
                    })),
                  }),
                )
              }
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <PackageCheck />} Cerrar pedido
              con faltantes
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => setClosing(false)}>
              Seguir escaneando
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {incomplete.length === 0 ? (
            <Button
              className="h-12 text-base"
              disabled={busy}
              onClick={() => void act(() => api.closePick(orderId, { operator, shortages: [] }))}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <PackageCheck />} Terminar picking
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-12 text-base"
              disabled={busy || view.progress.picked === 0}
              onClick={() => setClosing(true)}
            >
              <PackageCheck /> Cerrar con faltantes
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-11"
            disabled={busy}
            onClick={() => void act(() => api.releasePick(orderId, { operator }), onExit)}
          >
            <Unlock /> Liberar pedido (lo puede tomar otro)
          </Button>
          <Button variant="ghost" className="h-11" onClick={onExit}>
            <ArrowLeft /> Volver a la lista (sigue tomado por usted)
          </Button>
        </div>
      )}
      {view.status !== 'EN_PICKING' && (
        <StatusBanner status="warning" title="El pedido ya no está tomado por usted">
          Vuelva a la lista y tómelo de nuevo.
        </StatusBanner>
      )}
    </div>
  );
}
