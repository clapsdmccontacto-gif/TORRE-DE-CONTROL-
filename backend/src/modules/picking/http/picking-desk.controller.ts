import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { PickingDesk } from '../application/picking-desk.js';
import {
  claimSchema,
  closeSchema,
  releaseSchema,
  scanSchema,
  undoSchema,
  type ClaimRequest,
  type CloseRequest,
  type ReleaseRequest,
  type ScanRequest,
  type UndoRequest,
} from './picking.schemas.js';

const KEEP_ALIVE_MS = 15_000;

/** App de bodega (picking con escaneo) y monitor de la torre. */
@Controller('picking')
export class PickingDeskController {
  constructor(private readonly desk: PickingDesk) {}

  @Get('orders')
  queue() {
    return this.desk.queue();
  }

  @Get('orders/:id')
  view(@Param('id') id: string) {
    return this.desk.view(id);
  }

  @Post('orders/:id/claim')
  @HttpCode(200)
  async claim(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimSchema)) body: ClaimRequest,
  ) {
    const view = this.desk.claim({ orderId: id, ...body });
    await this.desk.flush();
    return view;
  }

  @Post('orders/:id/release')
  @HttpCode(200)
  async release(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(releaseSchema)) body: ReleaseRequest,
  ) {
    const view = this.desk.release({ orderId: id, ...body });
    await this.desk.flush();
    return view;
  }

  /** Una lectura de la pistola o la cámara (idempotente por `id`). */
  @Post('orders/:id/scans')
  @HttpCode(200)
  async scan(@Param('id') id: string, @Body(new ZodValidationPipe(scanSchema)) body: ScanRequest) {
    const result = this.desk.scan({ orderId: id, ...body });
    await this.desk.flush();
    return result;
  }

  @Post('orders/:id/undo')
  @HttpCode(200)
  async undo(@Param('id') id: string, @Body(new ZodValidationPipe(undoSchema)) body: UndoRequest) {
    const view = this.desk.undo({ orderId: id, ...body });
    await this.desk.flush();
    return view;
  }

  @Post('orders/:id/close')
  @HttpCode(200)
  async close(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeSchema)) body: CloseRequest,
  ) {
    const view = this.desk.close({ orderId: id, ...body });
    await this.desk.flush();
    return view;
  }

  @Get('monitor')
  monitor() {
    return this.desk.monitor();
  }

  /** Monitor en vivo (Server-Sent Events): una foto en cada cambio. */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const send = () => subscriber.next({ data: this.desk.monitor() });
      send();
      const unsubscribe = this.desk.subscribe(send);
      const keepAlive = setInterval(send, KEEP_ALIVE_MS);
      return () => {
        unsubscribe();
        clearInterval(keepAlive);
      };
    });
  }
}
