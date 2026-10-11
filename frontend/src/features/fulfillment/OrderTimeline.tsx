import { formatRut } from '@core/modules/epod/domain/rut';
import {
  Circle,
  ClipboardList,
  LoaderCircle,
  MapPin,
  Navigation,
  PackageCheck,
  RotateCcw,
  ScanBarcode,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusLabel } from '@/components/status';
import { api, errorMessage } from '@/lib/api';
import { OUTCOME_STATUS, formatDateTime } from '@/lib/format';
import type { DeliveryOutcome, DeliveryProof, OrderEvent, OrderTrack } from '@/types/api';
import { ProofImage } from '../epod/ProofImage';

const ICON: Partial<Record<OrderEvent['status'], LucideIcon>> = {
  PENDIENTE: RotateCcw,
  EN_PICKING: ScanBarcode,
  PICKEADO: PackageCheck,
  CARGADO: Truck,
  EN_RUTA: Navigation,
};

const isOutcome = (status: OrderEvent['status']): status is DeliveryOutcome =>
  status in OUTCOME_STATUS;

/** Frase de cada hito: quién hizo qué (y en qué camión). */
function describe(event: OrderEvent, proof: DeliveryProof | null): string {
  const by = event.actor ? ` por ${event.actor}` : '';
  const plate = event.vehiclePlate ?? '';
  switch (event.status) {
    case 'PENDIENTE':
      return `Volvió a pendiente${by}`;
    case 'EN_PICKING':
      return event.actor ? `${event.actor} empezó el picking` : 'Empezó el picking';
    case 'PICKEADO':
      return `Pickeado${by}`;
    case 'PICKEADO_PARCIAL':
      return `Pickeado con faltantes${by}`;
    case 'CARGADO':
      return `Cargado en ${plate || 'camión'}${by}`;
    case 'EN_RUTA':
      return `Salió a ruta en ${plate || 'camión'}${event.actor ? ` con ${event.actor}` : ''}`;
    default: {
      const label =
        event.status === 'ENTREGADO'
          ? 'Entregado'
          : event.status === 'ENTREGA_PARCIAL'
            ? 'Entrega parcial'
            : 'Rechazado';
      const receiver = proof?.receiverName ? ` a ${proof.receiverName}` : '';
      return event.status === 'RECHAZADO' ? `${label}${by}` : `${label}${receiver}${by}`;
    }
  }
}

/**
 * Línea de tiempo de un pedido: picking (quién y cuándo), carga (camión, quién y cuándo)
 * y entrega (a quién, con firma, foto, GPS y hora). Con `proof` (pantalla «Entregas», que
 * ya muestra el comprobante) no lo vuelve a pedir ni a mostrar.
 */
export function OrderTimeline({
  orderId,
  track,
  proof: given,
}: {
  orderId: string;
  track: OrderTrack | null;
  proof?: DeliveryProof | null;
}) {
  const events = track?.events ?? [];
  const delivered = events.some((e) => isOutcome(e.status));
  const [fetched, setFetched] = useState<DeliveryProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proof = given === undefined ? fetched : given;

  useEffect(() => {
    if (!delivered || given !== undefined) return;
    let active = true;
    api.deliveryProofs({ order: orderId }).then(
      (list) => active && setFetched(list[0] ?? null),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, [orderId, delivered, given]);

  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <ClipboardList className="size-4" aria-hidden /> Pendiente: todavía no entra a picking.
      </p>
    );
  }

  return (
    <ol className="grid gap-3" aria-label={`Historial del pedido ${orderId}`}>
      {events.map((event, i) => {
        const Icon = ICON[event.status] ?? Circle;
        const text = describe(event, proof);
        const outcome = isOutcome(event.status) ? event.status : null;
        return (
          <li key={`${event.at}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
            <span className="mt-0.5 flex size-6 items-center justify-center rounded-full border bg-card">
              {/* Los hitos con estado ya llevan su ícono junto al texto. */}
              {outcome || event.status === 'PICKEADO_PARCIAL' ? (
                <span className="size-2 rounded-full bg-muted-foreground" aria-hidden />
              ) : (
                <Icon className="size-3.5" aria-hidden />
              )}
            </span>
            <div className="grid min-w-0 gap-0.5">
              {outcome ? (
                <StatusLabel status={OUTCOME_STATUS[outcome]}>{text}</StatusLabel>
              ) : event.status === 'PICKEADO_PARCIAL' ? (
                <StatusLabel status="warning">{text}</StatusLabel>
              ) : (
                <span className="font-medium">{text}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(event.at)}
              </span>
              {event.detail && (
                <span className="text-xs text-muted-foreground">{event.detail}</span>
              )}
              {outcome && given === undefined && (
                <ProofSummary orderId={orderId} proof={proof} error={error} />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProofSummary({
  orderId,
  proof,
  error,
}: {
  orderId: string;
  proof: DeliveryProof | null;
  error: string | null;
}) {
  if (error) return <StatusLabel status="critical">{error}</StatusLabel>;
  if (!proof) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Cargando comprobante…
      </span>
    );
  }
  const signature = proof.images.find((i) => i.kind === 'FIRMA');
  const photos = proof.images.filter((i) => i.kind === 'FOTO');
  return (
    <div className="mt-1 grid gap-2 rounded-lg border p-2 text-xs">
      <p>
        {proof.receiverName ?? 'Sin nombre'}
        {proof.receiverRut && ` · RUT ${formatRut(proof.receiverRut)}`} · {proof.driverName} ·{' '}
        {proof.vehiclePlate} · firmado {formatDateTime(proof.capturedAt)}
      </p>
      {proof.reason && <p className="italic">{proof.reason}</p>}
      <p className="flex items-center gap-1">
        <MapPin className="size-3.5" aria-hidden />
        {proof.distanceM === null ? (
          'Sin GPS al entregar'
        ) : proof.farFromSite ? (
          <StatusLabel status="warning">A {proof.distanceM} m de la obra</StatusLabel>
        ) : (
          `A ${proof.distanceM} m de la obra`
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {signature && (
          <ProofImage
            proofId={proof.id}
            imageId={signature.id}
            alt={`Firma de ${proof.receiverName ?? 'quien recibió'}`}
            className="h-16 w-32 rounded border bg-label-paper object-contain"
          />
        )}
        {photos.map((photo, i) => (
          <ProofImage
            key={photo.id}
            proofId={proof.id}
            imageId={photo.id}
            alt={`Foto ${i + 1} de la entrega`}
            className="h-16 w-24 rounded border object-cover"
          />
        ))}
      </div>
      <a
        className="justify-self-start font-medium underline"
        href={`#entregas?pedido=${encodeURIComponent(orderId)}`}
      >
        Ver comprobante completo
      </a>
    </div>
  );
}
