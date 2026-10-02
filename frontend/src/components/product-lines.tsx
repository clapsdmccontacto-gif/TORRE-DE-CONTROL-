import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { HANDLING_CLASS_LABEL } from '@/lib/format';
import type { Product, SkuQuantity } from '@/types/api';

/** Lo mínimo que necesita el selector (sirve con el catálogo o con los datos maestros). */
type ProductOption = Pick<Product, 'sku' | 'name' | 'handlingClass'>;

export function ProductLineInput({
  products,
  value,
  onChange,
  onRemove,
}: {
  products: readonly ProductOption[];
  value: SkuQuantity;
  onChange: (value: SkuQuantity) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex gap-2">
      <NativeSelect
        aria-label="Producto"
        className="min-w-0 flex-1"
        value={value.sku}
        onChange={(e) => onChange({ ...value, sku: e.target.value })}
      >
        {products.map((p) => (
          <option key={p.sku} value={p.sku}>
            {p.name} · {HANDLING_CLASS_LABEL[p.handlingClass]}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Cantidad"
        type="number"
        min={1}
        step={1}
        className="w-20 text-right tabular-nums"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: Number(e.target.value) })}
      />
      {onRemove && (
        <Button variant="ghost" size="icon" aria-label="Quitar línea" onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

export function ProductLinesEditor({
  products,
  lines,
  onChange,
  emptyText,
}: {
  products: readonly ProductOption[];
  lines: SkuQuantity[];
  onChange: (lines: SkuQuantity[]) => void;
  emptyText: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {lines.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {lines.map((line, i) => (
        <ProductLineInput
          key={i}
          products={products}
          value={line}
          onChange={(value) => onChange(lines.map((l, j) => (j === i ? value : l)))}
          onRemove={() => onChange(lines.filter((_, j) => j !== i))}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...lines, { sku: products[0].sku, quantity: 1 }])}
      >
        <Plus /> Agregar línea
      </Button>
    </div>
  );
}
