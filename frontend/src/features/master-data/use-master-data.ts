import { useCallback, useEffect, useState } from 'react';
import { api, apiMode, errorMessage } from '@/lib/api';
import type { MasterDataView } from '@/types/api';

/** En la nube, lo que agregan otros equipos aparece solo cada este intervalo. */
const REFRESH_MS = 30_000;

/** Datos maestros con un `change` que guarda y refresca la vista (o deja el error). */
export function useMasterData() {
  const [data, setData] = useState<MasterDataView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .masterData()
        .then((view) => active && setData(view))
        .catch((e: unknown) => active && setError(errorMessage(e)));
    void load();
    const timer = setInterval(() => {
      if (apiMode === 'http' && document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const change = useCallback(async (operation: () => Promise<MasterDataView>) => {
    setBusy(true);
    setError(null);
    try {
      setData(await operation());
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { data, error, busy, change, clearError: () => setError(null) };
}
