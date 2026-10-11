import { code128Bars } from '@core/modules/dispatch/domain/code128';
import { Printer, X } from 'lucide-react';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { LabelData } from './labels';

/** Código de barras Code128 (negro sobre blanco en cualquier tema). */
export function Barcode({ value, height = 56 }: { value: string; height?: number }) {
  let drawn: ReturnType<typeof code128Bars>;
  try {
    drawn = code128Bars(value);
  } catch {
    return (
      <StatusLabel status="warning">
        El N° {value} tiene caracteres que no caben en un código de barras: escanee los productos.
      </StatusLabel>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${drawn.width} ${height}`}
      preserveAspectRatio="none"
      className="h-16 w-full bg-label-paper"
      role="img"
      aria-label={`Código de barras del pedido ${value}`}
      shapeRendering="crispEdges"
    >
      {drawn.bars.map(([x, w]) => (
        <rect key={x} x={x} width={w} height={height} className="fill-label-ink" />
      ))}
    </svg>
  );
}

export function OrderLabel({ label }: { label: LabelData }) {
  return (
    <article
      className="order-label grid gap-1 rounded-md border-2 border-label-ink bg-label-paper p-3 text-sm text-label-ink"
      aria-label={`Etiqueta del pedido ${label.orderId}`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tracking-wide">{label.orderId}</span>
        {label.plate && (
          <span className="text-right text-base font-semibold">
            {label.plate}
            {label.position !== null && ` · entrega ${label.position}`}
          </span>
        )}
      </p>
      <Barcode value={label.orderId} />
      <p className="font-semibold">{label.customerName ?? label.siteName}</p>
      {label.customerName && <p>{label.siteName}</p>}
      <p>{[label.address, label.commune].filter(Boolean).join(', ')}</p>
      <p className="flex flex-wrap justify-between gap-2 text-xs">
        <span>{label.contact ?? ''}</span>
        <span>
          {label.units} {label.units === 1 ? 'unidad' : 'unidades'}
          {label.deliveryDate && ` · entrega ${label.deliveryDate}`}
        </span>
      </p>
    </article>
  );
}

/**
 * Etiquetas listas para imprimir (o guardar en PDF). Al escanear la etiqueta en Despacho
 * sube el bulto completo del pedido.
 */
export function LabelSheet({ labels, onClose }: { labels: LabelData[]; onClose: () => void }) {
  return (
    <Card className="print-area">
      <CardHeader className="no-print">
        <CardTitle className="flex items-center gap-2">
          <Printer className="size-5" aria-hidden />
          {labels.length === 1 ? 'Etiqueta del pedido' : `${labels.length} etiquetas`}
        </CardTitle>
        <CardDescription>
          Péguela en el bulto: en Despacho, escanearla sube el pedido completo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {labels.map((label) => (
            <OrderLabel key={label.orderId} label={label} />
          ))}
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button className="h-11" onClick={() => window.print()}>
            <Printer /> Imprimir o guardar PDF
          </Button>
          <Button variant="outline" className="h-11" onClick={onClose}>
            <X /> Cerrar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
