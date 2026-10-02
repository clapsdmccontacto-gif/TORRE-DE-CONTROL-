import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RoutePlanner } from '../../routing/application/route-planner.js';
import { TrackingHub } from '../application/tracking-hub.js';

const TICK_MS = 3_000;

/**
 * Modo demostración (TRACKING_DEMO distinto de "false"): al arrancar optimiza los
 * pedidos de ejemplo, publica el plan y mueve camiones simulados por sus rutas.
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
    const plan = this.planner.optimize({
      deliveryIds: this.planner.deliveries().map((d) => d.id),
      dieselPriceClp: 1_050,
    });
    this.planner.publish(plan.id);
    this.timer = setInterval(() => this.hub.tick(), TICK_MS);
    this.timer.unref();
    this.logger.log(`Modo demostración: ${plan.routes.length} camiones simulados.`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopListening?.();
  }
}
