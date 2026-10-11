import { formatRut } from '@core/modules/epod/domain/rut';
import { ChevronDown, ChevronUp, LoaderCircle, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { StatTile, StatusBanner, StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, apiMode, errorMessage } from '@/lib/api';
import { OUTCOME_LABEL, OUTCOME_STATUS, formatDateTime } from '@/lib/format';
import type { DeliveryOutcome, DeliveryProof, OrderTrack } from '@/types/api';
import { OrderTimeline } from '../fulfillment/OrderTimeline';
import { ProofImage } from './ProofImage';
import { ProofMap } from './ProofMap';

const REFRESH_MS = 30_000;

/** Fecha local AAAA-MM-DD (para el selector de fechas). */
function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Inicio del día local en ISO (para filtrar en el servidor). */
function dayStart(day: string, plusDays = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + plusDays).toISOString();
}

/** `#entregas?pedido=NV-1` abre directo ese comprobante (desde el mapa en vivo). */
function orderFromHash(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('pedido');
}

/** Comprobantes de entrega: quién recibió, firma, fotos, hora y punto de entrega. */
export function DeliveriesPage() {
  const [from, setFrom] = useState(() => localDate());
  const [to, setTo] = useState(() => localDate());
  const [plate, setPlate] = useState('');
  const [outcome, setOutcome] = useState<DeliveryOutcome | ''>('');
  const [order, setOrder] = useState(orderFromHash);
  const [proofs, setProofs] = useState<DeliveryProof[] | null>(null);
  const [tracks, setTracks] = useState<Map<string, OrderTrack>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setOrder(orderFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .deliveryProofs(
          order
            ? { order }
            : {
                from: dayStart(from),
                to: dayStart(to, 1),
                plate: plate || undefined,
                outcome: outcome || undefined,
              },
        )
        .then(async (list) => {
          const history = await api.orderTracks().catch(() => []);
          if (!active) return;
          setTracks(new Map(history.map((t) => [t.orderId, t])));
          setProofs(list);
          setError(null);
          if (order && list[0]) setOpen(list[0].id);
        })
        .catch((e: unknown) => active && setError(errorMessage(e)));
    void load();
    const timer = setInterval(() => {
      if (apiMode === 'http' && document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [from, to, plate, outcome, order]);

  const plates = useMemo(
    () => [...new Set((proofs ?? []).map((p) => p.vehiclePlate))].sort(),
    [proofs],
  );
  const count = (o: DeliveryOutcome) => proofs?.filter((p) => p.outcome === o).length ?? 0;
  const far = proofs?.filter((p) => p.farFromSite).length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="gap-3">
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Desde</span>
            <Input
              id="deliveries-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Hasta</span>
            <Input
              id="deliveries-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Camión</span>
            <NativeSelect
              id="deliveries-plate"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
            >
              <option value="">Todos</option>
              {[...new Set([...plates, ...(plate ? [plate] : [])])].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Resultado</span>
            <NativeSelect
              id="deliveries-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as DeliveryOutcome | '')}
            >
              <option value="">Todos</option>
              {(Object.keys(OUTCOME_LABEL) as DeliveryOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </NativeSelect>
          </label>
          {order && (
            <p className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4">
              Mostrando el pedido {order}.
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  history.replaceState(null, '', '#entregas');
                  setOrder(null);
                }}
              >
                Ver todas las entregas
              </Button>
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <StatusBanner status="critical" title="No se pudieron cargar las entregas">
          {error}
        </StatusBanner>
      )}
      {!proofs && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Cargando entregas…
        </p>
      )}
      {proofs && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Entregados" value={String(count('ENTREGADO'))} />
          <StatTile label="Entregas parciales" value={String(count('ENTREGA_PARCIAL'))} />
          <StatTile label="Rechazados" value={String(count('RECHAZADO'))} />
          <StatTile label="Para revisar (lejos de la obra)" value={String(far)} />
        </div>
      )}
      {proofs?.length === 0 && (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No hay entregas registradas con estos filtros. Los conductores las registran desde el
            modo conductor con «Entregar (firma y foto)».
          </CardContent>
        </Card>
      )}
      {proofs?.map((proof) => (
        <ProofCard
          key={proof.id}
          proof={proof}
          track={tracks.get(proof.orderId) ?? null}
          open={open === proof.id}
          onToggle={() => setOpen(open === proof.id ? null : proof.id)}
        />
      ))}
    </div>
  );
}

function ProofCard({
  proof,
  track,
  open,
  onToggle,
}: {
  proof: DeliveryProof;
  track: OrderTrack | null;
  open: boolean;
  onToggle: () => void;
}) {
  const signature = proof.images.find((i) => i.kind === 'FIRMA');
  const photos = proof.images.filter((i) => i.kind === 'FOTO');
  return (
    <Card className={open ? 'print-area' : undefined}>
      <CardHeader>
        <CardDescription>
          {formatDateTime(proof.capturedAt)} · {proof.vehiclePlate} · {proof.driverName}
        </CardDescription>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {proof.orderId} · {proof.siteName}
          </span>
          <StatusLabel status={OUTCOME_STATUS[proof.outcome]}>
            {OUTCOME_LABEL[proof.outcome]}
          </StatusLabel>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm">
        <p className="text-muted-foreground">
          {proof.receiverName
            ? `Recibió ${proof.receiverName}${proof.receiverRut ? ` (RUT ${formatRut(proof.receiverRut)})` : ''}`
            : 'Sin receptor'}
          {proof.reason && ` · Motivo: ${proof.reason}`}
        </p>
        {proof.farFromSite ? (
          <StatusLabel status="warning">
            Registrada a {proof.distanceM} m de la obra: revisar.
          </StatusLabel>
        ) : proof.distanceM !== null ? (
          <StatusLabel status="good">Registrada a {proof.distanceM} m de la obra.</StatusLabel>
        ) : (
          <StatusLabel status="warning">Sin GPS al registrar.</StatusLabel>
        )}
        <Button
          variant="outline"
          size="sm"
          className="no-print justify-self-start"
          onClick={onToggle}
        >
          {open ? <ChevronUp /> : <ChevronDown />}{' '}
          {open ? 'Ocultar comprobante' : 'Ver comprobante'}
        </Button>
        {open && (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <p className="font-medium">Comprobante de entrega · Constructor Center</p>
              <p className="text-muted-foreground">
                {[proof.customerName, proof.siteAddress, proof.commune].filter(Boolean).join(' · ')}
              </p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Producto</th>
                  <th className="py-1 text-right font-medium">Pedido</th>
                  <th className="py-1 text-right font-medium">Entregado</th>
                </tr>
              </thead>
              <tbody>
                {proof.lines.map((line) => (
                  <tr key={line.sku} className="border-t">
                    <td className="py-1">{line.name}</td>
                    <td className="py-1 text-right tabular-nums">{line.ordered}</td>
                    <td className="py-1 text-right tabular-nums">{line.delivered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-2">
              {signature && (
                <figure className="grid gap-1">
                  <figcaption className="text-xs text-muted-foreground">Firma</figcaption>
                  <ProofImage
                    proofId={proof.id}
                    imageId={signature.id}
                    alt={`Firma de ${proof.receiverName ?? 'quien recibe'}`}
                    className="max-h-40 w-full rounded-md border bg-label-paper object-contain"
                  />
                </figure>
              )}
              {photos.map((photo, i) => (
                <figure key={photo.id} className="grid gap-1">
                  <figcaption className="text-xs text-muted-foreground">
                    {i === 0 ? 'Lugar de entrega' : 'Otra foto'}
                  </figcaption>
                  <ProofImage
                    proofId={proof.id}
                    imageId={photo.id}
                    alt={i === 0 ? 'Foto del lugar de entrega' : 'Foto adicional'}
                    className="max-h-72 w-full rounded-md border object-cover"
                  />
                </figure>
              ))}
            </div>
            <ProofMap proof={proof} />
            <div className="grid gap-2">
              <p className="font-medium">Historial del pedido</p>
              <OrderTimeline orderId={proof.orderId} track={track} proof={proof} />
            </div>
            <p className="text-xs text-muted-foreground">
              Registrado en el teléfono {formatDateTime(proof.capturedAt)} · recibido en la torre{' '}
              {formatDateTime(proof.receivedAt)} · comprobante {proof.id}
            </p>
            <Button className="no-print justify-self-start" onClick={() => window.print()}>
              <Printer /> Imprimir o guardar PDF
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
