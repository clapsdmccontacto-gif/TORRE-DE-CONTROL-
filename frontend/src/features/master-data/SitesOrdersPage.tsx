import { ClipboardList, HardHat, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LocationPicker } from '@/components/map/LocationPicker';
import { ProductLinesEditor } from '@/components/product-lines';
import { StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatKg } from '@/lib/format';
import type { LatLng, MasterDataView, SiteInput, SkuQuantity } from '@/types/api';
import { useMasterData } from './use-master-data';

type Change = (operation: () => Promise<MasterDataView>) => Promise<boolean>;

/** Obras (dónde se entrega) y pedidos (qué se entrega): entrada del optimizador de rutas. */
export function SitesOrdersPage() {
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
          <SitesCard data={data} busy={busy} change={change} />
          <OrdersCard data={data} busy={busy} change={change} />
        </>
      )}
    </div>
  );
}

const NEW_SITE: SiteInput = {
  name: '',
  commune: '',
  location: { lat: 0, lng: 0 },
  hasUnloadingEquipment: false,
  notifyEtaMinutes: 15,
};

function SitesCard({
  data,
  busy,
  change,
}: {
  data: MasterDataView;
  busy: boolean;
  change: Change;
}) {
  const [draft, setDraft] = useState<SiteInput>(NEW_SITE);
  const [location, setLocation] = useState<LatLng | null>(null);
  // Cambia al limpiar o editar: el selector de ubicación parte de cero (sin texto pegado).
  const [formKey, setFormKey] = useState(0);
  const others = useMemo(
    () => [
      ...(data.depot ? [{ location: data.depot.location, label: data.depot.name }] : []),
      ...data.sites
        .filter((s) => s.id !== draft.id)
        .map((s) => ({ location: s.location, label: s.name })),
    ],
    [data, draft.id],
  );

  function reset() {
    setDraft(NEW_SITE);
    setLocation(null);
    setFormKey((k) => k + 1);
  }

  async function save() {
    if (location && (await change(() => api.saveSite({ ...draft, location })))) reset();
  }

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardHat className="size-5" aria-hidden /> Obras
        </CardTitle>
        <CardDescription>
          Dónde se entrega: el camión avisa al capataz antes de llegar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 text-sm">
        {data.sites.length === 0 ? (
          <p className="text-muted-foreground">Todavía no hay obras.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {data.sites.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>{' '}
                  <span className="text-muted-foreground">
                    · {s.commune} · aviso {s.notifyEtaMinutes} min
                    {s.hasUnloadingEquipment && ' · con grúa en obra'}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${s.name}`}
                    onClick={() => {
                      setDraft({ ...s });
                      setLocation(s.location);
                      setFormKey((k) => k + 1);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar ${s.name}`}
                    disabled={busy}
                    onClick={() =>
                      window.confirm(`¿Quitar la obra ${s.name}?`) &&
                      void change(() => api.removeSite(s.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="grid grid-cols-1 gap-3 rounded-lg border border-dashed p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="font-medium sm:col-span-2">
            {draft.id ? `Editar ${draft.name}` : 'Nueva obra'}
          </p>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Nombre</span>
            <Input
              id="site-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Comuna</span>
            <Input
              id="site-commune"
              value={draft.commune}
              onChange={(e) => setDraft({ ...draft, commune: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2">
            <LocationPicker
              key={formKey}
              id="site-location"
              value={location}
              onChange={setLocation}
              others={others}
            />
          </div>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Avisar al capataz (min antes)</span>
            <Input
              id="site-notify"
              type="number"
              min={1}
              max={120}
              value={draft.notifyEtaMinutes}
              onChange={(e) => setDraft({ ...draft, notifyEtaMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="flex items-center gap-2 sm:self-end sm:pb-2">
            <input
              type="checkbox"
              className="size-4 accent-current"
              checked={draft.hasUnloadingEquipment}
              onChange={(e) => setDraft({ ...draft, hasUnloadingEquipment: e.target.checked })}
            />
            La obra tiene grúa para descargar
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="submit"
              disabled={
                busy || !location || draft.name.trim().length < 2 || draft.commune.trim().length < 2
              }
            >
              {draft.id ? <Save /> : <Plus />} {draft.id ? 'Guardar obra' : 'Agregar obra'}
            </Button>
            {(draft.id || location) && (
              <Button variant="ghost" onClick={reset}>
                <X /> Cancelar
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function OrdersCard({
  data,
  busy,
  change,
}: {
  data: MasterDataView;
  busy: boolean;
  change: Change;
}) {
  const products = data.products;
  const [id, setId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [lines, setLines] = useState<SkuQuantity[]>([]);
  const selectedSite = siteId || data.sites[0]?.id || '';
  const ready = data.sites.length > 0 && products.length > 0;

  function reset() {
    setId('');
    setLines([]);
  }

  async function save() {
    if (await change(() => api.saveOrder({ id, siteId: selectedSite, lines }))) reset();
  }

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-5" aria-hidden /> Pedidos por despachar
        </CardTitle>
        <CardDescription>
          Nota de venta, obra y productos. Se planifican en «Optimizar rutas».
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 text-sm">
        {data.orders.length === 0 ? (
          <p className="text-muted-foreground">No hay pedidos por despachar.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {data.orders.map((o) => (
              <li
                key={o.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="font-medium">
                    {o.id} <span className="font-normal text-muted-foreground">· {o.siteName}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {o.lines
                      .map(
                        (l) =>
                          `${l.quantity} × ${products.find((p) => p.sku === l.sku)?.name ?? l.sku}`,
                      )
                      .join(' · ')}
                  </span>
                  <Badge variant="outline">{formatKg(o.weightKg)}</Badge>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${o.id}`}
                    onClick={() => {
                      setId(o.id);
                      setSiteId(o.siteId);
                      setLines(o.lines.map((l) => ({ ...l })));
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar ${o.id}`}
                    disabled={busy}
                    onClick={() =>
                      window.confirm(`¿Quitar el pedido ${o.id}?`) &&
                      void change(() => api.removeOrder(o.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {!ready ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">
            Para crear pedidos primero agregue {data.sites.length === 0 && 'al menos una obra'}
            {data.sites.length === 0 && products.length === 0 && ' y '}
            {products.length === 0 && (
              <>
                productos en{' '}
                <a className="font-medium text-foreground underline" href="#productos">
                  Productos
                </a>
              </>
            )}
            .
          </p>
        ) : (
          <form
            className="grid grid-cols-1 gap-3 rounded-lg border border-dashed p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5">
                <span className="font-medium">Nota de venta</span>
                <Input
                  id="order-id"
                  placeholder="Ej.: NV-120455"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1.5">
                <span className="font-medium">Obra</span>
                <NativeSelect
                  id="order-site"
                  value={selectedSite}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  {data.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.commune}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <ProductLinesEditor
              products={products}
              lines={lines}
              onChange={setLines}
              emptyText="Agregue los productos del pedido."
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !id.trim() || lines.length === 0}>
                <Save /> Guardar pedido
              </Button>
              {(id || lines.length > 0) && (
                <Button variant="ghost" onClick={reset}>
                  <X /> Cancelar
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
