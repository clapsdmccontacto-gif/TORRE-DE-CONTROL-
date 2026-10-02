import { DomainError } from '../../../common/domain-error.js';
import { isValidLatLng, type LatLng } from '../../../common/geo.js';
import { HANDLING_CLASSES, type Product } from '../../catalog/domain/product.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';
import type { DeliveryOrder, DeliverySite } from '../../routing/domain/delivery.js';
import type { FleetUnit } from '../../routing/domain/optimizer.js';

/**
 * Datos maestros que carga la empresa: bodega, camiones (patente + tipo), productos,
 * obras y pedidos. La app parte vacía; no hay datos de muestra.
 */
export interface Depot {
  name: string;
  location: LatLng;
}

export interface VehicleRecord {
  plate: string;
  /** Tipo de vehículo del catálogo (`DEFAULT_FLEET`): define capacidad, ejes y consumo. */
  vehicleCode: string;
}

export interface OrderLineRecord {
  sku: string;
  quantity: number;
}

/** Pedido guardado: nota de venta, obra y líneas por SKU. */
export interface OrderRecord {
  id: string;
  siteId: string;
  lines: OrderLineRecord[];
}

export interface MasterDataSnapshot {
  version: 1;
  depot: Depot | null;
  vehicles: VehicleRecord[];
  products: Product[];
  sites: DeliverySite[];
  orders: OrderRecord[];
}

export const EMPTY_MASTER_DATA: MasterDataSnapshot = {
  version: 1,
  depot: null,
  vehicles: [],
  products: [],
  sites: [],
  orders: [],
};

const invalid = (code: string, message: string) => new DomainError(code, message);

function text(value: string, field: string, min: number, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < min || trimmed.length > max) {
    throw invalid('DATO_INVALIDO', `${field}: entre ${min} y ${max} caracteres.`);
  }
  return trimmed;
}

function positive(value: number, field: string, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw invalid('DATO_INVALIDO', `${field} debe ser mayor que 0 (máximo ${max}).`);
  }
  return value;
}

function location(value: LatLng, field: string): LatLng {
  if (!isValidLatLng(value)) {
    throw invalid('UBICACION_INVALIDA', `${field}: marque un punto válido en el mapa.`);
  }
  return { lat: value.lat, lng: value.lng };
}

/** Patente chilena (o interna): mayúsculas, sin espacios ni puntos. Ej.: "ab·cd 12" → "ABCD12". */
export function normalizePlate(raw: string): string {
  const plate = raw.toUpperCase().replace(/[\s.·]/g, '');
  if (!/^[A-Z0-9-]{4,10}$/.test(plate)) {
    throw invalid('PATENTE_INVALIDA', 'La patente debe tener entre 4 y 10 letras o números.');
  }
  return plate;
}

export function validateDepot(depot: Depot): Depot {
  return {
    name: text(depot.name, 'Nombre de la bodega', 2, 80),
    location: location(depot.location, 'Bodega'),
  };
}

export function validateVehicle(
  vehicle: VehicleRecord,
  vehicleTypes: readonly VehicleType[],
): VehicleRecord {
  if (!vehicleTypes.some((t) => t.code === vehicle.vehicleCode)) {
    throw invalid(
      'TIPO_VEHICULO_DESCONOCIDO',
      `Tipo de vehículo desconocido: ${vehicle.vehicleCode}.`,
    );
  }
  return { plate: normalizePlate(vehicle.plate), vehicleCode: vehicle.vehicleCode };
}

export function validateProduct(product: Product): Product {
  if (!HANDLING_CLASSES.includes(product.handlingClass)) {
    throw invalid('DATO_INVALIDO', `Clase de manejo desconocida: ${product.handlingClass}.`);
  }
  const brand = product.brand?.trim() ?? '';
  return {
    sku: text(product.sku, 'SKU', 1, 40).toUpperCase(),
    name: text(product.name, 'Nombre del producto', 2, 120),
    brand: brand === '' ? null : text(brand, 'Marca', 1, 60),
    handlingClass: product.handlingClass,
    unitWeightKg: positive(product.unitWeightKg, 'Peso por unidad (kg)', 5_000),
    lengthCm: positive(product.lengthCm, 'Largo (cm)', 2_000),
    widthCm: positive(product.widthCm, 'Ancho (cm)', 500),
    heightCm: positive(product.heightCm, 'Alto (cm)', 500),
    isFragile: Boolean(product.isFragile),
    requiresMechanicalUnload: Boolean(product.requiresMechanicalUnload),
  };
}

