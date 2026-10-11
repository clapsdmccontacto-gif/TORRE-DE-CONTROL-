import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RoutePlanner } from '../../routing/application/route-planner.js';
import { TrackingHub } from '../application/tracking-hub.js';
import {
  positionsSchema,
  startSessionSchema,
  type PositionsRequest,
  type StartSessionRequest,
} from './tracking.schemas.js';

const KEEP_ALIVE_MS = 10_000;

@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly hub: TrackingHub,
    private readonly planner: RoutePlanner,
  ) {}

  /** Vehículos que el conductor puede elegir, con su ruta del plan publicado. */
  @Get('units')
  units() {
    return this.planner.fleetUnits();
  }

  @Post('sessions')
  async startSession(@Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionRequest) {
    const session = this.hub.startSession(body);
    await this.hub.flush();
    return session;
  }

  @Post('sessions/:id/positions')
  @HttpCode(200)
  positions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(positionsSchema)) body: PositionsRequest,
  ) {
    return this.hub.ingest(id, body.fixes);
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  async endSession(@Param('id') id: string) {
    const session = this.hub.endSession(id);
    await this.hub.flush();
    return session;
  }

  /** El conductor registró la entrega del pedido en la obra. */
  @Post('sessions/:id/stops/:deliveryId/complete')
  @HttpCode(200)
  async completeStop(@Param('id') id: string, @Param('deliveryId') deliveryId: string) {
    const session = this.hub.completeStop(id, deliveryId);
    await this.hub.flush();
    return session;
  }

  @Get('sessions/:id/track')
  track(@Param('id') id: string) {
    return this.hub.track(id);
  }

  @Get('live')
  live() {
    return this.hub.snapshot();
  }

  /** Flujo en vivo (Server-Sent Events): una foto de la flota en cada cambio. */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const send = () => subscriber.next({ data: this.hub.snapshot() });
      send();
      const unsubscribe = this.hub.subscribe((snapshot) => subscriber.next({ data: snapshot }));
      const keepAlive = setInterval(send, KEEP_ALIVE_MS);
      return () => {
        unsubscribe();
        clearInterval(keepAlive);
      };
    });
  }
}
