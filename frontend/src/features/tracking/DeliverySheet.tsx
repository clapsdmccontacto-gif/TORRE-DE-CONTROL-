import { newId } from '@core/common/ids';
import {
  buildProof,
  deliveryDistance,
  deliveryOutcome,
  FAR_FROM_SITE_M,
  type OrderForProof,
} from '@core/modules/epod/domain/delivery-proof';
import { formatRut, isValidRut } from '@core/modules/epod/domain/rut';
import { Camera, CircleCheck, LoaderCircle, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { SignaturePad } from '@/components/signature-pad';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { queueDelivery } from '@/lib/delivery-outbox';
import { OUTCOME_LABEL, formatClock } from '@/lib/format';
import { compressPhoto } from '@/lib/image';
import type { DeliveryOutcome, LiveStop, PositionFix } from '@/types/api';

const REASONS = [
  'Faltó producto en el camión',
  'Producto dañado',
  'El cliente no lo recibe',
  'Obra cerrada, nadie recibe',
  'Dirección incorrecta',
];
const OTHER = 'Otro motivo';
const nowIso = () => new Date().toISOString();

/**
 * Comprobante de entrega (e-POD): cantidades entregadas (todo por defecto), motivo si no
 * se entregó todo, quién recibe (nombre, RUT y firma), foto del lugar y, solos, la hora,
 * el GPS y la distancia a la obra. Queda guardado en el teléfono hasta que llega al
 * servidor (sin señal no se pierde).
 */
export function DeliverySheet({
  stop,
  sessionId,
  lastFix,
  onDone,
  onCancel,
}: {
  stop: LiveStop;
  sessionId: string;
  lastFix: PositionFix | null;
  onDone: (outcome: DeliveryOutcome) => void;
  onCancel: () => void;
}) {
  const [delivered, setDelivered] = useState<Record<string, number>>(() =>
    Object.fromEntries(stop.cargo.map((l) => [l.sku, l.quantity])),
  );
  const [reasonChoice, setReasonChoice] = useState(REASONS[0]);
  const [reasonText, setReasonText] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverRut, setReceiverRut] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(newId('POD'));
  const [openedAt] = useState(nowIso);
  const photoInput = useRef<HTMLInputElement>(null);

  const order: OrderForProof = useMemo(
    () => ({
      id: stop.deliveryId,
      customerName: stop.details?.customerName ?? null,
      siteName: stop.siteName,
      siteAddress: stop.details?.address ?? null,
      commune: stop.details?.commune ?? '',
      siteLocation: stop.location,
      lines: stop.cargo.map((l) => ({ sku: l.sku, name: l.name, quantity: l.quantity })),
    }),
    [stop],
  );
  const lines = stop.cargo.map((l) => ({
    sku: l.sku,
    name: l.name,
    ordered: l.quantity,
    delivered: delivered[l.sku] ?? 0,
  }));
  const outcome = deliveryOutcome(lines);
  const reason = reasonChoice === OTHER ? reasonText : reasonChoice;
  const position = lastFix
    ? { lat: lastFix.lat, lng: lastFix.lng, accuracyM: lastFix.accuracyM }
    : null;
  const distance = deliveryDistance(position, stop.location);
  const rutError = receiverRut.trim() !== '' && !isValidRut(receiverRut);

  async function addPhoto(file: File) {
    setError(null);
    try {
      const compressed = await compressPhoto(file);
      setPhotos((current) => [...current, compressed].slice(0, 2));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit() {
    setError(null);
    const submission = {
      id: idRef.current,
      orderId: stop.deliveryId,
      sessionId,
      receiverName: outcome === 'RECHAZADO' ? receiverName || null : receiverName,
      receiverRut: receiverRut || null,
      lines: lines.map((l) => ({ sku: l.sku, delivered: l.delivered })),
      reason: outcome === 'ENTREGADO' ? null : reason,
      signature: outcome === 'RECHAZADO' ? null : signature,
      photos,
      position,
      capturedAt: nowIso(),
    };
    try {
      // Mismas reglas que el servidor: los errores aparecen antes de enviar.
      buildProof(submission, order, {
        vehiclePlate: '',
        driverName: '',
        receivedAt: submission.capturedAt,
        imageIds: ['a', 'b', 'c'],
      });
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    setBusy(true);
    try {
      await queueDelivery(submission);
      onDone(outcome);
    } catch (e) {
      setError(`No se pudo guardar en el teléfono: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const actionLabel =
    outcome === 'RECHAZADO'
      ? 'Registrar rechazo'
      : outcome === 'ENTREGA_PARCIAL'
        ? 'Registrar entrega parcial'
        : 'Registrar entrega';

  return (
    <Card>
      <CardHeader>
        <CardDescription>Entrega · {stop.deliveryId}</CardDescription>
        <CardTitle className="text-xl">{stop.siteName}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5 text-sm">
        <section className="grid gap-2">
          <h3 className="font-medium">Productos entregados</h3>
          {lines.map((line) => (
            <label
              key={line.sku}
              className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 rounded-md border p-2"
            >
              <span className="min-w-0">
                {line.name}
                <span className="block text-xs text-muted-foreground">Pedido: {line.ordered}</span>
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={line.ordered}
                step="any"
                className="h-11 text-base tabular-nums"
                aria-label={`Entregado de ${line.name}`}
                value={line.delivered}
                onChange={(e) =>
                  setDelivered({
                    ...delivered,
                    [line.sku]: Math.min(line.ordered, Math.max(0, Number(e.target.value))),
                  })
                }
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDelivered(Object.fromEntries(lines.map((l) => [l.sku, l.ordered])))}
            >
              Entregué todo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDelivered(Object.fromEntries(lines.map((l) => [l.sku, 0])))}
            >
              No recibieron nada (rechazo)
            </Button>
          </div>
          <StatusLabel
            status={
              outcome === 'ENTREGADO' ? 'good' : outcome === 'RECHAZADO' ? 'critical' : 'warning'
            }
          >
            {OUTCOME_LABEL[outcome]}
          </StatusLabel>
        </section>

        {outcome !== 'ENTREGADO' && (
          <section className="grid gap-2">
            <label className="grid gap-1.5">
              <span className="font-medium">
                Motivo {outcome === 'RECHAZADO' ? 'del rechazo' : 'de la entrega parcial'}
              </span>
              <NativeSelect
                id="delivery-reason"
                className="h-11 text-base"
                value={reasonChoice}
                onChange={(e) => setReasonChoice(e.target.value)}
              >
                {[...REASONS, OTHER].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </NativeSelect>
            </label>
            {reasonChoice === OTHER && (
              <Input
                id="delivery-reason-text"
                className="h-11 text-base"
                placeholder="Escriba el motivo"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
              />
            )}
          </section>
        )}

        {outcome !== 'RECHAZADO' && (
          <section className="grid gap-3">
            <h3 className="font-medium">Quién recibe</h3>
            <label className="grid gap-1.5">
              <span>Nombre</span>
              <Input
                id="delivery-receiver"
                className="h-11 text-base"
                autoComplete="off"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span>RUT</span>
              <Input
                id="delivery-rut"
                className="h-11 text-base"
                inputMode="text"
                autoComplete="off"
                placeholder="12.345.678-5"
                value={receiverRut}
                aria-invalid={rutError}
                onChange={(e) => setReceiverRut(e.target.value)}
                onBlur={() => isValidRut(receiverRut) && setReceiverRut(formatRut(receiverRut))}
              />
              {rutError && <StatusLabel status="critical">El RUT no es válido.</StatusLabel>}
            </label>
            <div className="grid gap-1.5">
              <span>Firma</span>
              <SignaturePad id="delivery-signature" onChange={setSignature} />
            </div>
          </section>
        )}

        <section className="grid gap-2">
          <h3 className="font-medium">Foto del lugar de entrega</h3>
          <input
            ref={photoInput}
            id="delivery-photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void addPhoto(file);
            }}
          />
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {photos.map((photo, i) => (
                <div key={i} className="relative">
                  <img
                    src={photo}
                    alt={i === 0 ? 'Foto del lugar de entrega' : 'Segunda foto'}
                    className="aspect-[4/3] w-full rounded-md border object-cover"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute top-1 right-1"
                    aria-label="Quitar foto"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 2 && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => photoInput.current?.click()}
            >
              <Camera />{' '}
              {photos.length === 0
                ? 'Tomar foto del domicilio'
                : 'Agregar otra foto (carga descargada)'}
            </Button>
          )}
        </section>

        <section className="grid gap-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span>Hora: {formatClock(openedAt)} (se guarda sola)</span>
          {position ? (
            distance.farFromSite ? (
              <StatusLabel status="warning">
                Está a {distance.distanceM} m de la obra (más de {FAR_FROM_SITE_M} m): el
                comprobante quedará marcado para revisar.
              </StatusLabel>
            ) : (
              <span>GPS: a {distance.distanceM} m de la obra.</span>
            )
          ) : (
            <StatusLabel status="warning">
              Sin GPS: el comprobante se guarda sin ubicación.
            </StatusLabel>
          )}
        </section>

        {error && <StatusLabel status="critical">{error}</StatusLabel>}
        <div className="grid grid-cols-1 gap-2">
          <Button
            className="h-12 text-base"
            disabled={busy || rutError}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <CircleCheck />} {actionLabel}
          </Button>
          <Button variant="ghost" className="h-11" onClick={onCancel}>
            <X /> Volver sin registrar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
