import { Input, NativeSelect } from '@/components/ui/input';
import { BASEMAP_OPTIONS, setBasemap, useBasemap, type BasemapId } from './basemaps';

/** Selector del mapa base, debajo de cada mapa. La elección queda guardada en el dispositivo. */
export function BasemapControl() {
  const basemap = useBasemap();
  return (
    <div className="grid grid-cols-1 gap-2 border-t px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)] sm:items-center">
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
          ¿El mapa muestra avisos de clave o de acceso? Elija otro mapa base.
        </p>
      )}
    </div>
  );
}
