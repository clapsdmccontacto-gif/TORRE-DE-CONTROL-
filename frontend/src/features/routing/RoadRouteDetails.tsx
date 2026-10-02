import { navigationLinks } from '@core/modules/routing/domain/road-route';
import { ExternalLink, Navigation } from 'lucide-react';
import { StatusBanner, StatusLabel, type Status } from '@/components/status';
import { LinkButton } from '@/components/ui/button';
import { formatClock, formatDuration, formatKm } from '@/lib/format';
import type { LatLng, RoadRoute, RoadsideFeatures, TrafficSeverity } from '@/types/api';

const SEVERITY: Record<TrafficSeverity, { status: Status; label: string }> = {
  LEVE: { status: 'warning', label: 'Leve' },
  MODERADA: { status: 'warning', label: 'Moderada' },
  ALTA: { status: 'critical', label: 'Alta' },
  CERRADO: { status: 'critical', label: 'Cerrado' },
};

/** Detalle de una ruta por calles: tiempos con tráfico, peajes, semáforos e indicaciones. */
export function RoadRouteDetails({
  route,
  roadside,
  roadsideError,
  destination,
}: {
  route: RoadRoute;
  roadside: RoadsideFeatures | null;
  roadsideError: string | null;
  destination: LatLng;
}) {
  const links = navigationLinks(destination);
  const closed = route.traffic.some((t) => t.severity === 'CERRADO');
  const trafficStatus: Status = closed
    ? 'critical'
    : route.trafficDelayMin >= 5
      ? 'warning'
      : 'good';

  return (
    <div className="grid grid-cols-1 gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <Fact label="Distancia" value={formatKm(route.distanceKm)} />
        <Fact
          label="Tiempo con tráfico"
          value={formatDuration(route.durationMin)}
          hint={
            route.durationNoTrafficMin !== null
              ? `Sin tráfico: ${formatDuration(route.durationNoTrafficMin)}`
              : undefined
          }
        />
        {route.arrivalAt && (
          <Fact label="Llegada si sale ahora" value={formatClock(route.arrivalAt)} />
        )}
        <Fact
          label="Con peaje"
          value={route.tollKm > 0 ? formatKm(route.tollKm) : 'Sin peajes'}
          hint={
            roadside && roadside.tollBooths.length > 0
              ? `${roadside.tollBooths.length} ${roadside.tollBooths.length === 1 ? 'plaza' : 'plazas'}`
              : undefined
          }
        />
      </dl>

      <StatusBanner
        status={trafficStatus}
        title={
          closed
            ? 'Hay un cierre en el camino'
            : route.trafficDelayMin > 0
              ? `El tráfico suma ${formatDuration(route.trafficDelayMin)}`
              : 'Tránsito fluido en todo el recorrido'
        }
      >
        {route.traffic.length > 0 ? (
          <ul className="grid gap-1">
            {route.traffic.map((span, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2">
                <StatusLabel status={SEVERITY[span.severity].status}>
                  {span.category} · {SEVERITY[span.severity].label}
                </StatusLabel>
                <span className="tabular-nums">
                  {span.delayMin > 0 && `+${span.delayMin} min`}
                  {span.speedKmh !== null && ` · ${span.speedKmh} km/h`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          'Sin congestión, obras ni cierres informados por TomTom.'
        )}
      </StatusBanner>

      <div className="grid gap-1">
        <p className="font-medium">Peajes y semáforos</p>
        <p className="text-muted-foreground">
          {route.tollKm > 0
            ? `${formatKm(route.tollKm)} por vías con peaje (resaltadas en el mapa).`
            : 'La ruta no pasa por vías con peaje.'}{' '}
          {roadside &&
            roadside.tollBooths.length > 0 &&
            `Plazas: ${roadside.tollBooths.map((b) => b.name ?? 'sin nombre').join(', ')}.`}
        </p>
        <p className="text-muted-foreground">
          {roadside
            ? `${roadside.trafficSignals.length} ${roadside.trafficSignals.length === 1 ? 'cruce' : 'cruces'} con semáforo en el camino (OpenStreetMap).`
            : roadsideError
              ? roadsideError
              : 'Buscando semáforos y plazas de peaje en OpenStreetMap…'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <LinkButton href={links.waze} target="_blank" rel="noreferrer">
          <Navigation /> Navegar con Waze
        </LinkButton>
        <LinkButton href={links.googleMaps} target="_blank" rel="noreferrer" variant="outline">
          <ExternalLink /> Google Maps
        </LinkButton>
      </div>

      {route.instructions.length > 0 && (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer font-medium">
            Indicaciones calle por calle ({route.instructions.length})
          </summary>
          <ol className="mt-2 grid gap-1.5">
            {route.instructions.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                  {formatKm(step.offsetKm)}
                </span>
                <span className="min-w-0">{step.message}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
