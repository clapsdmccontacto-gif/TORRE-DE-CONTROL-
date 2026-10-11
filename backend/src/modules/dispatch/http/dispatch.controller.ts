import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { DispatchDesk } from '../application/dispatch-desk.js';
import {
  assignSchema,
  loadCloseSchema,
  loadScanSchema,
  loadUndoSchema,
  type AssignRequest,
  type LoadCloseRequest,
  type LoadScanRequest,
  type LoadUndoRequest,
} from './dispatch.schemas.js';

/** Despacho: carga de cada camión con escaneo. */
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly desk: DispatchDesk) {}

  @Get('trucks')
  trucks() {
    return this.desk.summaries();
  }

  @Get('trucks/:plate')
  truck(@Param('plate') plate: string) {
    return this.desk.truck(plate);
  }

  @Post('trucks/:plate/assign')
  @HttpCode(200)
  async assign(
    @Param('plate') plate: string,
    @Body(new ZodValidationPipe(assignSchema)) body: AssignRequest,
  ) {
    const view = this.desk.assign({ plate, ...body });
    await this.desk.flush();
    return view;
  }

  /** Una lectura al subir al camión (idempotente por `id`). */
  @Post('trucks/:plate/scans')
  @HttpCode(200)
  async scan(
    @Param('plate') plate: string,
    @Body(new ZodValidationPipe(loadScanSchema)) body: LoadScanRequest,
  ) {
    const result = this.desk.scan({ plate, ...body });
    await this.desk.flush();
    return result;
  }

  @Post('trucks/:plate/undo')
  @HttpCode(200)
  async undo(
    @Param('plate') plate: string,
    @Body(new ZodValidationPipe(loadUndoSchema)) body: LoadUndoRequest,
  ) {
    const view = this.desk.undo({ plate, ...body });
    await this.desk.flush();
    return view;
  }

  @Post('trucks/:plate/close')
  @HttpCode(200)
  async close(
    @Param('plate') plate: string,
    @Body(new ZodValidationPipe(loadCloseSchema)) body: LoadCloseRequest,
  ) {
    const view = this.desk.close({ plate, ...body });
    await this.desk.flush();
    return view;
  }
}
