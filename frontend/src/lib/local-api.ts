// Motor local: ejecuta en el navegador las mismas reglas de dominio del backend
// (importadas desde backend/src con el alias @core). Así la app funciona sin
// servidor: como archivo HTML, publicada en la web o en el teléfono.
import { DomainError } from '@core/common/domain-error';
import { resolveLines } from '@core/modules/catalog/application/resolve-lines';
import { unitVolumeM3 } from '@core/modules/catalog/domain/product';
import { DEMO_PRODUCTS } from '@core/modules/catalog/infrastructure/demo-products';
import { planLoad } from '@core/modules/load-planning/domain/cubicaje';
import { DEFAULT_FLEET } from '@core/modules/load-planning/infrastructure/default-fleet';
import { DEFAULT_CART_SPECS } from '@core/modules/picking/domain/cart';
import { checkCartAddition } from '@core/modules/picking/domain/mix-validator';
import { optimizeWithStreets } from '@core/modules/routing/application/road-refinement';
import { RoutePlanner } from '@core/modules/routing/application/route-planner';
import {
  DEMO_DEPOT,
  DEMO_ORDERS,
  DEMO_UNITS,
} from '@core/modules/routing/infrastructure/demo-network';
import { TomTomRoadRouter } from '@core/modules/routing/infrastructure/tomtom';
import { TrackingHub } from '@core/modules/tracking/application/tracking-hub';
import { tomtomKey } from '@/components/map/basemaps';
import { ApiError } from '@/lib/api-error';
import { CachedRoadRouter } from '@/lib/road-cache';
import type { TorreApi } from '@/types/api';

const catalog = {
  list: async () => [...DEMO_PRODUCTS],
  findBySkus: async (skus: readonly string[]) =>
    DEMO_PRODUCTS.filter((product) => skus.includes(product.sku)),
};

/**
 * Planificador y rastreo en memoria del navegador, en modo demostración: el plan del día
 * queda publicado y camiones simulados lo recorren. Un teléfono en "Modo conductor" en
 * esta misma pestaña también aparece en el mapa; entre dispositivos distintos hace falta
 * el backend (modo API).
 */
let fleetEngine: { planner: RoutePlanner; hub: TrackingHub; ready: Promise<void> } | null = null;

function engine() {
  if (fleetEngine) return fleetEngine;
  const planner = new RoutePlanner({
    depot: DEMO_DEPOT,
    orders: () => DEMO_ORDERS,
    fleet: DEFAULT_FLEET,
    units: DEMO_UNITS,
  });
  const hub = new TrackingHub({ units: DEMO_UNITS, activePlan: () => planner.activePlan() });
  planner.onPublish((plan) => hub.startSimulation(plan));
  fleetEngine = { planner, hub, ready: publishDemoPlan(planner) };
  return fleetEngine;
}

/** Motor con el plan de demostración ya publicado. */
async function fleet() {
  const current = engine();
  await current.ready;
  return current;
}

const DEMO_INPUT = { deliveryIds: DEMO_ORDERS.map((o) => o.id), dieselPriceClp: 1_050 };
/** Máximo de espera por las calles de TomTom antes de publicar con rutas estimadas. */
const STREETS_TIMEOUT_MS = 8_000;

/**
 * Publica el plan de demostración por calles reales (TomTom, guardado 3 h en el equipo)
 * para que los camiones simulados sigan las calles. Sin clave, sin conexión o si TomTom
 * tarda, se publica con las rutas estimadas.
 */
async function publishDemoPlan(planner: RoutePlanner): Promise<void> {
  const key = tomtomKey();
  if (key) {
    try {
      const streets = optimizeWithStreets(
        planner,
        DEMO_INPUT,
        new CachedRoadRouter(new TomTomRoadRouter(key)),
      );
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TomTom no respondió a tiempo')), STREETS_TIMEOUT_MS),
      );
      planner.publish((await Promise.race([streets, timeout])).id);
      return;
    } catch {
      // Se publica con las rutas estimadas.
    }
  }
  planner.publish(planner.optimize(DEMO_INPUT).id);
}

const TICK_MS = 2_000;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

/** Traduce los errores de dominio al mismo formato que responde la API (422). */
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new ApiError(422, { code: error.code, message: error.message });
    }
    throw error;
  }
}

export const localApi: TorreApi = {
  products: async () => DEMO_PRODUCTS.map((p) => ({ ...p, unitVolumeM3: unitVolumeM3(p) })),
  cartTypes: async () => Object.values(DEFAULT_CART_SPECS),
  mixCheck: (request) =>
    run(async () => {
      const cart = DEFAULT_CART_SPECS[request.cartType];
      const [incoming, ...current] = await resolveLines(catalog, [
        request.incoming,
        ...request.currentLines,
      ]);
      return { cart, ...checkCartAddition(cart, current, incoming) };
    }),
  cubicaje: (request) =>
    run(async () =>
      planLoad(await resolveLines(catalog, request.lines), DEFAULT_FLEET, {
        siteHasUnloadingEquipment: request.siteHasUnloadingEquipment,
        loadCenterRatio: request.loadCenterRatio,
      }),
    ),

  deliveries: async () => engine().planner.deliveries(),
  optimizeRoutes: (request) => run(async () => engine().planner.optimize(request)),
  applyRoadAdjustment: (planId, unitPlate, adjustment) =>
    run(async () => engine().planner.applyRoadAdjustment(planId, unitPlate, adjustment)),
  publishPlan: (planId) => run(async () => (await fleet()).planner.publish(planId)),
  activePlan: async () => (await fleet()).planner.activePlan(),

  fleetUnits: async () => (await fleet()).planner.fleetUnits(),
  startDriverSession: (input) => run(async () => (await fleet()).hub.startSession(input)),
  sendPositions: (sessionId, fixes) => run(async () => engine().hub.ingest(sessionId, fixes)),
  endDriverSession: (sessionId) => run(async () => engine().hub.endSession(sessionId)),
  deviceTrack: (sessionId) => run(async () => engine().hub.track(sessionId)),
  liveFleet: async () => {
    const { hub } = await fleet();
    hub.tick();
    return hub.snapshot();
  },
  subscribeFleet: (onSnapshot) => {
    const { hub, ready } = engine();
    let active = true;
    const unsubscribe = hub.subscribe(onSnapshot);
    subscribers++;
    tickTimer ??= setInterval(() => hub.tick(), TICK_MS);
    void ready.then(() => {
      if (!active) return;
      hub.tick();
      onSnapshot(hub.snapshot());
    });
    return () => {
      active = false;
      unsubscribe();
      subscribers--;
      if (subscribers === 0 && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };
  },
};
