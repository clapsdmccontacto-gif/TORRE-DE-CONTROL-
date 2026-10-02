import { LoaderCircle, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { ProductLineInput, ProductLinesEditor } from '@/components/product-lines';
import { Meter, StatusBanner, StatusLabel, type Status } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { formatKg, formatM3 } from '@/lib/format';
import type {
  CartSpec,
  CartType,
  MixCheckResponse,
  MixDecision,
  Product,
  SkuQuantity,
} from '@/types/api';

const DECISION: Record<MixDecision, { status: Status; title: string }> = {
  PERMITIDO: { status: 'good', title: 'Puede subir al carro' },
  PERMITIDO_CON_ADVERTENCIA: { status: 'warning', title: 'Puede subir, con precaución' },
  BLOQUEADO: { status: 'critical', title: 'Bloqueado: no subir a este carro' },
};

export function MixCheckPage({
  products,
  cartTypes,
}: {
  products: Product[];
  cartTypes: CartSpec[];
}) {
  const [cartType, setCartType] = useState<CartType>(cartTypes[0]?.type ?? 'MODULAR');
  const [cartLines, setCartLines] = useState<SkuQuantity[]>([]);
  const [incoming, setIncoming] = useState<SkuQuantity>({ sku: products[0].sku, quantity: 1 });
  const [result, setResult] = useState<MixCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Cualquier cambio en el carro invalida la validación anterior.
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setResult(null);
    };

  async function validate() {
    setPending(true);
    setError(null);
    try {
      setResult(await api.mixCheck({ cartType, currentLines: cartLines, incoming }));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  function confirmIntoCart() {
    const existing = cartLines.find((l) => l.sku === incoming.sku);
    setCartLines(
      existing
        ? cartLines.map((l) =>
            l === existing ? { ...l, quantity: l.quantity + incoming.quantity } : l,
          )
        : [...cartLines, incoming],
    );
    setResult(null);
  }

  const decision = result && DECISION[result.decision];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="grid grid-cols-1 content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Carro en uso</CardTitle>
            <CardDescription>Tipo de carro y lo que ya fue escaneado en él.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <NativeSelect
              aria-label="Tipo de carro"
              value={cartType}
              onChange={(e) => edit(setCartType)(e.target.value as CartType)}
            >
              {cartTypes.map((c) => (
                <option key={c.type} value={c.type}>
                  {c.name} · {formatKg(c.maxLoadKg)} · {c.maxItemLengthCm} cm
                </option>
              ))}
            </NativeSelect>
            <ProductLinesEditor
              products={products}
              lines={cartLines}
              onChange={edit(setCartLines)}
              emptyText="Carro vacío."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ítem escaneado</CardTitle>
            <CardDescription>
              Se valida contra el contenido del carro antes de confirmarlo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <ProductLineInput products={products} value={incoming} onChange={edit(setIncoming)} />
            <Button onClick={validate} disabled={pending} className="justify-self-start">
              {pending ? <LoaderCircle className="animate-spin" /> : <ScanLine />}
              Validar mezcla
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="content-start">
        <CardHeader>
          <CardTitle>Resultado</CardTitle>
          <CardDescription>Regla de mezcla incompatible y capacidad del carro.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          {error && (
            <StatusBanner status="critical" title="No se pudo validar">
              {error}
            </StatusBanner>
          )}
          {!result && !error && (
            <p className="text-sm text-muted-foreground">
              Escanee un ítem y presione «Validar mezcla».
            </p>
          )}
          {result && decision && (
            <>
              <StatusBanner status={decision.status} title={decision.title}>
                {result.decision === 'BLOQUEADO'
                  ? 'Separe el ítem en otro carro. La autorización de supervisor llega con la persistencia (fase 2).'
                  : `Carro: ${result.cart.name}.`}
              </StatusBanner>

              <div className="grid grid-cols-1 gap-3">
                <Meter
                  label="Peso del carro"
                  value={result.load.weightUtilization}
                  detail={`${formatKg(result.load.totalWeightKg)} de ${formatKg(result.cart.maxLoadKg)}`}
                />
                <Meter
                  label="Volumen del carro"
                  value={result.load.volumeUtilization}
                  detail={`${formatM3(result.load.totalVolumeM3)} de ${formatM3(result.cart.maxVolumeM3)}`}
                />
              </div>

              {result.violations.length > 0 && (
                <ul className="grid grid-cols-1 gap-3">
                  {result.violations.map((v, i) => (
                    <li key={i} className="grid gap-1 rounded-lg border p-3 text-sm">
                      <StatusLabel status={v.severity === 'BLOQUEO' ? 'critical' : 'warning'}>
                        {v.severity === 'BLOQUEO' ? 'Bloqueo' : 'Advertencia'} · {v.rule}
                      </StatusLabel>
                      <p className="text-muted-foreground">{v.message}</p>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                variant="outline"
                className="justify-self-start"
                disabled={result.decision === 'BLOQUEADO'}
                onClick={confirmIntoCart}
              >
                Confirmar en el carro
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
