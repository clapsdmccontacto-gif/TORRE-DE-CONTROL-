import {
  PRODUCT_COLUMNS,
  parseProductSheet,
  type ProductImportPreview,
} from '@core/modules/master-data/domain/import-products';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { downloadTemplate, readTable } from '@/lib/spreadsheet-file';
import type { MasterDataView } from '@/types/api';
import { IssueList, MissingColumns, SheetPicker } from './import-ui';
import { serverIssues } from './server-issues';

const PREVIEW_ROWS = 50;

/** Importar productos desde Excel o CSV: vista previa con errores por fila antes de guardar. */
export function ImportProductsCard({
  data,
  onImported,
}: {
  data: MasterDataView;
  onImported: (view: MasterDataView) => void;
}) {
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setPreview(parseProductSheet(await readTable(file), data.products));
      setFileName(file.name);
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importProducts(preview.items.map((i) => i.product));
      onImported(result.view);
      setDone(
        `Se importaron ${result.created + result.updated} productos (${result.created} nuevos, ${result.updated} actualizados).`,
      );
      setPreview(null);
    } catch (e) {
      const details = e instanceof ApiError ? serverIssues(e.body.details) : [];
      setError([errorMessage(e), ...details.slice(0, 5)].join(' · '));
    } finally {
      setBusy(false);
    }
  }

  const created = preview?.items.filter((i) => i.action === 'NUEVO').length ?? 0;
  const updated = (preview?.items.length ?? 0) - created;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importar desde Excel</CardTitle>
        <CardDescription>
          Cargue muchos productos de una vez. Si el SKU ya existe, se actualiza. Antes de guardar
          verá qué se agrega y qué filas tienen errores.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <SheetPicker
          id="import-products-file"
          busy={busy}
          onFile={(file) => void load(file)}
          onTemplate={() => downloadTemplate(PRODUCT_COLUMNS, 'plantilla-productos.xlsx')}
        />
        {error && <StatusLabel status="critical">{error}</StatusLabel>}
        {done && <StatusLabel status="good">{done}</StatusLabel>}
        {preview && (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="font-medium">
              {fileName}: {created} nuevos · {updated} se actualizan · {preview.issues.length} con
              error
            </p>
            <MissingColumns missing={preview.missingColumns} />
            {preview.items.length > 0 && (
              <ul className="grid max-h-64 gap-1 overflow-y-auto">
                {preview.items.slice(0, PREVIEW_ROWS).map((item) => (
                  <li key={item.product.sku} className="flex min-w-0 items-center gap-2">
                    <Badge variant={item.action === 'NUEVO' ? 'secondary' : 'outline'}>
                      {item.action === 'NUEVO' ? 'Nuevo' : 'Actualiza'}
                    </Badge>
                    <span className="min-w-0 truncate">
                      {item.product.sku} · {item.product.name}
                    </span>
                  </li>
                ))}
                {preview.items.length > PREVIEW_ROWS && (
                  <li className="text-muted-foreground">
                    y {preview.items.length - PREVIEW_ROWS} más…
                  </li>
                )}
              </ul>
            )}
            <IssueList issues={preview.issues} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || preview.items.length === 0}
                onClick={() => void save()}
              >
                <Upload /> Importar {preview.items.length}{' '}
                {preview.items.length === 1 ? 'producto' : 'productos'}
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
