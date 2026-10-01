import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Status = 'good' | 'warning' | 'critical';

const STATUS_ICON = { good: CircleCheck, warning: TriangleAlert, critical: OctagonX };
const STATUS_TEXT = {
  good: 'text-status-good',
  warning: 'text-status-warning',
  critical: 'text-status-critical',
};
const STATUS_BORDER = {
  good: 'border-l-status-good',
  warning: 'border-l-status-warning',
  critical: 'border-l-status-critical',
};

/** El color de estado nunca va solo: siempre ícono + texto en tinta normal. */
export function StatusLabel({ status, children }: { status: Status; children: ReactNode }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <Icon className={cn('size-4 shrink-0', STATUS_TEXT[status])} aria-hidden />
      {children}
    </span>
  );
}

export function StatusBanner({
  status,
  title,
  children,
}: {
  status: Status;
  title: string;
  children?: ReactNode;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <div
      className={cn('flex gap-3 rounded-lg border border-l-4 bg-card p-4', STATUS_BORDER[status])}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', STATUS_TEXT[status])} aria-hidden />
      <div className="grid gap-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/**
 * Medidor de uso (1 = capacidad). Pista y relleno de la misma rampa neutral; el color
 * de estado aparece sólo al acercarse o pasar el límite, junto con el texto.
 */
export function Meter({
  label,
  value,
  detail,
  warnAt = 0.9,
}: {
  label: string;
  value: number;
  detail?: string;
  warnAt?: number;
}) {
  const state = value > 1 ? 'critical' : value >= warnAt ? 'warning' : null;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="inline-flex flex-wrap items-center justify-end gap-x-1 text-right tabular-nums">
          {state && (
            <StatusLabel status={state}>
              {state === 'critical' ? 'Excede' : 'Al límite'}
            </StatusLabel>
          )}
          <span className="font-medium">{formatPct(value)}</span>
          {detail && <span className="text-muted-foreground">· {detail}</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="h-2 overflow-hidden rounded-full bg-meter-track"
      >
        <div
          className={cn(
            'h-full rounded-full',
            state === 'critical'
              ? 'bg-status-critical'
              : state === 'warning'
                ? 'bg-status-warning'
                : 'bg-meter-fill',
          )}
          style={{ width: `${Math.min(value, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
