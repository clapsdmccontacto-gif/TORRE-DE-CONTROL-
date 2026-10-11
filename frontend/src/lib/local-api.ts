// Motor local: ejecuta en el navegador las mismas reglas de dominio del backend
// (importadas desde backend/src con el alias @core). Así la app funciona sin servidor;
// los datos quedan guardados sólo en este dispositivo (localStorage).
import { DomainError } from '@core/common/domain-error';
import type { RecordStore } from '@core/common/record-store';
import { resolveLines } from '@core/modules/catalog/application/resolve-lines';
import { unitVolumeM3 } from '@core/modules/catalog/domain/product';
import { maxPayloadKg } from '@core/modules/load-planning/domain/vehicle';
import { DEFAULT_FLEET } from '@core/modules/load-planning/infrastructure/default-fleet';
import { MasterData } from '@core/modules/master-data/application/master-data';
import type { StateStore } from '@core/modules/master-data/application/state-store.port';
import { planLoad } from '@core/modules/load-planning/domain/cubicaje';
import { RoutePlanner } from '@core/modules/routing/application/route-planner';
import { TrackingHub } from '@core/modules/tracking/application/tracking-hub';
import { ApiError } from '@/lib/api-error';
import type { TorreApi } from '@/types/api';

export const LOCAL_DATA_KEY = 'torre-control.master-data';
const LOCAL_RECORDS_PREFIX = 'torre-control.records.';

/** Datos maestros en el navegador. */
const localStore: StateStore = {
  load: async () => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) ?? 'null') as unknown;
    } catch {
      return null;
    }
  },
  save: async (snapshot) => {
    try {
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(snapshot));
    } catch {
      throw new DomainError(
        'SIN_ALMACENAMIENTO',
        'El navegador no permite guardar datos (modo privado o almacenamiento lleno).',
      );
    }
  },
};

/** Planes y rutas en el navegador: una entrada de localStorage por colección. */
function readCollection(collection: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_RECORDS_PREFIX + collection) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeCollection(collection: string, records: Record<string, unknown>): void {
  try {
    localStorage.setItem(LOCAL_RECORDS_PREFIX + collection, JSON.stringify(records));
  } catch {
    throw new DomainError(
      'SIN_ALMACENAMIENTO',
      'El navegador no permite guardar datos (modo privado o almacenamiento lleno).',
    );
  }
}

const localRecords: RecordStore = {
  list: async (collection) =>
    Object.entries(readCollection(collection)).map(([id, value]) => ({ id, value })),
  put: async (collection, id, value) =>
    writeCollection(collection, { ...readCollection(collection), [id]: value }),
  remove: async (collection, id) => {
    const records = readCollection(collection);
    delete records[id];
    writeCollection(collection, records);
  },
};

let localEngine: { data: MasterData; planner: RoutePlanner; hub: TrackingHub } | null = null;

function engine() {
  if (localEngine) return localEngine;
  const data = new MasterData({ store: localStore, vehicleTypes: DEFAULT_FLEET, maxPayloadKg });
  const planner = new RoutePlanner({
    depot: () => data.depot(),
    orders: () => data.orders(),
    fleet: DEFAULT_FLEET,
    units: () => data.units(),
    store: localRecords,
  });
  const hub = new TrackingHub({
    units: () => planner.units(),
    activePlan: () => planner.activePlan(),
    store: localRecords,
  });
  planner.onPublish((plan) => hub.planPublished(plan));
  localEngine = { data, planner, hub };
  return localEngine;
}

/** Motor con los datos, planes y rutas guardados ya cargados. */
async function ready() {
  const current = engine();
  await Promise.all([current.data.ready, current.planner.ready, current.hub.ready]);
  return current;
}

const catalog = {
  list: async () => [...(await ready()).data.products()],
  findBySkus: async (skus: readonly string[]) => {
    const products = (await ready()).data.products();
    return skus.flatMap((sku) => products.find((p) => p.sku === sku.trim().toUpperCase()) ?? []);
  },
};

/** Cada cuánto se revisa quién dejó de reportar ("sin señal"). */
const REFRESH_MS = 5_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
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
  masterData: async () => (await ready()).data.view(),
  saveDepot: (depot) => run(async () => (await ready()).data.saveDepot(depot)),
  saveVehicle: (vehicle) => run(async () => (await ready()).data.saveVehicle(vehicle)),
  removeVehicle: (plate) => run(async () => (await ready()).data.removeVehicle(plate)),
  saveProduct: (product) => run(async () => (await ready()).data.saveProduct(product)),
  removeProduct: (sku) => run(async () => (await ready()).data.removeProduct(sku)),
  saveSite: (site) => run(async () => (await ready()).data.saveSite(site)),
  removeSite: (id) => run(async () => (await ready()).data.removeSite(id)),
  saveOrder: (order) => run(async () => (await ready()).data.saveOrder(order)),
  removeOrder: (id) => run(async () => (await ready()).data.removeOrder(id)),

  products: async () =>
    (await ready()).data.products().map((p) => ({ ...p, unitVolumeM3: unitVolumeM3(p) })),
  cubicaje: (request) =>
    run(async () =>
      planLoad(await resolveLines(catalog, request.lines), DEFAULT_FLEET, {
        siteHasUnloadingEquipment: request.siteHasUnloadingEquipment,
        loadCenterRatio: request.loadCenterRatio,
      }),
    ),

  deliveries: async () => (await ready()).planner.deliveries(),
  optimizeRoutes: (request) => run(async () => (await ready()).planner.optimize(request)),
  applyRoadAdjustment: (planId, unitPlate, adjustment) =>
    run(async () => (await ready()).planner.applyRoadAdjustment(planId, unitPlate, adjustment)),
  publishPlan: (planId) => run(async () => (await ready()).planner.publish(planId)),
  activePlan: async () => (await ready()).planner.activePlan(),

  fleetUnits: async () => (await ready()).planner.fleetUnits(),
  startDriverSession: (input) => run(async () => (await ready()).hub.startSession(input)),
  sendPositions: (sessionId, fixes) =>
    run(async () => (await ready()).hub.ingest(sessionId, fixes)),
  endDriverSession: (sessionId) => run(async () => (await ready()).hub.endSession(sessionId)),
  completeStop: (sessionId, deliveryId) =>
    run(async () => (await ready()).hub.completeStop(sessionId, deliveryId)),
  deviceTrack: (sessionId) => run(async () => (await ready()).hub.track(sessionId)),
  liveFleet: async () => (await ready()).hub.snapshot(),
  subscribeFleet: (onSnapshot) => {
    const { hub } = engine();
    const unsubscribe = hub.subscribe(onSnapshot);
    subscribers++;
    refreshTimer ??= setInterval(() => hub.refresh(), REFRESH_MS);
    void hub.ready.then(() => onSnapshot(hub.snapshot()));
    return () => {
      unsubscribe();
      subscribers--;
      if (subscribers === 0 && refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };
  },
};
