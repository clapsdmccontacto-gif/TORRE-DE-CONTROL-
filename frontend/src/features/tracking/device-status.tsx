import { CirclePause } from 'lucide-react';
import { StatusLabel } from '@/components/status';
import type { DeviceStatus } from '@/types/api';

/** "Detenido" no es una alerta (puede estar descargando): va en tinta neutra. */
export function DeviceStatusLabel({ status }: { status: DeviceStatus }) {
  if (status === 'EN_MOVIMIENTO') return <StatusLabel status="good">En movimiento</StatusLabel>;
  if (status === 'SIN_SENAL') return <StatusLabel status="critical">Sin señal</StatusLabel>;
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <CirclePause className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      Detenido
    </span>
  );
}
