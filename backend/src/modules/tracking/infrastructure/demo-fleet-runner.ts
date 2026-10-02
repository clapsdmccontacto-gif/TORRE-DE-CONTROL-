import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { optimizeWithStreets } from '../../routing/application/road-refinement.js';
import { RoutePlanner } from '../../routing/application/route-planner.js';
import { COMPANY_TOMTOM_KEY, TomTomRoadRouter } from '../../routing/infrastructure/tomtom.js';
import { TrackingHub } from '../application/tracking-hub.js';

const TICK_MS = 3_000;

/**
 * Modo demostración (TRACKING_DEMO distinto de "false"): al arrancar optimiza los
 * pedidos de ejemplo, publica el plan y mueve camiones simulados por sus rutas.
 * Con clave de TomTom (TOMTOM_API_KEY o la de la empresa) el plan pasa enseguida a
 * calles reales y los camiones las siguen; sin conexión quedan las rutas estimadas.
 * En operación real se desactiva y sólo aparecen los teléfonos de los conductores.
 */
@Injectable()
export class DemoFleetRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoFleetRunner.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopListening: (() => void) | null = null;

  constructor(
    private readonly planner: RoutePlanner,
    private readonly hub: TrackingHub,
  ) {}

  onModuleInit(): void {
    if (process.env.TRACKING_DEMO === 'false') return;
    this.stopListening = this.planner.onPublish((plan) => this.hub.startSimulation(plan));
    const input = {
      deliveryIds: this.planner.deliveries().map((d) => d.id),
      dieselPriceClp: 1_050,
    };
    const plan = this.planner.optimize(input);
    this.planner.publish(plan.id);
    this.timer = setInterval(() => this.hub.tick(), TICK_MS);
    this.timer.unref();
    this.logger.log(`Modo demostración: ${plan.routes.length} camiones simulados.`);
    void this.followStreets(plan.id, input);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopListening?.();
  }

  private async followStreets(
    initialPlanId: string,
    input: { deliveryIds: string[]; dieselPriceClp: number },
  ): Promise<void> {
    const key = (process.env.TOMTOM_API_KEY ?? COMPANY_TOMTOM_KEY).trim();
    if (!key) return;
    try {
      const plan = await optimizeWithStreets(this.planner, input, new TomTomRoadRouter(key));
      // Si alguien publicó otro plan mientras tanto, se respeta el suyo.
      if (this.planner.activePlan()?.id !== initialPlanId) return;
      this.planner.publish(plan.id);
      this.logger.log('Modo demostración: rutas por calles con tráfico (TomTom).');
    } catch (error) {
      this.logger.warn(
        `Modo demostración sin calles reales: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
