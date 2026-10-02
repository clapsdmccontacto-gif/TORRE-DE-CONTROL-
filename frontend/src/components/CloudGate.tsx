import { parseSnapshot } from '@core/modules/master-data/domain/master-data';
import { CloudCheck, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, RadioTower } from 'lucide-react';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { API_URL, api, connectApi, errorMessage } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import {
  CLOUD_URL,
  cloudOrigin,
  findCloud,
  readCloudKey,
  readCloudUrl,
  saveCloudKey,
  setConnectedCloud,
  takeLinkParams,
} from '@/lib/cloud';
import { LOCAL_DATA_KEY } from '@/lib/local-api';

type Gate =
  | { step: 'checking' }
  | { step: 'waking' }
  | { step: 'migrating' }
  | { step: 'ready' }
  | { step: 'create-key'; error: string | null }
  | { step: 'enter-key'; error: string | null };

/** Cuánto se espera al servidor (el plan gratuito de Render despierta en ~1 minuto). */
const WAKE_TIMEOUT_MS = 75_000;

/**
 * Dónde buscar la nube: la interfaz servida por el propio servidor usa su API; la de GitHub
 * Pages prueba la dirección pegada en este equipo y la de render.yaml.
 */
function cloudApiBases(): string[] {
  if (API_URL) return [API_URL];
  const origins = [readCloudUrl(), import.meta.env.PROD ? CLOUD_URL : ''].filter(Boolean);
  return [...new Set(origins)].map((origin) => `${origin}/api/v1`);
}

/**
 * Antes de mostrar la app: busca la nube y, si existe, entra con la clave de la empresa
 * (o la crea la primera vez). Sin nube, la app queda en este equipo (modo local).
 */
