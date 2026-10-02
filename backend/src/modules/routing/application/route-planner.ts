import { DomainError } from '../../../common/domain-error.js';
import type { LatLng } from '../../../common/geo.js';
import { newId } from '../../../common/ids.js';
import type { VehicleType } from '../../load-planning/domain/vehicle.js';
import { toDeliveryRequest, type DeliveryOrder } from '../domain/delivery.js';
import {
  DEFAULT_ROUTING_OPTIONS,
  optimizeRoutes,
  planTotals,
  type FleetUnit,
  type OptimizationResult,
} from '../domain/optimizer.js';
import { applyRoadAdjustment, type RoadAdjustment } from '../domain/road-adjustment.js';

export interface DeliveryView {
  id: string;
  siteName: string;
  commune: string;
  location: LatLng;
  weightKg: number;
  volumeM3: number;
  allowedVehicleCodes: string[];
  lines: { sku: string; name: string; quantity: number }[];
}

export interface RoutePlan extends OptimizationResult {
  id: string;
  createdAt: string;
  publishedAt: string | null;
  dieselPriceClp: number;
  depot: { name: string; location: LatLng };
}

export interface OptimizeInput {
  deliveryIds: string[];
  dieselPriceClp: number;
}

export interface RoutePlannerDeps {
  depot: { name: string; location: LatLng };
  /** Pedidos pendientes de despacho (hoy, datos de demostración). */
  orders: () => readonly DeliveryOrder[];
  fleet: readonly VehicleType[];
  units: readonly FleetUnit[];
  now?: () => number;
}

const MAX_STORED_PLANS = 20;

/**
 * Caso de uso "planificar el despacho": optimiza, guarda planes y publica el plan
 * activo a la flota. Sin dependencias de framework: lo usan el backend y el modo
 * local del frontend.
 */
export class RoutePlanner {
  private readonly deps: RoutePlannerDeps;
  private readonly plans = new Map<string, RoutePlan>();
  private activeId: string | null = null;
  private readonly listeners = new Set<(plan: RoutePlan) => void>();

  constructor(deps: RoutePlannerDeps) {
    this.deps = deps;
  }

  get units(): readonly FleetUnit[] {
    return this.deps.units;
  }

  /** Vehículos que un conductor puede elegir, con las paradas que les asigna el plan publicado. */
  fleetUnits(): { plate: string; vehicleName: string; stops: number }[] {
    const plan = this.activePlan();
    return this.deps.units.map((unit) => ({
      plate: unit.plate,
      vehicleName: unit.vehicle.name,
      stops: plan?.routes.find((r) => r.unitPlate === unit.plate)?.stops.length ?? 0,
    }));
  }

  deliveries(): DeliveryView[] {
    return this.deps.orders().map((order) => {
      const request = toDeliveryRequest(order, this.deps.fleet);
      return {
        id: order.id,
        siteName: order.site.name,
        commune: order.site.commune,
        location: order.site.location,
        weightKg: request.weightKg,
        volumeM3: request.volumeM3,
        allowedVehicleCodes: request.allowedVehicleCodes,
        lines: order.lines.map((l) => ({
          sku: l.product.sku,
          name: l.product.name,
          quantity: l.quantity,
        })),
      };
    });
  }

  optimize(input: OptimizeInput): RoutePlan {
    const orders = this.deps.orders();
    const unknown = input.deliveryIds.filter((id) => !orders.some((o) => o.id === id));
    if (unknown.length > 0) {
      throw new DomainError('PEDIDO_DESCONOCIDO', `Pedido no encontrado: ${unknown.join(', ')}.`, {
        deliveryIds: unknown,
      });
    }
    const selected = orders.filter((o) => input.deliveryIds.includes(o.id));
    if (selected.length === 0) {
      throw new DomainError('SIN_PEDIDOS', 'Seleccione al menos un pedido para planificar.');
    }

    const result = optimizeRoutes(
      selected.map((o) => toDeliveryRequest(o, this.deps.fleet)),
      this.deps.units,
      {
        ...DEFAULT_ROUTING_OPTIONS,
        depot: this.deps.depot.location,
        dieselPriceClp: input.dieselPriceClp,
      },
    );
    const plan: RoutePlan = {
      ...result,
      id: newId('PLAN'),
      createdAt: new Date(this.now()).toISOString(),
      publishedAt: null,
      dieselPriceClp: input.dieselPriceClp,
      depot: this.deps.depot,
    };
    this.plans.set(plan.id, plan);
    this.prune();
    return plan;
  }

  /**
   * Aplica a una ruta del plan el recorrido por calles con tráfico (orden, trazado, km y
   * diésel). Sólo antes de publicar: los conductores reciben el plan ya ajustado.
   */
  applyRoadAdjustment(planId: string, unitPlate: string, adjustment: RoadAdjustment): RoutePlan {
    const plan = this.plan(planId);
    if (plan.publishedAt) {
      throw new DomainError(
        'PLAN_PUBLICADO',
        'El plan ya fue publicado a la flota; optimice de nuevo para ajustarlo.',
      );
    }
    const route = plan.routes.find((r) => r.unitPlate === unitPlate);
    const unit = this.deps.units.find((u) => u.plate === unitPlate);
    if (!route || !unit) {
      throw new DomainError('RUTA_DESCONOCIDA', `El plan no tiene una ruta para ${unitPlate}.`);
    }
    const routes = plan.routes.map((r) =>
      r === route ? applyRoadAdjustment(r, adjustment, unit.vehicle, plan.dieselPriceClp) : r,
    );
    // El ahorro frente al despacho en orden de llegada sigue comparando estimaciones.
    const adjusted: RoutePlan = { ...plan, routes, totals: planTotals(routes) };
    this.plans.set(planId, adjusted);
    return adjusted;
  }

  /** Publica el plan a la flota: los conductores lo ven al iniciar su ruta. */
  publish(planId: string): RoutePlan {
    const plan = this.plan(planId);
    const published = { ...plan, publishedAt: new Date(this.now()).toISOString() };
    this.plans.set(planId, published);
    this.activeId = planId;
    for (const listener of this.listeners) listener(published);
    return published;
  }

  activePlan(): RoutePlan | null {
    return this.activeId ? (this.plans.get(this.activeId) ?? null) : null;
  }

  onPublish(listener: (plan: RoutePlan) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private plan(planId: string): RoutePlan {
    const plan = this.plans.get(planId);
    if (!plan)
      throw new DomainError('PLAN_DESCONOCIDO', 'El plan no existe o expiró; optimice de nuevo.');
    return plan;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private prune(): void {
    for (const id of this.plans.keys()) {
      if (this.plans.size <= MAX_STORED_PLANS) break;
      if (id !== this.activeId) this.plans.delete(id);
    }
  }
}
