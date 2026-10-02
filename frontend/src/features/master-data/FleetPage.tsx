import { Copy, Plus, Save, Trash2, Truck, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { LocationPicker } from '@/components/map/LocationPicker';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatKg } from '@/lib/format';
import type { LatLng, MasterDataView } from '@/types/api';
import { useMasterData } from './use-master-data';

/** Bodega de salida y camiones de la empresa (los conductores eligen de esta lista). */
export function FleetPage() {
  const { data, error, busy, change } = useMasterData();
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {error && (
        <div className="xl:col-span-2">
          <StatusBanner status="critical" title="No se pudo guardar">
            {error}
          </StatusBanner>
        </div>
      )}
      {data && (
        <>
          <VehiclesCard data={data} busy={busy} change={change} />
          <DepotCard
            key={data.depot ? 'con-bodega' : 'sin-bodega'}
            data={data}
            busy={busy}
            change={change}
          />
        </>
      )}
    </div>
  );
}

type Change = (operation: () => Promise<MasterDataView>) => Promise<boolean>;

function VehiclesCard({
  data,
  busy,
  change,
}: {
  data: MasterDataView;
  busy: boolean;
  change: Change;
}) {
  const [plate, setPlate] = useState('');
  const [vehicleCode, setVehicleCode] = useState(
    data.vehicleTypes[1]?.code ?? data.vehicleTypes[0].code,
  );
  const [copied, setCopied] = useState(false);
  const driverLink = `${window.location.href.split('#')[0]}#conductor`;

  async function add() {
    if (await change(() => api.saveVehicle({ plate, vehicleCode }))) setPlate('');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(driverLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-5" aria-hidden /> Camiones
        </CardTitle>
        <CardDescription>
          El conductor elige su camión de esta lista al iniciar la ruta en «Modo conductor».
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 text-sm">
        {data.vehicles.length === 0 ? (
          <p className="text-muted-foreground">
            Todavía no hay camiones. Agregue el primero abajo.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {data.vehicles.map((v) => {
              const type = data.vehicleTypes.find((t) => t.code === v.vehicleCode);
              return (
                <li
                  key={v.plate}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="min-w-0">
                    <span className="font-semibold tabular-nums">{v.plate}</span>{' '}
                    <span className="text-muted-foreground">
                      · {v.vehicleName}
                      {type && ` · hasta ${formatKg(type.maxPayloadKg)}`}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar ${v.plate}`}
                    disabled={busy}
                    onClick={() =>
                      window.confirm(`¿Quitar el camión ${v.plate}?`) &&
                      void change(() => api.removeVehicle(v.plate))
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="grid grid-cols-1 gap-3 rounded-lg border border-dashed p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Patente</span>
            <Input
              id="vehicle-plate"
              placeholder="Ej.: HJKL34"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Tipo</span>
            <NativeSelect
              id="vehicle-type"
              value={vehicleCode}
              onChange={(e) => setVehicleCode(e.target.value)}
            >
              {data.vehicleTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button type="submit" disabled={busy || plate.trim().length < 4}>
            <Plus /> Agregar
          </Button>
        </form>

        <div className="grid gap-2 rounded-lg bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Enlace para los teléfonos de los conductores (ábranlo, escriban su nombre y elijan el
            camión):
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{driverLink}</code>
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              <Copy /> {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DepotCard({
  data,
  busy,
  change,
}: {
  data: MasterDataView;
  busy: boolean;
  change: Change;
}) {
  const [name, setName] = useState(data.depot?.name ?? 'Bodega Los Ángeles');
  const [location, setLocation] = useState<LatLng | null>(data.depot?.location ?? null);
  const dirty =
    location !== null &&
    (name.trim() !== data.depot?.name ||
      location.lat !== data.depot?.location.lat ||
      location.lng !== data.depot?.location.lng);

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Warehouse className="size-5" aria-hidden /> Bodega de salida
        </CardTitle>
        <CardDescription>
          Desde aquí salen y aquí vuelven las rutas que arma el optimizador.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm">
        {data.depot ? (
          <StatusLabel status="good">{data.depot.name} marcada en el mapa</StatusLabel>
        ) : (
          <StatusLabel status="warning">Falta marcar la bodega en el mapa</StatusLabel>
        )}
        <label className="grid min-w-0 gap-1.5">
          <span className="font-medium">Nombre</span>
          <Input id="depot-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <LocationPicker id="depot-location" value={location} onChange={setLocation} />
        <Button
          className="justify-self-start"
          disabled={busy || !dirty}
          onClick={() => location && void change(() => api.saveDepot({ name, location }))}
        >
          <Save /> Guardar bodega
        </Button>
      </CardContent>
    </Card>
  );
}
