import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { MasterDataView } from '@/types/api';

/** Datos maestros con un `change` que guarda y refresca la vista (o deja el error). */
export function useMasterData() {
  const [data, setData] = useState<MasterDataView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .masterData()
      .then((view) => active && setData(view))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
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
