import {
  ORDER_COLUMNS,
  buildOrderImport,
  parseOrderSheet,
  type OrderImportPreview,
  type SiteDraft,
} from '@core/modules/master-data/domain/import-orders';
import type { MasterDataSnapshot } from '@core/modules/master-data/domain/master-data';
import { MapPinned, Upload } from 'lucide-react';
import { useState } from 'react';
import { LocationPicker } from '@/components/map/LocationPicker';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { geocodeAll, type GeocodeResult } from '@/lib/geocoding';
import { downloadTemplate, readTable } from '@/lib/spreadsheet-file';
import type { LatLng, MasterDataView } from '@/types/api';
import { IssueList, MissingColumns, SheetPicker } from './import-ui';
import { serverIssues } from './server-issues';

function snapshotOf(view: MasterDataView): MasterDataSnapshot {
  return {
    version: 1,
    depot: view.depot,
    vehicles: view.vehicles,
    products: view.products,
    sites: view.sites,
    orders: view.orders,
  };
}

/**
 * Importar pedidos desde Excel o CSV (una fila por producto). Las obras nuevas se ubican
 * solas por su dirección (TomTom); las que no se encuentran se marcan en el mapa.
 */
export function ImportOrdersCard({
  data,
  onImported,
}: {
  data: MasterDataView;
  onImported: (view: MasterDataView) => void;
}) {
  const [preview, setPreview] = useState<OrderImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, GeocodeResult>>({});
  const [manual, setManual] = useState<Record<string, LatLng>>({});
  const [searching, setSearching] = useState<{ done: number; total: number } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  async function load(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setFound({});
    setManual({});
    setPicking(null);
    try {
      const next = parseOrderSheet(await readTable(file), snapshotOf(data));
      setPreview(next);
      setFileName(file.name);
      const queries = next.sites
        .filter((s) => s.action === 'NUEVA' && !s.location && s.address)
        .map((s) => ({ key: s.key, query: `${s.address}, ${s.commune}, Chile` }));
      if (queries.length > 0) {
        setSearching({ done: 0, total: queries.length });
        const results = await geocodeAll(queries, (n) =>
          setSearching({ done: n, total: queries.length }),
        );
        const located: Record<string, GeocodeResult> = {};
        for (const [key, result] of results) if (result) located[key] = result;
        setFound(located);
      }
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    } finally {
      setSearching(null);
      setBusy(false);
    }
  }

  const locations: Record<string, LatLng> = {
    ...Object.fromEntries(Object.entries(found).map(([k, r]) => [k, r.location])),
    ...manual,
  };
  const ready = preview ? buildOrderImport(preview, locations) : null;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importOrders({ sites: ready.sites, orders: ready.orders });
      onImported(result.view);
      setDone(
        `Se importaron ${result.created + result.updated} pedidos (${result.created} nuevos, ${result.updated} reemplazados) y ${result.sitesCreated} obras nuevas.`,
      );
      setPreview(null);
    } catch (e) {
      const details = e instanceof ApiError ? serverIssues(e.body.details) : [];
      setError([errorMessage(e), ...details.slice(0, 5)].join(' · '));
    } finally {
      setBusy(false);
    }
  }

  const sitesToShow = preview?.sites.filter((s) => s.action !== 'EXISTENTE') ?? [];
  const newOrders = preview?.orders.filter((o) => o.action === 'NUEVO').length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importar pedidos desde Excel</CardTitle>
        <CardDescription>
          Una fila por producto de cada pedido (N° de pedido, cliente, obra, dirección, comuna,
          contacto, fecha, SKU y cantidad). Las obras nuevas se ubican solas en el mapa por su
          dirección. Importe primero los productos.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <SheetPicker
          id="import-orders-file"
          busy={busy}
          onFile={(file) => void load(file)}
          onTemplate={() => downloadTemplate(ORDER_COLUMNS, 'plantilla-pedidos.xlsx')}
        />
        {searching && (
          <p role="status" className="text-muted-foreground">
            Buscando las direcciones en el mapa ({searching.done} de {searching.total})…
          </p>
        )}
        {error && <StatusLabel status="critical">{error}</StatusLabel>}
        {done && <StatusLabel status="good">{done}</StatusLabel>}
        {preview && !searching && ready && (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="font-medium">
              {fileName}: {preview.orders.length} pedidos ({newOrders} nuevos,{' '}
              {preview.orders.length - newOrders} se reemplazan) ·{' '}
              {preview.sites.filter((s) => s.action === 'NUEVA').length} obras nuevas ·{' '}
              {preview.issues.length === 1
                ? '1 fila con error'
                : `${preview.issues.length} filas con error`}
            </p>
            <MissingColumns missing={preview.missingColumns} />
            {sitesToShow.length > 0 && (
              <ul className="grid gap-2">
                {sitesToShow.map((site) => (
                  <SiteRow
                    key={site.key}
                    site={site}
                    found={found[site.key] ?? null}
                    manual={manual[site.key] ?? null}
                    picking={picking === site.key}
                    onPick={() => setPicking(picking === site.key ? null : site.key)}
                    onLocation={(location) => setManual({ ...manual, [site.key]: location })}
                    others={data.sites.map((s) => ({ location: s.location, label: s.name }))}
                  />
                ))}
              </ul>
            )}
            {ready.skipped.length > 0 && (
              <StatusLabel status="warning">
                Esperan que ubique su obra en el mapa: {ready.skipped.join(', ')}.
              </StatusLabel>
            )}
            <IssueList issues={preview.issues} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || ready.orders.length === 0}
                onClick={() => void save()}
              >
                <Upload /> Importar {ready.orders.length}{' '}
                {ready.orders.length === 1 ? 'pedido' : 'pedidos'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SiteRow({
  site,
  found,
  manual,
  picking,
  onPick,
  onLocation,
  others,
}: {
  site: SiteDraft;
  found: GeocodeResult | null;
  manual: LatLng | null;
  picking: boolean;
  onPick: () => void;
  onLocation: (location: LatLng) => void;
  others: { location: LatLng; label: string }[];
}) {
  const location = manual ?? site.location ?? found?.location ?? null;
  const status =
    site.action === 'ACTUALIZA' ? (
      <StatusLabel status="good">Obra registrada: se actualizan dirección y contacto</StatusLabel>
    ) : manual ? (
      <StatusLabel status="good">Marcada en el mapa</StatusLabel>
    ) : site.location ? (
      <StatusLabel status="good">Ubicación de la planilla</StatusLabel>
    ) : found?.precise ? (
      <StatusLabel status="good">Ubicada por su dirección: {found.label}</StatusLabel>
    ) : found ? (
      <StatusLabel status="warning">
        Ubicada sólo por la calle ({found.label}): revise en el mapa
      </StatusLabel>
    ) : (
      <StatusLabel status="critical">
        {site.address ? 'No se encontró la dirección' : 'Sin dirección'}: márquela en el mapa
      </StatusLabel>
    );
  return (
    <li className="grid gap-2 rounded-md border p-2">
      <p className="min-w-0">
        <span className="font-medium">{site.name}</span>
        <span className="text-muted-foreground">
          {' '}
          · {site.commune}
          {site.address && ` · ${site.address}`}
        </span>
      </p>
      {status}
      {site.action === 'NUEVA' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={onPick}
        >
          <MapPinned /> {location ? 'Corregir en el mapa' : 'Marcar en el mapa'}
        </Button>
      )}
      {picking && (
        <LocationPicker
          id={`import-site-${site.id}`}
          value={location}
          onChange={onLocation}
          others={others}
        />
      )}
    </li>
  );
}
