import { KeyRound, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import {
  BASEMAP_OPTIONS,
  HAS_COMPANY_TOMTOM_KEY,
  checkTomTomKey,
  setBasemap,
  tomtomKeyOf,
  useBasemap,
  useTomTomKey,
  type BasemapId,
  type KeyCheck,
} from './basemaps';

/** Selector del mapa base, debajo de cada mapa. La elección queda guardada en el dispositivo. */
export function BasemapControl() {
  const basemap = useBasemap();
  return (
    <div className="grid grid-cols-1 gap-3 border-t px-4 py-3 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,18rem)_minmax(0,1fr)] sm:items-center">
        <label htmlFor="basemap-provider" className="font-medium">
          Mapa base
        </label>
        <NativeSelect
          id="basemap-provider"
          value={basemap.id}
          onChange={(e) => setBasemap({ ...basemap, id: e.target.value as BasemapId })}
        >
          {BASEMAP_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        {basemap.id === 'maptiler' ? (
          <Input
            id="basemap-maptiler-key"
            aria-label="Clave de MapTiler"
            placeholder="Pegue la clave de maptiler.com"
            value={basemap.maptilerKey}
            onChange={(e) => setBasemap({ ...basemap, maptilerKey: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {basemap.id === 'tomtom'
              ? 'Mapa, tráfico en vivo y rutas por calles para camiones.'
              : '¿El mapa muestra avisos de clave o de acceso? Elija otro mapa base.'}
          </p>
        )}
      </div>
      {basemap.id === 'tomtom' && <TomTomKeyField />}
      {tomtomKeyOf(basemap) !== '' && (
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <input
            id="basemap-traffic"
            type="checkbox"
            className="size-4 accent-current"
            checked={basemap.traffic}
            onChange={(e) => setBasemap({ ...basemap, traffic: e.target.checked })}
          />
          <span className="font-medium">Tráfico en vivo</span>
          <span className="text-xs text-muted-foreground">
            Colores de TomTom: verde fluido, naranjo lento, rojo congestionado. Se actualiza cada 5
            min.
          </span>
        </label>
      )}
    </div>
  );
}

const CHECK_TEXT: Record<KeyCheck, { status: 'good' | 'warning' | 'critical'; text: string }> = {
  ok: { status: 'good', text: 'Clave válida: mapa, tráfico y rutas por calles activos.' },
  invalid: {
    status: 'critical',
    text: 'TomTom rechazó la clave. Cópiela de nuevo desde «Keys» en developer.tomtom.com.',
  },
  offline: { status: 'warning', text: 'Sin internet: no se pudo probar la clave.' },
};

/**
 * Clave de TomTom de este equipo. Si queda vacía se usa la de la empresa (incluida en la
 * app). La usan el mapa, la capa de tráfico y el cálculo de rutas por calles.
 */
export function TomTomKeyField() {
  const basemap = useBasemap();
  const key = tomtomKeyOf(basemap);
  const [check, setCheck] = useState<{ key: string; result: KeyCheck | 'checking' } | null>(null);
  const result = check && check.key === key ? check.result : null;

  async function test() {
    setCheck({ key, result: 'checking' });
    const outcome = await checkTomTomKey(key);
    setCheck((current) => (current?.key === key ? { key, result: outcome } : current));
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      <label htmlFor="tomtom-key" className="font-medium">
        Clave de TomTom
      </label>
      <div className="flex gap-2">
        <Input
          id="tomtom-key"
          className="min-w-0 flex-1"
          placeholder={
            HAS_COMPANY_TOMTOM_KEY
              ? 'Usando la clave de la empresa (opcional: pegue otra)'
              : 'Pegue aquí la clave de developer.tomtom.com'
          }
          value={basemap.tomtomKey}
          onChange={(e) => setBasemap({ ...basemap, tomtomKey: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <Button variant="outline" onClick={test} disabled={!key || result === 'checking'}>
          {result === 'checking' ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          Probar clave
        </Button>
      </div>
      {result && result !== 'checking' && (
        <p role="status" className="text-sm">
          <StatusLabel status={CHECK_TEXT[result].status}>{CHECK_TEXT[result].text}</StatusLabel>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {HAS_COMPANY_TOMTOM_KEY &&
          'La app ya trae la clave de la empresa; pegue otra sólo para usar una distinta en este equipo. '}
        Gratis y sin tarjeta: cree una cuenta en{' '}
        <a
          href="https://developer.tomtom.com/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          developer.tomtom.com
        </a>
        , confirme el correo y copie la clave desde «Keys» en su panel. Incluye 50.000 mosaicos de
        mapa y 2.500 rutas al día. Queda guardada sólo en este dispositivo.
      </p>
    </div>
  );
}

/**
 * Clave de TomTom dentro de un panel: el campo queda a la vista mientras falta la clave
 * (y mientras se escribe); si ya estaba guardada, sólo un enlace para cambiarla.
 */
export function TomTomKeySection() {
  const hasKey = useTomTomKey() !== '';
  const [open, setOpen] = useState(!hasKey);
  if (open || !hasKey) return <TomTomKeyField />;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-self-start px-0 text-muted-foreground"
      onClick={() => setOpen(true)}
    >
      <KeyRound /> Cambiar clave de TomTom
    </Button>
  );
}
