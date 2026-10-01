import { Calculator, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { ProductLinesEditor } from '@/components/product-lines';
import { Meter, StatTile, StatusBanner, StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { formatKg, formatM, formatM3, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CubicajeResponse, Product, SkuQuantity, VehicleEvaluation } from '@/types/api';

export function CubicajePage({ products }: { products: Product[] }) {
  const [lines, setLines] = useState<SkuQuantity[]>([
    { sku: 'CEM-ESP-25', quantity: 60 },
    { sku: 'FIE-A630-12', quantity: 20 },
    { sku: 'MAK-HP1630', quantity: 2 },
  ]);
  const [siteHasUnloadingEquipment, setSiteHasUnloadingEquipment] = useState(false);
  const [loadCenterRatio, setLoadCenterRatio] = useState(0.5);
  const [result, setResult] = useState<CubicajeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function calculate() {
    setPending(true);
    setError(null);
    try {
      setResult(await api.cubicaje({ lines, siteHasUnloadingEquipment, loadCenterRatio }));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <Card className="content-start">
        <CardHeader>
          <CardTitle>Carga a despachar</CardTitle>
          <CardDescription>
            Líneas del pedido (o de varios pedidos de la misma ruta).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <ProductLinesEditor
            products={products}
            lines={lines}
            onChange={setLines}
            emptyText="Agregue al menos una línea."
          />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-current"
              checked={siteHasUnloadingEquipment}
              onChange={(e) => setSiteHasUnloadingEquipment(e.target.checked)}
            />
            <span>
              La obra tiene equipo de descarga
              <span className="block text-muted-foreground">
                Grúa horquilla u otro: no se exige camión pluma para unidades sobre 25 kg.
              </span>
            </span>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="flex justify-between">
              <span>Posición de la carga en la plataforma</span>
              <span className="tabular-nums text-muted-foreground">
                {formatPct(loadCenterRatio)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={loadCenterRatio}
              onChange={(e) => setLoadCenterRatio(Number(e.target.value))}
              className="accent-current"
            />
            <span className="flex justify-between text-xs text-muted-foreground">
              <span>Junto a la cabina</span>
              <span>Centro</span>
              <span>En la cola</span>
            </span>
          </label>

          <Button
            onClick={calculate}
            disabled={pending || lines.length === 0}
            className="justify-self-start"
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Calculator />}
            Calcular cubicaje
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 content-start gap-6">
        {error && (
          <StatusBanner status="critical" title="No se pudo calcular">
            {error}
          </StatusBanner>
        )}
        {!result && !error && (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Defina la carga y presione «Calcular cubicaje» para ver qué vehículo corresponde.
            </CardContent>
          </Card>
        )}
        {result && <CubicajeResult result={result} />}
      </div>
    </div>
  );
}

function CubicajeResult({ result }: { result: CubicajeResponse }) {
  const { profile, recommendation, splitSuggestion } = result;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Peso total"
          value={formatKg(profile.totalWeightKg)}
          hint={`${profile.totalUnits} unidades`}
        />
        <StatTile label="Volumen" value={formatM3(profile.totalVolumeM3)} />
        <StatTile label="Ítem más largo" value={formatM(profile.longestItemM)} />
        <StatTile
          label="Descarga"
          value={profile.mechanicalUnloadSkus.length > 0 ? 'Mecánica' : 'Manual'}
          hint={
            profile.mechanicalUnloadSkus.join(', ') ||
            `Máx. ${formatKg(profile.heaviestUnitKg)}/unidad`
          }
        />
      </div>

      {recommendation ? (
        <StatusBanner status="good" title={`Vehículo recomendado: ${recommendation.vehicleName}`}>
          El factible de menor costo por km. Uso de carga útil{' '}
          {formatPct(recommendation.weightUtilization)}, volumen{' '}
          {formatPct(recommendation.volumeUtilization)}.
        </StatusBanner>
      ) : splitSuggestion ? (
        <StatusBanner status="warning" title={`Dividir en ${splitSuggestion.trips} viajes`}>
          {splitSuggestion.message}
        </StatusBanner>
      ) : (
        <StatusBanner status="critical" title="Ningún vehículo de la flota puede llevar esta carga">
          Revise los motivos de cada vehículo (largo, pluma) o separe los ítems problemáticos.
        </StatusBanner>
      )}

      <div className="grid grid-cols-1 gap-4">
        {result.evaluations.map((evaluation) => (
          <VehicleCard
            key={evaluation.vehicleCode}
            evaluation={evaluation}
            recommended={evaluation.vehicleCode === recommendation?.vehicleCode}
          />
        ))}
      </div>
    </>
  );
}

function VehicleCard({
  evaluation,
  recommended,
}: {
  evaluation: VehicleEvaluation;
  recommended: boolean;
}) {
  const { axleLoads } = evaluation;
  return (
    <Card className={cn(recommended && 'ring-2 ring-primary')}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <CardTitle>{evaluation.vehicleName}</CardTitle>
        <StatusLabel status={evaluation.feasible ? 'good' : 'critical'}>
          {evaluation.feasible ? (recommended ? 'Recomendado' : 'Factible') : 'No factible'}
        </StatusLabel>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          <Meter label="Carga útil" value={evaluation.weightUtilization} />
          <Meter label="Volumen" value={evaluation.volumeUtilization} />
          <Meter
            label="Eje delantero"
            value={axleLoads.frontKg / axleLoads.frontLimitKg}
            detail={formatKg(axleLoads.frontKg)}
          />
          <Meter
            label="Eje trasero"
            value={axleLoads.rearKg / axleLoads.rearLimitKg}
            detail={formatKg(axleLoads.rearKg)}
          />
        </div>
        {evaluation.issues.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 text-sm text-muted-foreground">
            {evaluation.issues.map((issue) => (
              <li key={issue.code} className="border-l-2 pl-2">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
