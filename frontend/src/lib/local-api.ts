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
import { DeliveryRegistry } from '@core/modules/epod/application/delivery-registry';
import {
  byNewest,
  matchesFilter,
  type ProofStore,
  type StoredImage,
} from '@core/modules/epod/application/proof-store.port';
import { proofOrderOf, type DeliveryProof } from '@core/modules/epod/domain/delivery-proof';
import { OrderTracker } from '@core/modules/fulfillment/application/order-tracker';
import { isPlannable } from '@core/modules/fulfillment/domain/order-status';
import { PickingDesk } from '@core/modules/picking/application/picking-desk';
import { RoutePlanner } from '@core/modules/routing/application/route-planner';
import { TrackingHub, stopDetailsOf } from '@core/modules/tracking/application/tracking-hub';
import { ApiError } from '@/lib/api-error';
import { idbAll, idbGet, idbPut } from '@/lib/idb';
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

/** Comprobantes y sus fotos en el navegador (IndexedDB: localStorage no alcanza). */
const localProofs: ProofStore = {
  save: async (proof, images) => {
    for (const image of images) await idbPut('proof-images', image.id, image);
    await idbPut('proofs', proof.id, proof);
  },
  find: async (id) => (await idbGet<DeliveryProof>('proofs', id)) ?? null,
  list: async (filter) =>
    (await idbAll<DeliveryProof>('proofs')).filter((p) => matchesFilter(p, filter)).sort(byNewest),
  image: async (proofId, imageId) => {
    const image = await idbGet<StoredImage>('proof-images', imageId);
    return image && image.proofId === proofId ? image : null;
  },
};

interface LocalEngine {
  data: MasterData;
  planner: RoutePlanner;
  hub: TrackingHub;
  tracker: OrderTracker;
  registry: DeliveryRegistry;
  desk: PickingDesk;
}

let localEngine: LocalEngine | null = null;

function engine(): LocalEngine {
  if (localEngine) return localEngine;
  const data = new MasterData({ store: localStore, vehicleTypes: DEFAULT_FLEET, maxPayloadKg });
  const tracker = new OrderTracker({ store: localRecords });
  const planner = new RoutePlanner({
    depot: () => data.depot(),
    orders: () => data.orders().filter((o) => isPlannable(tracker.status(o.id))),
    fleet: DEFAULT_FLEET,
    units: () => data.units(),
    store: localRecords,
  });
  const hub = new TrackingHub({
    units: () => planner.units(),
    activePlan: () => planner.activePlan(),
    store: localRecords,
    details: (id) => {
      const order = data.orders().find((o) => o.id === id);
      return order ? stopDetailsOf(order) : null;
    },
    onRouteStarted: (session) => {
      for (const stop of session.stops) {
        if (stop.state === 'COMPLETADA') continue;
        tracker.tryTransition({
          orderId: stop.deliveryId,
          to: 'EN_RUTA',
          actor: session.driverName,
          vehiclePlate: session.vehiclePlate,
        });
      }
    },
  });
  planner.onPublish((plan) => hub.planPublished(plan));
  const registry = new DeliveryRegistry({
    store: localProofs,
    order: (id) => {
      const order = data.orders().find((o) => o.id === id);
      return order ? proofOrderOf(order) : null;
    },
    route: (sessionId) => hub.route(sessionId),
    tracker,
    onDelivered: (proof) => {
      hub.completeStop(proof.sessionId, proof.orderId, proof.outcome);
    },
  });
  const desk = new PickingDesk({
    orders: () => data.orders(),
    products: () => data.products(),
    tracker,
    routeOrder: () => planner.routeOrder(),
    store: localRecords,
  });
  localEngine = { data, planner, hub, tracker, registry, desk };
  return localEngine;
}

/** Motor con los datos, planes, rutas y pedidos guardados ya cargados. */
async function ready() {
  const current = engine();
  await Promise.all([
    current.data.ready,
    current.planner.ready,
    current.hub.ready,
    current.tracker.ready,
    current.desk.ready,
  ]);
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
      throw new ApiError(422, { code: error.code, message: error.message, details: error.details });
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
  importProducts: (products) => run(async () => (await ready()).data.importProducts(products)),
  importOrders: (input) => run(async () => (await ready()).data.importOrders(input)),

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
  submitDelivery: (submission) => run(async () => (await ready()).registry.register(submission)),
  deliveryProofs: (filter = {}) =>
    run(async () =>
      (await ready()).registry.list({
        from: filter.from,
        to: filter.to,
        vehiclePlate: filter.plate,
        outcome: filter.outcome,
        orderId: filter.order,
      }),
    ),
  deliveryImage: (proofId, imageId) =>
    run(async () => {
      const image = await (await ready()).registry.image(proofId, imageId);
      return `data:${image.mime};base64,${image.base64}`;
    }),
  orderTracks: async () => (await ready()).tracker.all(),

  pickingQueue: async () => (await ready()).desk.queue(),
  pickingOrder: (orderId) => run(async () => (await ready()).desk.view(orderId)),
  claimPick: (orderId, input) => run(async () => (await ready()).desk.claim({ orderId, ...input })),
  releasePick: (orderId, input) =>
    run(async () => (await ready()).desk.release({ orderId, ...input })),
  scanPick: (orderId, input) => run(async () => (await ready()).desk.scan({ orderId, ...input })),
  undoPick: (orderId, input) => run(async () => (await ready()).desk.undo({ orderId, ...input })),
  closePick: (orderId, input) => run(async () => (await ready()).desk.close({ orderId, ...input })),
  pickingMonitor: async () => (await ready()).desk.monitor(),
  subscribePicking: (onSnapshot) => {
    const { desk } = engine();
    const send = () => onSnapshot(desk.monitor());
    const unsubscribe = desk.subscribe(send);
    void ready().then(send);
    return unsubscribe;
  },
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
