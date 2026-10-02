import { CloudUpload, LoaderCircle, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CLOUD_DEPLOY_URL, normalizeCloudUrl, probeCloud, saveCloudUrl } from '@/lib/cloud';

/**
 * En la versión sin servidor: cómo activar el guardado en la nube para que lo que se
 * agrega en un equipo se vea en todos (y el mapa vea los teléfonos de los conductores).
 */
export function CloudSetupCard() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="size-5" aria-hidden /> Guardado en la nube
        </CardTitle>
        <CardDescription>
          Esta versión guarda los datos sólo en este equipo. Con la nube activada, lo que se agrega
          en cualquier computador o teléfono se ve en todos, y el mapa ve a los conductores.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Toque «Activar guardado en la nube». En la página de Render toque el botón «GitHub» para
            entrar (no hay que escribir contraseña) y autorice.
          </li>
          <li>Toque «Apply» (o «Deploy Blueprint») y espere unos minutos a que termine.</li>
          <li>
            Vuelva a abrir esta misma app: se conecta sola, le pide inventar la clave de la empresa
            y sube a la nube lo que ya cargó en este equipo.
          </li>
        </ol>
        <LinkButton
          href={CLOUD_DEPLOY_URL}
          target="_blank"
          rel="noreferrer"
          className="justify-self-start"
        >
          <CloudUpload /> Activar guardado en la nube
        </LinkButton>
        <ConnectByAddress />
      </CardContent>
    </Card>
  );
}

/** Si Render le dio otra dirección al servidor, se pega aquí y la app la recuerda. */
function ConnectByAddress() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const origin = normalizeCloudUrl(text);
    if (!origin) {
      setError('Pegue la dirección completa, por ejemplo https://mi-servidor.onrender.com');
      return;
    }
    setBusy(true);
    setError(null);
    const status = await probeCloud(`${origin}/api/v1`, 75_000);
    setBusy(false);
    if (!status) {
      setError(
        'No hay una Torre de Control en esa dirección (o todavía se está instalando). Revise que en Render diga «Live» e intente de nuevo.',
      );
      return;
    }
    saveCloudUrl(origin);
    window.location.reload();
  }

  return (
    <form
      className="grid gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <label className="font-medium" htmlFor="cloud-url">
        ¿Ya la activó y no se conecta sola? Pegue la dirección que muestra Render (termina en
        «.onrender.com»)
      </label>
      <div className="flex gap-2">
        <Input
          id="cloud-url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://….onrender.com"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy || !text.trim()}>
          {busy ? <LoaderCircle className="animate-spin" /> : <PlugZap />} Conectar
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-muted-foreground">
          Buscando el servidor (puede tardar hasta un minuto si estaba dormido)…
        </p>
      )}
      {error && <StatusLabel status="critical">{error}</StatusLabel>}
    </form>
  );
}
