import { DomainError } from '../../../common/domain-error.js';
import { newId } from '../../../common/ids.js';
import type { Product } from '../../catalog/domain/product.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';
import type { DeliveryOrder, DeliverySite } from '../../routing/domain/delivery.js';
import type { FleetUnit } from '../../routing/domain/optimizer.js';
import {
  EMPTY_MASTER_DATA,
  normalizePlate,
  parseSnapshot,
  resolveOrders,
  resolveUnits,
  upsert,
  validateDepot,
  validateOrder,
  validateProduct,
  validateSite,
  validateVehicle,
  type Depot,
  type MasterDataSnapshot,
  type OrderRecord,
  type VehicleRecord,
} from '../domain/master-data.js';
import type { StateStore } from './state-store.port.js';

/** Lo que muestra la interfaz de administración. */
export interface MasterDataView {
  depot: Depot | null;
  vehicleTypes: { code: string; name: string; maxPayloadKg: number }[];
  vehicles: (VehicleRecord & { vehicleName: string })[];
  products: Product[];
  sites: DeliverySite[];
  orders: (OrderRecord & { siteName: string; weightKg: number })[];
}

export interface SiteInput extends Omit<DeliverySite, 'id'> {
  /** Vacío al crear: se genera. */
  id?: string;
}

export interface MasterDataDeps {
  store: StateStore;
  vehicleTypes: readonly VehicleType[];
  maxPayloadKg: (vehicle: VehicleType) => number;
}

/**
 * Datos maestros de la empresa en memoria, con cada cambio guardado en el almacén.
 * Sin dependencias de framework: lo usan el backend y el modo local del frontend.
 * Las lecturas son síncronas (optimizador y rastreo); `ready` termina de cargar.
 */
export class MasterData {
  readonly ready: Promise<void>;
  private readonly deps: MasterDataDeps;
  private data: MasterDataSnapshot = EMPTY_MASTER_DATA;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: MasterDataDeps) {
    this.deps = deps;
    this.ready = deps.store.load().then((raw) => {
      this.data = parseSnapshot(raw);
    });
  }

  snapshot(): MasterDataSnapshot {
    return structuredClone(this.data);
  }

  view(): MasterDataView {
    const units = new Map(this.units().map((u) => [u.plate, u]));
    const weights = new Map(
      resolveOrders(this.data).map((o) => [
        o.id,
        o.lines.reduce((sum, l) => sum + l.product.unitWeightKg * l.quantity, 0),
      ]),
    );
    return {
      depot: this.data.depot,
      vehicleTypes: this.deps.vehicleTypes.map((t) => ({
        code: t.code,
        name: t.name,
        maxPayloadKg: Math.round(this.deps.maxPayloadKg(t)),
      })),
      vehicles: this.data.vehicles.map((v) => ({
        ...v,
        vehicleName: units.get(v.plate)?.vehicle.name ?? v.vehicleCode,
      })),
      products: [...this.data.products].sort((a, b) => a.name.localeCompare(b.name)),
      sites: [...this.data.sites].sort((a, b) => a.name.localeCompare(b.name)),
      orders: this.data.orders.map((o) => ({
        ...o,
        siteName: this.data.sites.find((s) => s.id === o.siteId)?.name ?? o.siteId,
        weightKg: Math.round((weights.get(o.id) ?? 0) * 10) / 10,
      })),
    };
  }

  depot(): Depot | null {
    return this.data.depot;
  }

  units(): FleetUnit[] {
    return resolveUnits(this.data, this.deps.vehicleTypes);
  }

  products(): Product[] {
    return this.data.products;
  }

  orders(): DeliveryOrder[] {
    return resolveOrders(this.data);
  }

  saveDepot(depot: Depot): Promise<MasterDataView> {
    return this.mutate((data) => ({ ...data, depot: validateDepot(depot) }));
  }

  saveVehicle(input: VehicleRecord): Promise<MasterDataView> {
    return this.mutate((data) => {
      const vehicle = validateVehicle(input, this.deps.vehicleTypes);
      return {
        ...data,
        vehicles: upsert(data.vehicles, vehicle, (v) => v.plate).sort((a, b) =>
          a.plate.localeCompare(b.plate),
        ),
      };
    });
  }

  removeVehicle(plate: string): Promise<MasterDataView> {
    return this.mutate((data) => {
      const key = normalizePlate(plate);
      return { ...data, vehicles: data.vehicles.filter((v) => v.plate !== key) };
    });
  }

  saveProduct(input: Product): Promise<MasterDataView> {
    return this.mutate((data) => ({
      ...data,
      products: upsert(data.products, validateProduct(input), (p) => p.sku),
    }));
  }

  removeProduct(sku: string): Promise<MasterDataView> {
    return this.mutate((data) => {
      const key = sku.trim().toUpperCase();
      const used = data.orders.filter((o) => o.lines.some((l) => l.sku === key));
      if (used.length > 0) {
        throw new DomainError(
          'PRODUCTO_EN_USO',
          `${key} está en ${used.length === 1 ? 'el pedido' : 'los pedidos'} ${used.map((o) => o.id).join(', ')}: quítelo de ahí primero.`,
        );
      }
      return { ...data, products: data.products.filter((p) => p.sku !== key) };
    });
  }

  saveSite(input: SiteInput): Promise<MasterDataView> {
    return this.mutate((data) => {
      const site = validateSite({ ...input, id: input.id?.trim() || newId('OBRA') });
      return { ...data, sites: upsert(data.sites, site, (s) => s.id) };
    });
  }

  removeSite(id: string): Promise<MasterDataView> {
    return this.mutate((data) => {
      const used = data.orders.filter((o) => o.siteId === id);
      if (used.length > 0) {
        throw new DomainError(
          'OBRA_CON_PEDIDOS',
          `La obra tiene ${used.length === 1 ? 'el pedido' : 'los pedidos'} ${used.map((o) => o.id).join(', ')}: elimínelos primero.`,
        );
      }
      return { ...data, sites: data.sites.filter((s) => s.id !== id) };
    });
  }

  saveOrder(input: OrderRecord): Promise<MasterDataView> {
    return this.mutate((data) => ({
      ...data,
      orders: upsert(data.orders, validateOrder(input, data), (o) => o.id),
    }));
  }

  removeOrder(id: string): Promise<MasterDataView> {
    return this.mutate((data) => {
      const key = id.trim().toUpperCase();
      return { ...data, orders: data.orders.filter((o) => o.id !== key) };
    });
  }

  /**
   * Cambios uno tras otro: cada uno parte de lo último guardado (dos cambios simultáneos
   * no se pisan) y se aplica sólo si el almacén lo guardó.
   */
  private mutate(
    change: (data: MasterDataSnapshot) => MasterDataSnapshot,
  ): Promise<MasterDataView> {
    const run = this.queue.then(async () => {
      await this.ready;
      const next = change(this.data);
      await this.deps.store.save(next);
      this.data = next;
      return this.view();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
