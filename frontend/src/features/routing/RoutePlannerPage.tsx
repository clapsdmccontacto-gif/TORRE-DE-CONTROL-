import { LoaderCircle, Route, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  depotMarker,
  routeClass,
  routeLetter,
  routeLine,
  stopMarker,
  toLeaflet,
  useLeafletMap,
} from '@/components/map/leaflet';
import { StatTile, StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import {
  VEHICLE_SHORT_LABEL,
  formatClock,
  formatClp,
  formatKg,
  formatKm,
  formatLiters,
  formatPct,
  formatPlannedTime,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DeliveryView, RoutePlan } from '@/types/api';

export function RoutePlannerPage() {
  const [deliveries, setDeliveries] = useState<DeliveryView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dieselPrice, setDieselPrice] = useState(1_050);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Abre con el plan publicado o, si no hay, con todos los pedidos ya optimizados.
  useEffect(() => {
    let active = true;
    Promise.all([api.deliveries(), api.activePlan()])
      .then(async ([list, publishedPlan]) => {
        if (!active) return;
        setDeliveries(list);
        const ids = publishedPlan
          ? publishedPlan.routes.flatMap((r) => r.stops.map((s) => s.deliveryId))
          : list.map((d) => d.id);
        setSelected(new Set(ids));
        const result =
          publishedPlan ?? (await api.optimizeRoutes({ deliveryIds: ids, dieselPriceClp: 1_050 }));
        if (active) {
          setPlan(result);
          setDieselPrice(result.dieselPriceClp);
        }
      })
      .catch((e: unknown) => active && setError(errorMessage(e)))
      .finally(() => active && setPending(false));
    return () => {
      active = false;
    };
  }, []);

  async function optimize() {
    setPending(true);
    setError(null);
    try {
      setPlan(
        await api.optimizeRoutes({ deliveryIds: [...selected], dieselPriceClp: dieselPrice }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!plan) return;
    setPending(true);
    setError(null);
    try {
      setPlan(await api.publishPlan(plan.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Card className="content-start">
        <CardHeader>
          <CardTitle>Pedidos a despachar</CardTitle>
          <CardDescription>Entregas de mañana. Quite las que no salen hoy.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <ul className="grid grid-cols-1 gap-2">
            {deliveries.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm hover:bg-accent/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-current"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                  />
                  <span className="grid min-w-0 gap-1">
                    <span className="font-medium">
                      {d.siteName}{' '}
                      <span className="font-normal text-muted-foreground">· {d.commune}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {d.id} · {formatKg(d.weightKg)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {d.allowedVehicleCodes.map((code) => (
                        <Badge key={code} variant="outline">
                          {VEHICLE_SHORT_LABEL[code] ?? code}
                        </Badge>
                      ))}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium">Precio del diésel (CLP por litro)</span>
            <Input
              id="diesel-price"
              type="number"
              min={1}
              step={10}
              value={dieselPrice}
              onChange={(e) => setDieselPrice(Number(e.target.value))}
              className="tabular-nums"
            />
          </label>
          <Button onClick={optimize} disabled={pending || selected.size === 0}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Route />}
            Optimizar rutas
          </Button>
          <p className="text-xs text-muted-foreground">
            Asigna cada pedido al camión compatible que menos diésel agrega y reordena las paradas
            considerando que el consumo baja a medida que se descarga. Distancias estimadas en línea
            recta × 1,3 y velocidad media de 45 km/h.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 content-start gap-6">
        {error && (
          <StatusBanner status="critical" title="No se pudo planificar">
            {error}
          </StatusBanner>
        )}
        {plan && <PlanResult plan={plan} pending={pending} onPublish={publish} />}
      </div>
    </div>
  );
}

function PlanResult({
  plan,
  pending,
  onPublish,
}: {
  plan: RoutePlan;
  pending: boolean;
  onPublish: () => void;
}) {
  const { totals, baseline, savings } = plan;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <StatTile
          label="Diésel estimado"
          value={formatLiters(totals.fuelLiters)}
          hint={`Sin optimizar: ${formatLiters(baseline.fuelLiters)}`}
        />
        <StatTile label="Costo combustible" value={formatClp(totals.fuelCostClp)} />
        <StatTile
          label="Distancia"
          value={formatKm(totals.distanceKm)}
          hint={`${totals.routes} camiones`}
        />
        <StatTile label="CO₂" value={`${Math.round(totals.co2Kg)} kg`} />
      </div>

      {savings.fuelLiters > 0 ? (
        <StatusBanner
          status="good"
          title={`Ahorra ${formatLiters(savings.fuelLiters)} de diésel (${formatPct(savings.pct)} menos)`}
        >
          Frente a despachar en orden de llegada con el primer camión disponible:{' '}
          {formatClp(savings.fuelCostClp)} y {Math.round(savings.co2Kg)} kg de CO₂ menos en el día.
        </StatusBanner>
      ) : (
        <StatusBanner status="good" title="El despacho en orden de llegada ya era el más eficiente">
          Con estos pedidos no hay un orden que consuma menos diésel.
        </StatusBanner>
      )}

      {plan.unassigned.length > 0 && (
        <StatusBanner status="warning" title={`${plan.unassigned.length} pedidos sin camión`}>
          {plan.unassigned.map((u) => `${u.deliveryId} (${u.siteName}): ${u.reason}`).join(' ')}
        </StatusBanner>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <RoutePlanMap plan={plan} />
      </Card>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {plan.routes.map((route, index) => (
          <Card key={route.unitPlate} className="gap-3">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <span className={cn('route-swatch', routeClass(index))} aria-hidden />
                Ruta {routeLetter(index)} · {route.unitPlate}
              </CardTitle>
              <span className="text-sm text-muted-foreground">{route.vehicleName}</span>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm">
              <p className="text-muted-foreground tabular-nums">
                {route.stops.length} {route.stops.length === 1 ? 'parada' : 'paradas'} ·{' '}
                {formatKm(route.distanceKm)} · {formatLiters(route.fuelLiters)} ·{' '}
                {formatClp(route.fuelCostClp)} · carga {formatPct(route.weightUtilization)}
              </p>
              <ol className="grid gap-1.5">
                <li className="flex gap-3 text-muted-foreground">
                  <span className="w-12 shrink-0 tabular-nums">08:00</span>
                  Sale de {plan.depot.name}
                </li>
                {route.stops.map((stop, i) => (
                  <li key={stop.deliveryId} className="flex gap-3">
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                      {formatPlannedTime(stop.arrivalMin)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">
                        {routeLetter(index)}
                        {i + 1}. {stop.siteName}
                      </span>{' '}
                      <span className="text-muted-foreground">
                        · {stop.commune} · {formatKg(stop.weightKg)}
                      </span>
                    </span>
                  </li>
                ))}
                <li className="flex gap-3 text-muted-foreground">
                  <span className="w-12 shrink-0 tabular-nums">
                    {formatPlannedTime(route.durationMin)}
                  </span>
                  Regreso a bodega
                </li>
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {plan.publishedAt
              ? `Publicado a las ${formatClock(plan.publishedAt)}. Cada conductor ve su ruta y su carga al iniciar en «Modo conductor», y el mapa en vivo sigue el recorrido.`
              : 'Al publicar, cada conductor ve su ruta y su carga al iniciar en «Modo conductor».'}
          </p>
          <Button onClick={onPublish} disabled={pending || plan.publishedAt !== null}>
            <Send /> {plan.publishedAt ? 'Plan publicado' : 'Publicar a la flota'}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function RoutePlanMap({ plan }: { plan: RoutePlan }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, layerRef, baseMapAvailable } = useLeafletMap(containerRef, 9);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    depotMarker(plan.depot.location, plan.depot.name).addTo(layer);
    plan.routes.forEach((route, index) => {
      routeLine(route.path, routeClass(index)).addTo(layer);
      route.stops.forEach((stop, i) =>
        stopMarker(
          stop.location,
          `${routeLetter(index)}${i + 1}`,
          `${stop.siteName} · ${formatPlannedTime(stop.arrivalMin)} · ${route.unitPlate}`,
          routeClass(index),
        ).addTo(layer),
      );
    });
    const points = [plan.depot.location, ...plan.routes.flatMap((r) => r.path)].map(toLeaflet);
    map.fitBounds(points, { padding: [30, 30], maxZoom: 13 });
  }, [mapRef, layerRef, plan]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[420px] w-full"
        role="region"
        aria-label="Mapa de las rutas planificadas"
      />
      {!baseMapAvailable && (
        <p className="absolute right-3 bottom-8 left-3 z-[1000] rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground sm:left-auto sm:max-w-xs">
          Mapa de calles no disponible en esta vista. Rutas y obras se muestran igual.
        </p>
      )}
    </div>
  );
}
