import {
  ClipboardList,
  HardHat,
  LoaderCircle,
  MapPinned,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LocationPicker } from '@/components/map/LocationPicker';
import { ProductLinesEditor } from '@/components/product-lines';
import { StatusBanner, StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { ORDER_STATUS_LABEL, OUTCOME_STATUS, formatKg } from '@/lib/format';
import { geocodeAll } from '@/lib/geocoding';
import type {
  DeliveryOutcome,
  LatLng,
  MasterDataView,
  OrderTrack,
  SiteInput,
  SkuQuantity,
} from '@/types/api';
import { ImportOrdersCard } from './import/ImportOrdersCard';
import { useMasterData } from './use-master-data';

type Change = (operation: () => Promise<MasterDataView>) => Promise<boolean>;

/** Obras (dónde se entrega) y pedidos (qué se entrega): entrada del optimizador de rutas. */
export function SitesOrdersPage() {
  const { data, error, busy, change, replace } = useMasterData();
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
          <div className="xl:col-span-2">
            <ImportOrdersCard data={data} onImported={replace} />
          </div>
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
  address: null,
  contactName: null,
  contactPhone: null,
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
  const [search, setSearch] = useState<{ busy: boolean; message: string | null; ok: boolean }>({
    busy: false,
    message: null,
    ok: true,
  });
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
    setSearch({ busy: false, message: null, ok: true });
  }

  /** Ubica la obra por su dirección (TomTom); después se puede corregir en el mapa. */
  async function locate() {
    setSearch({ busy: true, message: null, ok: true });
    const query = `${draft.address ?? ''}, ${draft.commune}, Chile`;
    const result = (await geocodeAll([{ key: 'obra', query }], () => undefined)).get('obra');
    if (result) {
      setLocation(result.location);
      setFormKey((k) => k + 1);
      setSearch({
        busy: false,
        ok: result.precise,
        message: result.precise
          ? `Ubicada: ${result.label}. Revise el punto en el mapa.`
          : `Sólo se encontró la calle (${result.label}): mueva el punto a la entrada de la obra.`,
      });
    } else {
      setSearch({
        busy: false,
        ok: false,
        message: 'No se encontró la dirección: marque la obra tocando el mapa.',
      });
    }
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
                <span className="grid min-w-0 gap-0.5">
                  <span>
                    <span className="font-medium">{s.name}</span>{' '}
                    <span className="text-muted-foreground">
                      · {s.commune} · aviso {s.notifyEtaMinutes} min
                      {s.hasUnloadingEquipment && ' · con grúa en obra'}
                    </span>
                  </span>
                  {s.address && <span className="text-muted-foreground">{s.address}</span>}
                  {(s.contactName || s.contactPhone) && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Phone className="size-3.5 shrink-0" aria-hidden />
                      {[s.contactName, s.contactPhone].filter(Boolean).join(' · ')}
                    </span>
                  )}
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
          <label className="grid min-w-0 gap-1.5 sm:col-span-2">
            <span className="font-medium">Dirección (calle y número)</span>
            <span className="flex min-w-0 gap-2">
              <Input
                id="site-address"
                placeholder="Ej.: Av. Alemania 1234"
                value={draft.address ?? ''}
                onChange={(e) => setDraft({ ...draft, address: e.target.value || null })}
              />
              <Button
                type="button"
                variant="outline"
                disabled={search.busy || !draft.address?.trim() || draft.commune.trim().length < 2}
                onClick={() => void locate()}
              >
                {search.busy ? <LoaderCircle className="animate-spin" /> : <Search />} Ubicar
              </Button>
            </span>
          </label>
          {search.message && (
            <div className="sm:col-span-2">
              <StatusLabel status={search.ok ? 'good' : 'warning'}>{search.message}</StatusLabel>
            </div>
          )}
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Contacto en obra (opcional)</span>
            <Input
              id="site-contact"
              placeholder="Quién recibe"
              value={draft.contactName ?? ''}
              onChange={(e) => setDraft({ ...draft, contactName: e.target.value || null })}
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="font-medium">Teléfono del contacto (opcional)</span>
            <Input
              id="site-phone"
              type="tel"
              inputMode="tel"
              placeholder="+56 9 1234 5678"
              value={draft.contactPhone ?? ''}
              onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value || null })}
            />
          </label>
          <div className="sm:col-span-2">
            <p className="mb-1.5 flex items-center gap-1 font-medium">
              <MapPinned className="size-4" aria-hidden /> Punto de entrega en el mapa
            </p>
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
  const tracks = useOrderTracks(data);
  const [id, setId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [lines, setLines] = useState<SkuQuantity[]>([]);
  const [details, setDetails] = useState({ customerName: '', deliveryDate: '', notes: '' });
  const selectedSite = siteId || data.sites[0]?.id || '';
  const ready = data.sites.length > 0 && products.length > 0;

  function reset() {
    setId('');
    setLines([]);
    setDetails({ customerName: '', deliveryDate: '', notes: '' });
  }

  async function save() {
    const order = {
      id,
      siteId: selectedSite,
      lines,
      customerName: details.customerName || null,
      deliveryDate: details.deliveryDate || null,
      notes: details.notes || null,
    };
    if (await change(() => api.saveOrder(order))) reset();
  }

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-5" aria-hidden /> Pedidos
        </CardTitle>
        <CardDescription>
          Nota de venta, obra y productos. Los pendientes se planifican en «Optimizar rutas».
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
                  {(o.customerName || o.deliveryDate) && (
                    <span className="text-muted-foreground">
                      {[o.customerName, o.deliveryDate && `Entrega ${formatDate(o.deliveryDate)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  {o.notes && <span className="text-muted-foreground italic">{o.notes}</span>}
                  <span className="text-muted-foreground">
                    {o.lines
                      .map(
                        (l) =>
                          `${l.quantity} × ${products.find((p) => p.sku === l.sku)?.name ?? l.sku}`,
                      )
                      .join(' · ')}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{formatKg(o.weightKg)}</Badge>
                    <OrderStatusLabel track={tracks.get(o.id) ?? null} />
                  </span>
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
                      setDetails({
                        customerName: o.customerName ?? '',
                        deliveryDate: o.deliveryDate ?? '',
                        notes: o.notes ?? '',
                      });
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5">
                <span className="font-medium">Cliente (opcional)</span>
                <Input
                  id="order-customer"
                  value={details.customerName}
                  onChange={(e) => setDetails({ ...details, customerName: e.target.value })}
                />
              </label>
              <label className="grid min-w-0 gap-1.5">
                <span className="font-medium">Fecha de entrega (opcional)</span>
                <Input
                  id="order-date"
                  type="date"
                  value={details.deliveryDate}
                  onChange={(e) => setDetails({ ...details, deliveryDate: e.target.value })}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 sm:col-span-2">
                <span className="font-medium">Notas para la entrega (opcional)</span>
                <Input
                  id="order-notes"
                  placeholder="Ej.: entrar por el portón de calle Colón"
                  value={details.notes}
                  onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                />
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

/** «2026-10-15» → «15-10-2026». */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

/** Estado de cada pedido (en ruta, entregado…); se refresca junto con los datos. */
function useOrderTracks(data: MasterDataView): Map<string, OrderTrack> {
  const [tracks, setTracks] = useState<Map<string, OrderTrack>>(new Map());
  useEffect(() => {
    let active = true;
    api.orderTracks().then(
      (list) => active && setTracks(new Map(list.map((t) => [t.orderId, t]))),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [data]);
  return tracks;
}

function OrderStatusLabel({ track }: { track: OrderTrack | null }) {
  const status = track?.status ?? 'PENDIENTE';
  if (status in OUTCOME_STATUS) {
    return (
      <span className="flex items-center gap-2">
        <StatusLabel status={OUTCOME_STATUS[status as DeliveryOutcome]}>
          {ORDER_STATUS_LABEL[status]}
        </StatusLabel>
        <a
          className="text-xs font-medium underline"
          href={`#entregas?pedido=${encodeURIComponent(track!.orderId)}`}
        >
          Ver comprobante
        </a>
      </span>
    );
  }
  return (
    <Badge variant="secondary">
      {ORDER_STATUS_LABEL[status]}
      {track?.vehiclePlate && status !== 'PENDIENTE' ? ` · ${track.vehiclePlate}` : ''}
    </Badge>
  );
}
