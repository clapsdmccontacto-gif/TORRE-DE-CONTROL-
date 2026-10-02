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
  startSession(@Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionRequest) {
    return this.hub.startSession(body);
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
  endSession(@Param('id') id: string) {
    return this.hub.endSession(id);
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