export function validateSite(site: DeliverySite): DeliverySite {
  const notify = Math.round(site.notifyEtaMinutes);
  if (!Number.isFinite(notify) || notify < 1 || notify > 120) {
    throw invalid('DATO_INVALIDO', 'El aviso al capataz debe estar entre 1 y 120 minutos.');
  }
  return {
    id: text(site.id, 'Identificador de la obra', 1, 80),
    name: text(site.name, 'Nombre de la obra', 2, 120),
    commune: text(site.commune, 'Comuna', 2, 60),
    location: location(site.location, 'Obra'),
    hasUnloadingEquipment: Boolean(site.hasUnloadingEquipment),
    notifyEtaMinutes: notify,
  };
}

export function validateOrder(order: OrderRecord, data: MasterDataSnapshot): OrderRecord {
  const id = text(order.id, 'Nota de venta', 1, 40).toUpperCase();
  if (!data.sites.some((s) => s.id === order.siteId)) {
    throw invalid('OBRA_DESCONOCIDA', 'Elija una obra registrada para el pedido.');
  }
  if (order.lines.length === 0) {
    throw invalid('PEDIDO_VACIO', 'Agregue al menos un producto al pedido.');
  }
  const lines = new Map<string, number>();
  for (const line of order.lines) {
    const sku = line.sku.trim().toUpperCase();
    if (!data.products.some((p) => p.sku === sku)) {
      throw invalid('SKU_DESCONOCIDO', `El producto ${sku} no está en «Productos».`);
    }
    lines.set(sku, (lines.get(sku) ?? 0) + positive(line.quantity, `Cantidad de ${sku}`, 100_000));
  }
  return {
    id,
    siteId: order.siteId,
    lines: [...lines].map(([sku, quantity]) => ({ sku, quantity })),
  };
}

/** Reemplaza (por clave) o agrega un registro, sin mutar la lista original. */
export function upsert<T>(list: readonly T[], item: T, key: (x: T) => string): T[] {
  const k = key(item);
  return list.some((x) => key(x) === k)
    ? list.map((x) => (key(x) === k ? item : x))
    : [...list, item];
}

/** Pedidos listos para el optimizador: obra y productos resueltos. */
export function resolveOrders(data: MasterDataSnapshot): DeliveryOrder[] {
  const sites = new Map(data.sites.map((s) => [s.id, s]));
  const products = new Map(data.products.map((p) => [p.sku, p]));
  return data.orders.flatMap((order) => {
    const site = sites.get(order.siteId);
    const lines = order.lines.flatMap((l) => {
      const product = products.get(l.sku);
      return product ? [{ product, quantity: l.quantity }] : [];
    });
    return site && lines.length > 0 ? [{ id: order.id, site, lines }] : [];
  });
}

/** Camiones con su tipo de vehículo (los de un tipo que ya no existe se omiten). */
export function resolveUnits(
  data: MasterDataSnapshot,
  vehicleTypes: readonly VehicleType[],
): FleetUnit[] {
  return data.vehicles.flatMap((v) => {
    const vehicle = vehicleTypes.find((t) => t.code === v.vehicleCode);
    return vehicle ? [{ plate: v.plate, vehicle }] : [];
  });
}

/** Acepta lo guardado sólo si tiene la forma esperada; si no, parte vacío. */
export function parseSnapshot(raw: unknown): MasterDataSnapshot {
  const value = raw as Partial<MasterDataSnapshot> | null;
  if (!value || value.version !== 1) return EMPTY_MASTER_DATA;
  return {
    version: 1,
    depot: value.depot ?? null,
    vehicles: Array.isArray(value.vehicles) ? value.vehicles : [],
    products: Array.isArray(value.products) ? value.products : [],
    sites: Array.isArray(value.sites) ? value.sites : [],
    orders: Array.isArray(value.orders) ? value.orders : [],
  };
}
