// Contratos de la API (espejo de los tipos del backend). Próximo paso: generarlos
// desde OpenAPI o moverlos a un paquete compartido para que no diverjan.

import type { DeliveryView, RoutePlan } from '@core/modules/routing/application/route-planner';
import type { RoadAdjustment } from '@core/modules/routing/domain/road-adjustment';
import type { MasterDataView, SiteInput } from '@core/modules/master-data/application/master-data';
import type {
  Depot,
  OrderRecord,
  VehicleRecord,
} from '@core/modules/master-data/domain/master-data';
import type { PositionFix } from '@core/modules/tracking/domain/tracking';
import type {
  DriverSession,
  FleetSnapshot,
  IngestResult,
} from '@core/modules/tracking/application/tracking-hub';

export type HandlingClass =
  'GRANEL_PESADO' | 'LARGO' | 'GENERAL' | 'FRAGIL' | 'HERRAMIENTA' | 'QUIMICO';

export interface Product {
  sku: string;
  name: string;
  brand: string | null;
  handlingClass: HandlingClass;
  unitWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile: boolean;
  requiresMechanicalUnload: boolean;
  unitVolumeM3: number;
}

export interface SkuQuantity {
  sku: string;
  quantity: number;
}

// --- Picking ------------------------------------------------------------------
export type CartType = 'MODULAR' | 'PLATAFORMA_PESADA' | 'CARRO_LARGOS';

export interface CartSpec {
  type: CartType;
  name: string;
  maxLoadKg: number;
  maxVolumeM3: number;
  maxItemLengthCm: number;
}

export type MixSeverity = 'ADVERTENCIA' | 'BLOQUEO';
export type MixDecision = 'PERMITIDO' | 'PERMITIDO_CON_ADVERTENCIA' | 'BLOQUEADO';

export interface MixViolation {
  rule: string;
  severity: MixSeverity;
  message: string;
  skus: string[];
}

export interface MixCheckResponse {
  cart: CartSpec;
  decision: MixDecision;
  violations: MixViolation[];
  load: {
    totalWeightKg: number;
    totalVolumeM3: number;
    weightUtilization: number;
    volumeUtilization: number;
  };
}

// --- Cubicaje -------------------------------------------------------------------
export interface CubicajeRequest {
  lines: SkuQuantity[];
  siteHasUnloadingEquipment: boolean;
  loadCenterRatio: number;
}

export interface LoadProfile {
  lineCount: number;
  totalUnits: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  longestItemM: number;
  heaviestUnitKg: number;
  mechanicalUnloadSkus: string[];
}

export interface VehicleEvaluation {
  vehicleCode: string;
  vehicleName: string;
  feasible: boolean;
  weightUtilization: number;
  volumeUtilization: number;
  axleLoads: {
    frontKg: number;
    rearKg: number;
    frontLimitKg: number;
    rearLimitKg: number;
    frontShare: number;
  };
  issues: { code: string; message: string }[];
}

export interface CubicajeResponse {
  profile: LoadProfile;
  recommendation: VehicleEvaluation | null;
  evaluations: VehicleEvaluation[];
  splitSuggestion: {
    vehicleCode: string;
    vehicleName: string;
    trips: number;
    maxPayloadPerTripKg: number;
    message: string;
  } | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}

export interface MixCheckRequest {
  cartType: CartType;
  currentLines: SkuQuantity[];
  incoming: SkuQuantity;
}

// --- Rutas y rastreo: mismos tipos que el backend (alias @core), sin copiarlos ---------
export type { LatLng } from '@core/common/geo';
export type {
  PlannedRoute,
  PlannedStop,
  PlanTotals,
  RoadSummary,
} from '@core/modules/routing/domain/optimizer';
export type { RoadAdjustment } from '@core/modules/routing/domain/road-adjustment';
export type {
  RoadInstruction,
  RoadRoute,
  RoadsideFeatures,
  TrafficSeverity,
  TrafficSpan,
} from '@core/modules/routing/domain/road-route';
export type { DeliveryView, RoutePlan } from '@core/modules/routing/application/route-planner';
export type { DeviceStatus, PositionFix, StopState } from '@core/modules/tracking/domain/tracking';
export type {
  CargoLine,
  DriverSession,
  FleetSnapshot,
  IngestResult,
  LiveDevice,
  LiveStop,
  TrackingEvent,
} from '@core/modules/tracking/application/tracking-hub';

export type { MasterDataView, SiteInput } from '@core/modules/master-data/application/master-data';
export type {
  Depot,
  OrderLineRecord,
  OrderRecord,
  VehicleRecord,
} from '@core/modules/master-data/domain/master-data';
export type { DeliverySite } from '@core/modules/routing/domain/delivery';

export interface FleetUnitView {
  plate: string;
  vehicleName: string;
  /** Paradas asignadas en el plan publicado. */
  stops: number;
}

export interface TrackResponse {
  fixes: PositionFix[];
  summary: { distanceKm: number; durationMin: number; maxSpeedKmh: number };
}

/** Operaciones que usa la interfaz; las implementa el backend (HTTP) o el motor local. */
export interface TorreApi {
  // Datos que carga la empresa (la app parte vacía).
  masterData(): Promise<MasterDataView>;
  saveDepot(depot: Depot): Promise<MasterDataView>;
  saveVehicle(vehicle: VehicleRecord): Promise<MasterDataView>;
  removeVehicle(plate: string): Promise<MasterDataView>;
  saveProduct(product: Omit<Product, 'unitVolumeM3'>): Promise<MasterDataView>;
  removeProduct(sku: string): Promise<MasterDataView>;
  saveSite(site: SiteInput): Promise<MasterDataView>;
  removeSite(id: string): Promise<MasterDataView>;
  saveOrder(order: OrderRecord): Promise<MasterDataView>;
  removeOrder(id: string): Promise<MasterDataView>;

  products(): Promise<Product[]>;
  cartTypes(): Promise<CartSpec[]>;
  mixCheck(request: MixCheckRequest): Promise<MixCheckResponse>;
  cubicaje(request: CubicajeRequest): Promise<CubicajeResponse>;

  deliveries(): Promise<DeliveryView[]>;
  optimizeRoutes(request: { deliveryIds: string[]; dieselPriceClp: number }): Promise<RoutePlan>;
  /** Aplica a una ruta del plan (sin publicar) el recorrido por calles con tráfico. */
  applyRoadAdjustment(
    planId: string,
    unitPlate: string,
    adjustment: RoadAdjustment,
  ): Promise<RoutePlan>;
  publishPlan(planId: string): Promise<RoutePlan>;
  activePlan(): Promise<RoutePlan | null>;

  fleetUnits(): Promise<FleetUnitView[]>;
  startDriverSession(input: {
    driverName: string;
    driverPhone?: string | null;
    vehiclePlate: string;
  }): Promise<DriverSession>;
  sendPositions(sessionId: string, fixes: PositionFix[]): Promise<IngestResult>;
  endDriverSession(sessionId: string): Promise<DriverSession>;
  deviceTrack(sessionId: string): Promise<TrackResponse>;
  liveFleet(): Promise<FleetSnapshot>;
  /** Fotos de la flota en vivo; devuelve la función para dejar de escuchar. */
  subscribeFleet(onSnapshot: (snapshot: FleetSnapshot) => void, onError?: () => void): () => void;
}
