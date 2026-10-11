import { newId } from '@core/common/ids';
import { ClipboardList, LoaderCircle, LogIn, PackageSearch, Truck, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, apiMode, errorMessage } from '@/lib/api';
import type { PickMonitor, PickMonitorItem, PickView } from '@/types/api';
import { DispatchScreen } from './DispatchScreen';
import { PickingScreen } from './PickingScreen';

const OPERATOR_KEY = 'torre-control.operator';
const DEVICE_KEY = 'torre-control.device-id';
const TAB_KEY = 'torre-control.warehouse-tab';

type Tab = 'picking' | 'despacho';

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: se vuelve a pedir la próxima vez.
  }
}

/** Identificador de este equipo (pistola, celular), para saber desde dónde se escaneó. */
function deviceId(): string {
  let id = read(DEVICE_KEY);
  if (!id) {
    id = newId('EQUIPO').slice(0, 20);
    write(DEVICE_KEY, id);
  }
  return id;
}

/**
 * App de bodega para los operarios: su nombre (queda en el equipo), los pedidos por
 * preparar en vivo (quién tiene cada uno) con el picking por escaneo, y el despacho
 * (carga de cada camión).
 */
export function WarehouseApp() {
  const [operator, setOperator] = useState(() => read(OPERATOR_KEY));
  const [draftName, setDraftName] = useState(operator);
  const [monitor, setMonitor] = useState<PickMonitor | null>(null);
  const [offline, setOffline] = useState(false);
  const [current, setCurrent] = useState<PickView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device] = useState(deviceId);
  const [tab, setTab] = useState<Tab>(() =>
    read(TAB_KEY) === 'despacho' ? 'despacho' : 'picking',
  );

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

  async function open(item: PickMonitorItem) {
    setBusy(item.orderId);
    setError(null);
    try {
      setCurrent(await api.claimPick(item.orderId, { operator, device }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!operator) {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="size-5" aria-hidden /> ¿Quién prepara los pedidos?
          </CardTitle>
          <CardDescription>Su nombre queda guardado en este equipo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const name = draftName.trim().replace(/\s+/g, ' ');
              if (name.length < 2) return;
              write(OPERATOR_KEY, name);
              setOperator(name);
            }}
          >
            <Input
              id="operator-name"
              className="h-12 text-base"
              autoComplete="name"
              placeholder="Ej.: Ana Rojas"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <Button className="h-12 text-base" type="submit" disabled={draftName.trim().length < 2}>
              <LogIn /> Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const header = (
    <>
      <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <User className="size-4" aria-hidden /> {operator}
        </span>
        <button
          type="button"
          className="min-h-11 text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            write(OPERATOR_KEY, '');
            setOperator('');
          }}
        >
          Cambiar de operario
        </button>
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
        {(
          [
            ['picking', 'Picking', PackageSearch],
            ['despacho', 'Despacho', Truck],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? 'default' : 'ghost'}
            className="h-11 text-base"
            onClick={() => {
              write(TAB_KEY, key);
              setTab(key);
            }}
          >
            <Icon /> {label}
          </Button>
        ))}
      </div>
    </>
  );

  if (tab === 'despacho') {
    return (
      <div className="mx-auto grid w-full max-w-lg gap-4">
        {header}
        <DispatchScreen operator={operator} device={device} />
      </div>
    );
  }

  if (current) {
    return (
      <div className="mx-auto w-full max-w-lg">
        <PickingScreen
          key={current.orderId}
          initial={current}
          operator={operator}
          device={device}
          onExit={() => setCurrent(null)}
        />
      </div>
    );
  }

  const pending = (monitor?.orders ?? []).filter(
    (o) => o.status === 'PENDIENTE' || o.status === 'EN_PICKING',
  );
  const mine = (o: PickMonitorItem) =>
    o.operator !== null && o.operator.toLowerCase() === operator.toLowerCase();

  return (
    <div className="mx-auto grid w-full max-w-lg gap-4">
      {header}
      {offline && apiMode === 'http' && (
        <StatusBanner status="warning" title="Sin conexión con la nube">
          Reintentando solo. La lista puede no estar al día.
        </StatusBanner>
      )}
      {error && <StatusLabel status="critical">{error}</StatusLabel>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5" aria-hidden /> Pedidos por preparar
          </CardTitle>
          <CardDescription>
            Por fecha de entrega y orden de la ruta. Se actualiza solo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {!monitor && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Cargando pedidos…
            </p>
          )}
          {monitor && pending.length === 0 && (
            <p className="text-muted-foreground">No hay pedidos por preparar.</p>
          )}
          {pending.map((item) => {
            const takenByOther = item.status === 'EN_PICKING' && !mine(item);
            return (
              <div key={item.orderId} className="grid gap-2 rounded-lg border p-3">
                <p className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-medium">
                    {item.orderId} · {item.siteName}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {[
                        item.customerName,
                        item.deliveryDate && `entrega ${item.deliveryDate}`,
                        item.vehiclePlate && `camión ${item.vehiclePlate}`,
                        `${item.lineCount} ${item.lineCount === 1 ? 'producto' : 'productos'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {item.alerts.includes('ATRASADO') && (
                    <StatusLabel status="critical">Atrasado</StatusLabel>
                  )}
                </p>
                {item.status === 'EN_PICKING' && (
                  <Badge
                    variant={takenByOther ? 'secondary' : 'outline'}
                    className="justify-self-start"
                  >
                    {takenByOther ? `Lo prepara ${item.operator}` : 'Tomado por usted'} ·{' '}
                    {Math.round(item.progress.fraction * 100)} %
                  </Badge>
                )}
                <Button
                  className="h-11"
                  variant={takenByOther ? 'outline' : 'default'}
                  disabled={takenByOther || busy !== null}
                  onClick={() => void open(item)}
                >
                  {busy === item.orderId && <LoaderCircle className="animate-spin" />}
                  {takenByOther ? 'Tomado' : mine(item) ? 'Continuar' : 'Tomar pedido'}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
