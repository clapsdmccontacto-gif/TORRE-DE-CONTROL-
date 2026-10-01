// Contratos de la API (espejo de los tipos del backend). Próximo paso: generarlos
// desde OpenAPI o moverlos a un paquete compartido para que no diverjan.

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
