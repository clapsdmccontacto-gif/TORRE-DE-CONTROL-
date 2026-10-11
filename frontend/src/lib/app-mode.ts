/**
 * Los equipos que abren el enlace del conductor (o, más adelante, el de bodega) quedan en
 * esa app: sin el menú de oficina, aunque cambie la dirección o se recargue la página.
 */
export type DeviceApp = 'conductor';

const STORAGE = 'torre-control.device-app';
const APPS: readonly DeviceApp[] = ['conductor'];

export function isDeviceApp(value: string | null | undefined): value is DeviceApp {
  return APPS.includes(value as DeviceApp);
}

export function readDeviceApp(): DeviceApp | null {
  try {
    const value = localStorage.getItem(STORAGE);
    return isDeviceApp(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveDeviceApp(app: DeviceApp | null): void {
  try {
    if (app) localStorage.setItem(STORAGE, app);
    else localStorage.removeItem(STORAGE);
  } catch {
    // Sin almacenamiento: el enlace sigue abriendo esa app, pero no se recuerda.
  }
}
