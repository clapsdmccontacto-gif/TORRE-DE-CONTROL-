import { SHORTAGE_LABEL } from '@core/modules/picking/domain/pick-task';
import { LoaderCircle, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatTile, StatusBanner, StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { api, apiMode, errorMessage } from '@/lib/api';
import { ORDER_STATUS_LABEL } from '@/lib/format';
import type { OrderStatus, PickAlert, PickMonitor, PickMonitorItem } from '@/types/api';

const ALERT: Record<PickAlert, { status: 'warning' | 'critical'; text: string }> = {
  ATRASADO: { status: 'critical', text: 'Atrasado (fecha de entrega vencida)' },
  DEMORADO: { status: 'warning', text: 'Picking demorado (más de 45 min)' },
  FALTANTE: { status: 'warning', text: 'Con faltantes' },
};

type Filter = 'TODOS' | OrderStatus | 'ALERTAS';

/** Tablero en vivo del picking: qué falta preparar, quién prepara qué y qué quedó listo. */
export function PickingMonitorPage() {
  const [monitor, setMonitor] = useState<PickMonitor | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<Filter>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      api.subscribePicking(
        (snapshot) => {
          setMonitor(snapshot);
          setOffline(false);
        },
        () => setOffline(true),
      ),
    [],
  );

  const orders = monitor?.orders ?? [];
  const count = (status: OrderStatus) => orders.filter((o) => o.status === status).length;
  const shown = orders.filter((o) =>
    filter === 'TODOS' ? true : filter === 'ALERTAS' ? o.alerts.length > 0 : o.status === filter,
  );

  async function release(item: PickMonitorItem) {
    if (
      !window.confirm(`¿Liberar el pedido ${item.orderId}? ${item.operator} dejará de prepararlo.`)
    )
      return;
    setBusy(item.orderId);
    setError(null);
    try {
      await api.releasePick(item.orderId, { operator: 'Torre de control', force: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      {offline && apiMode === 'http' && (
        <StatusBanner status="warning" title="Sin conexión con la nube">
          Reintentando automáticamente. El tablero puede no estar al día.
        </StatusBanner>
      )}
      {error && <StatusLabel status="critical">{error}</StatusLabel>}
      {!monitor && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Cargando…
        </p>
      )}
      {monitor && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Por preparar" value={String(count('PENDIENTE'))} />
          <StatTile label="En picking" value={String(count('EN_PICKING'))} />
          <StatTile label="Listos" value={String(count('PICKEADO'))} />
          <StatTile label="Con faltantes" value={String(count('PICKEADO_PARCIAL'))} />
        </div>
      )}
      {monitor && (
        <label className="flex max-w-xs items-center gap-2 text-sm">
          <span className="shrink-0 font-medium">Mostrar</span>
          <NativeSelect
            id="picking-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="TODOS">Todos</option>
            <option value="ALERTAS">Con alertas</option>
            {(['PENDIENTE', 'EN_PICKING', 'PICKEADO', 'PICKEADO_PARCIAL'] as const).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {monitor && shown.length === 0 && (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No hay pedidos en esta vista. Los operarios trabajan desde la app de bodega (enlace en
            «Flota y bodega»).
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((item) => (
          <Card key={item.orderId} className="gap-3 py-4">
            <CardContent className="grid gap-2 px-4 text-sm">
              <p className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    {item.orderId} · {item.siteName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      item.customerName,
                      item.deliveryDate && `entrega ${item.deliveryDate}`,
                      item.vehiclePlate && `camión ${item.vehiclePlate}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Badge variant={item.status === 'EN_PICKING' ? 'default' : 'outline'}>
                  {ORDER_STATUS_LABEL[item.status]}
                </Badge>
              </p>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`Avance de ${item.orderId}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.progress.fraction * 100)}
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(item.progress.fraction * 100)}%` }}
                />
              </div>
              <p className="text-muted-foreground tabular-nums">
                {item.progress.picked} de {item.progress.ordered} unidades (
                {Math.round(item.progress.fraction * 100)} %)
                {item.operator && ` · ${item.operator}`}
                {item.elapsedMin !== null && ` · ${item.elapsedMin} min`}
              </p>
              {item.shortages.map((s) => (
                <StatusLabel key={s.sku} status="warning">
                  Faltan {s.missing} de {s.name} ({SHORTAGE_LABEL[s.reason]}
                  {s.note ? `: ${s.note}` : ''})
                </StatusLabel>
              ))}
              {item.alerts
                .filter((a) => a !== 'FALTANTE')
                .map((a) => (
                  <StatusLabel key={a} status={ALERT[a].status}>
                    {ALERT[a].text}
                  </StatusLabel>
                ))}
              {item.status === 'EN_PICKING' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={busy === item.orderId}
                  onClick={() => void release(item)}
                >
                  <Unlock /> Liberar
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
