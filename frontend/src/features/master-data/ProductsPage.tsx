import { HANDLING_CLASSES } from '@core/modules/catalog/domain/product';
import { Barcode, MapPin, Package, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { HANDLING_CLASS_LABEL, formatKg } from '@/lib/format';
import type { HandlingClass, MasterDataView, Product, ProductBarcode } from '@/types/api';
import { ImportProductsCard } from './import/ImportProductsCard';
import { useMasterData } from './use-master-data';

type ProductDraft = Omit<Product, 'unitVolumeM3'>;

const EMPTY: ProductDraft = {
  sku: '',
  name: '',
  brand: null,
  handlingClass: 'GENERAL',
  unitWeightKg: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  isFragile: false,
  requiresMechanicalUnload: false,
  barcodes: [],
  binLocation: null,
};

const HANDLING_HINT: Record<HandlingClass, string> = {
  GRANEL_PESADO: 'sacos, áridos, maxisacos',
  LARGO: 'fierros, perfiles, planchas',
  GENERAL: 'ferretería general',
  FRAGIL: 'cerámica, loza, vidrio',
  HERRAMIENTA: 'herramientas eléctricas',
  QUIMICO: 'diluyentes, solventes',
};

/** Catálogo con los datos logísticos que usan picking, cubicaje y pedidos. */
export function ProductsPage() {
  const { data, error, busy, change, replace } = useMasterData();
  const [draft, setDraft] = useState<ProductDraft>(EMPTY);
  const editing = data?.products.some((p) => p.sku === draft.sku.trim().toUpperCase()) ?? false;

  async function save() {
    const barcodes = (draft.barcodes ?? []).filter((b) => b.code.trim() !== '');
    if (await change(() => api.saveProduct({ ...draft, barcodes }))) setDraft(EMPTY);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="grid grid-cols-1 content-start gap-4">
        {error && (
          <StatusBanner status="critical" title="No se pudo guardar">
            {error}
          </StatusBanner>
        )}
        {data && <ImportProductsCard data={data} onImported={replace} />}
        <ProductList data={data} busy={busy} onEdit={setDraft} change={change} />
      </div>

      <Card className="content-start xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle>
            {editing ? `Editar ${draft.sku.toUpperCase()}` : 'Agregar producto'}
          </CardTitle>
          <CardDescription>
            Peso y medidas de la unidad que se manipula (saco, caja, barra).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-2 gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="SKU" className="col-span-2 sm:col-span-1">
              <Input
                id="product-sku"
                value={draft.sku}
                onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Marca (opcional)" className="col-span-2 sm:col-span-1">
              <Input
                id="product-brand"
                value={draft.brand ?? ''}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value || null })}
              />
            </Field>
            <Field label="Nombre" className="col-span-2">
              <Input
                id="product-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Clase de manejo" className="col-span-2">
              <NativeSelect
                id="product-class"
                value={draft.handlingClass}
                onChange={(e) =>
                  setDraft({ ...draft, handlingClass: e.target.value as HandlingClass })
                }
              >
                {HANDLING_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {HANDLING_CLASS_LABEL[c]} ({HANDLING_HINT[c]})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <NumberField
              label="Peso por unidad (kg)"
              id="product-weight"
              value={draft.unitWeightKg}
              onChange={(unitWeightKg) => setDraft({ ...draft, unitWeightKg })}
            />
            <NumberField
              label="Largo (cm)"
              id="product-length"
              value={draft.lengthCm}
              onChange={(lengthCm) => setDraft({ ...draft, lengthCm })}
            />
            <NumberField
              label="Ancho (cm)"
              id="product-width"
              value={draft.widthCm}
              onChange={(widthCm) => setDraft({ ...draft, widthCm })}
            />
            <NumberField
              label="Alto (cm)"
              id="product-height"
              value={draft.heightCm}
              onChange={(heightCm) => setDraft({ ...draft, heightCm })}
            />
            <Field label="Ubicación en bodega (opcional)" className="col-span-2">
              <Input
                id="product-bin"
                value={draft.binLocation ?? ''}
                placeholder="Ej.: P3-R2-N1 (pasillo-rack-nivel)"
                onChange={(e) => setDraft({ ...draft, binLocation: e.target.value || null })}
              />
            </Field>
            <BarcodeEditor
              value={draft.barcodes ?? []}
              onChange={(barcodes) => setDraft({ ...draft, barcodes })}
            />
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-current"
                checked={draft.isFragile}
                onChange={(e) => setDraft({ ...draft, isFragile: e.target.checked })}
              />
              Frágil
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-current"
                checked={draft.requiresMechanicalUnload}
                onChange={(e) => setDraft({ ...draft, requiresMechanicalUnload: e.target.checked })}
              />
              Requiere descarga con grúa o pluma
            </label>
            <div className="col-span-2 flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !draft.sku.trim() || !draft.name.trim()}>
                {editing ? <Save /> : <Plus />} {editing ? 'Guardar cambios' : 'Agregar producto'}
              </Button>
              {draft !== EMPTY && (
                <Button variant="ghost" onClick={() => setDraft(EMPTY)}>
                  <X /> Limpiar
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductList({
  data,
  busy,
  onEdit,
  change,
}: {
  data: MasterDataView | null;
  busy: boolean;
  onEdit: (product: ProductDraft) => void;
  change: (operation: () => Promise<MasterDataView>) => Promise<boolean>;
}) {
  if (!data) return null;
  if (data.products.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <Package className="size-5 shrink-0" aria-hidden />
          Todavía no hay productos. Agregue los que despacha con su peso y medidas.
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2">
      {data.products.map((p) => (
        <li
          key={p.sku}
          className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
        >
          <span className="grid min-w-0 gap-1">
            <span className="font-medium">
              {p.name} <span className="font-normal text-muted-foreground">· {p.sku}</span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatKg(p.unitWeightKg)} · {p.lengthCm} × {p.widthCm} × {p.heightCm} cm
              {p.brand && ` · ${p.brand}`}
            </span>
            <span className="flex flex-wrap gap-1">
              <Badge variant="outline">{HANDLING_CLASS_LABEL[p.handlingClass]}</Badge>
              {p.isFragile && <Badge variant="secondary">Frágil</Badge>}
              {p.requiresMechanicalUnload && <Badge variant="secondary">Descarga con grúa</Badge>}
              {p.binLocation && (
                <Badge variant="outline">
                  <MapPin aria-hidden /> {p.binLocation}
                </Badge>
              )}
            </span>
            {(p.barcodes ?? []).length > 0 && (
              <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                <Barcode className="size-4 shrink-0" aria-label="Códigos de barra" />
                <span className="min-w-0 truncate tabular-nums">
                  {(p.barcodes ?? [])
                    .map((b) =>
                      b.unitsPerScan > 1 ? `${b.code} (caja de ${b.unitsPerScan})` : b.code,
                    )
                    .join(' · ')}
                </span>
              </span>
            )}
          </span>
          <span className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Editar ${p.sku}`}
              onClick={() => onEdit({ ...p })}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${p.sku}`}
              disabled={busy}
              onClick={() =>
                window.confirm(`¿Quitar ${p.name}?`) && void change(() => api.removeProduct(p.sku))
              }
            >
              <Trash2 />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 ${className ?? ''}`}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        id={id}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        className="tabular-nums"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/** Códigos de barra del producto: el de la unidad y, si se escanean cajas, el de la caja. */
function BarcodeEditor({
  value,
  onChange,
}: {
  value: ProductBarcode[];
  onChange: (barcodes: ProductBarcode[]) => void;
}) {
  const update = (index: number, patch: Partial<ProductBarcode>) =>
    onChange(value.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  return (
    <fieldset className="col-span-2 grid min-w-0 gap-2">
      <legend className="mb-1.5 font-medium">Códigos de barra (opcional)</legend>
      {value.map((barcode, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
          <label className="grid min-w-0 gap-1">
            <span className="text-xs text-muted-foreground">Código</span>
            <Input
              id={`product-barcode-${index}`}
              value={barcode.code}
              inputMode="text"
              autoComplete="off"
              placeholder="EAN o etiqueta"
              onChange={(e) => update(index, { code: e.target.value })}
            />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-xs text-muted-foreground">Unidades</span>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="tabular-nums"
              value={barcode.unitsPerScan || ''}
              onChange={(e) => update(index, { unitsPerScan: Number(e.target.value) })}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Quitar código"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...value, { code: '', unitsPerScan: 1 }])}
      >
        <Barcode /> Agregar código
      </Button>
      <p className="text-xs text-muted-foreground">
        «Unidades»: cuántas suma cada lectura (1 para la unidad; p. ej. 40 para el código de la
        caja). Puede escanear el código con una pistola en el campo.
      </p>
    </fieldset>
  );
}
