import { useEffect, useState } from 'react';

/** `on`: pantalla encendida · `off`: el navegador la soltó o la negó · `unsupported`: no existe. */
export type WakeLockState = 'idle' | 'on' | 'off' | 'unsupported';

/**
 * Mantiene la pantalla encendida mientras `active` (Wake Lock API). El navegador la suelta
 * al cambiar de pestaña o bloquear el teléfono: se vuelve a pedir al volver a la app.
 */
export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>(() =>
    'wakeLock' in navigator ? 'idle' : 'unsupported',
  );

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void next.release();
          return;
        }
        lock = next;
        setState('on');
        next.addEventListener('release', () => !cancelled && setState('off'));
      } catch {
        if (!cancelled) setState('off');
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
      setState('idle');
    };
  }, [active]);

  return state;
}