export function CloudGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ step: 'checking' });
  const [apiBase, setApiBase] = useState<string | null>(null);
  /** La nube todavía no tiene datos: se puede crear otra clave si la primera no sirve. */
  const [canClaim, setCanClaim] = useState(false);

  useEffect(() => {
    let active = true;
    const update = (next: Gate) => active && setGate(next);
    takeLinkParams();
    const bases = cloudApiBases();
    const waking = setTimeout(() => update({ step: 'waking' }), 2_500);
    void findCloud(bases, WAKE_TIMEOUT_MS).then(async (found) => {
      clearTimeout(waking);
      if (!active) return;
      if (!found) {
        // Sin nube activada: la app funciona en este equipo.
        update({ step: 'ready' });
        return;
      }
      connectApi(found.apiBase);
      setConnectedCloud(cloudOrigin(found.apiBase));
      setApiBase(found.apiBase);
      setCanClaim(found.status.canClaim);
      if (!found.status.claimed) {
        update({ step: 'create-key', error: null });
        return;
      }
      update(await enter(readCloudKey()));
    });
    return () => {
      active = false;
      clearTimeout(waking);
    };
  }, []);

  /** Valida la clave guardada o escrita; si sirve, sube los datos locales y entra. */
  async function enter(key: string): Promise<Gate> {
    if (!key) return { step: 'enter-key', error: null };
    saveCloudKey(key);
    try {
      await api.masterData();
    } catch (e) {
      saveCloudKey('');
      const wrong = e instanceof ApiError && (e.status === 401 || e.status === 429);
      return {
        step: 'enter-key',
        error: wrong ? errorMessage(e) : `No se pudo entrar: ${errorMessage(e)}`,
      };
    }
    await uploadLocalData(() => setGate({ step: 'migrating' }));
    return { step: 'ready' };
  }

  async function createKey(key: string) {
    if (key.trim().length < 6) {
      setGate({ step: 'create-key', error: 'La clave debe tener al menos 6 caracteres.' });
      return;
    }
    try {
      const response = await fetch(`${apiBase}/cloud/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        // Otro equipo ya cargó datos con su clave: pedirla en vez de crear otra.
        if (response.status === 422) setCanClaim(false);
        setGate({
          step: response.status === 422 ? 'enter-key' : 'create-key',
          error: body?.message ?? `El servidor respondió ${response.status}.`,
        });
        return;
      }
      setGate(await enter(key.trim()));
    } catch {
      setGate({ step: 'create-key', error: 'Sin conexión con la nube. Intente de nuevo.' });
    }
  }

  if (gate.step === 'ready') return children;
  return (
    <div className="grid min-h-svh place-items-center bg-background p-4">
      <div className="grid w-full max-w-md gap-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <RadioTower className="size-5" aria-hidden /> Torre de Control · Constructor Center
        </p>
        {gate.step === 'checking' || gate.step === 'waking' || gate.step === 'migrating' ? (
          <Card>
            <CardContent className="flex items-start gap-3 text-sm">
              <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
              <span role="status">
                {gate.step === 'checking' && 'Conectando con la nube…'}
                {gate.step === 'waking' &&
                  'Despertando el servidor de la nube (el plan gratuito tarda hasta un minuto la primera vez)…'}
                {gate.step === 'migrating' && 'Subiendo a la nube los datos de este equipo…'}
              </span>
            </CardContent>
          </Card>
        ) : gate.step === 'create-key' ? (
          <CreateKey error={gate.error} onSubmit={createKey} />
        ) : (
          <EnterKey
            error={gate.error}
            onSubmit={async (key) => setGate(await enter(key.trim()))}
            onCreateNew={canClaim ? () => setGate({ step: 'create-key', error: null }) : null}
          />
        )}
      </div>
    </div>
  );
}

/** Campo de clave con «Mostrar»: sin mayúscula automática ni autocorrector del celular. */
function KeyInput({
  visible,
  onToggle,
  ...props
}: ComponentProps<'input'> & { visible: boolean; onToggle: () => void }) {
  return (
    <div className="flex gap-2">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button type="button" variant="outline" onClick={onToggle} aria-pressed={visible}>
        {visible ? <EyeOff /> : <Eye />} {visible ? 'Ocultar' : 'Mostrar'}
      </Button>
    </div>
  );
}

function CreateKey({ error, onSubmit }: { error: string | null; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(true);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudCheck className="size-5" aria-hidden /> La nube está lista
        </CardTitle>
        <CardDescription>
          Invente aquí la clave de acceso de la empresa (no es la contraseña de Render ni la de
          GitHub). Desde ahora, lo que se agregue en cualquier computador o teléfono se guarda en la
          nube y se ve en todos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(key);
          }}
        >
          <label className="font-medium" htmlFor="cloud-new-key">
            Nueva clave (mínimo 6 caracteres)
          </label>
          <KeyInput
            id="cloud-new-key"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
          />
          {error && <StatusLabel status="critical">{error}</StatusLabel>}
          <Button type="submit" disabled={key.trim().length === 0}>
            <KeyRound /> Crear clave y entrar
          </Button>
          <p className="text-xs text-muted-foreground">
            Anótela: se pide una vez en cada equipo y no importan mayúsculas ni minúsculas. Los
            conductores no la escriben: reciben un enlace que ya la trae («Flota y bodega»).
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function EnterKey({
  error,
  onSubmit,
  onCreateNew,
}: {
  error: string | null;
  onSubmit: (key: string) => Promise<void>;
  onCreateNew: (() => void) | null;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden /> Clave de acceso
        </CardTitle>
        <CardDescription>
          Ingrese la clave de la empresa que se creó en esta app (no es la contraseña de Render ni
          la de GitHub). Se pide una sola vez en este equipo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void onSubmit(key).finally(() => setBusy(false));
          }}
        >
          <KeyInput
            id="cloud-key"
            aria-label="Clave de acceso"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
          />
          {error && <StatusLabel status="critical">{error}</StatusLabel>}
          <Button type="submit" disabled={busy || key.trim().length === 0}>
            {busy ? <LoaderCircle className="animate-spin" /> : <LogIn />} Entrar
          </Button>
          {onCreateNew && (
            <div className="grid gap-2 border-t pt-3">
              <p className="text-muted-foreground">
                ¿No recuerda la clave? La nube todavía no tiene datos, así que puede crear otra.
              </p>
              <Button type="button" variant="outline" onClick={onCreateNew}>
                <KeyRound /> Crear una clave nueva
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Si en este equipo se usó la app sin nube y la nube está vacía, sube esos datos (bodega,
 * camiones, productos, obras y pedidos) para no tener que cargarlos de nuevo.
 */
async function uploadLocalData(onStart: () => void): Promise<void> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) ?? 'null');
  } catch {
    return;
  }
  const local = parseSnapshot(raw);
  const hasLocal =
    local.depot || local.vehicles.length || local.products.length || local.sites.length;
  if (!hasLocal) return;
  const cloud = await api.masterData();
  const cloudEmpty =
    !cloud.depot && !cloud.vehicles.length && !cloud.products.length && !cloud.sites.length;
  if (!cloudEmpty) return;
  onStart();
  try {
    if (local.depot) await api.saveDepot(local.depot);
    for (const vehicle of local.vehicles) await api.saveVehicle(vehicle);
    for (const product of local.products) await api.saveProduct(product);
    for (const site of local.sites) await api.saveSite(site);
    for (const order of local.orders) await api.saveOrder(order);
  } catch {
    // Lo que no se pudo subir queda en este equipo; se puede volver a cargar a mano.
  }
}
