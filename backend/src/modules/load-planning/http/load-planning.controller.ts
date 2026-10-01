import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { LoadPlanningService } from '../application/load-planning.service.js';
import { cubicajeSchema, type CubicajeRequest } from './load-planning.schemas.js';

@Controller('load-planning')
export class LoadPlanningController {
  constructor(private readonly loadPlanning: LoadPlanningService) {}

  @Get('vehicle-types')
  vehicleTypes() {
    return this.loadPlanning.listVehicleTypes();
  }

  @Post('cubicaje')
  @HttpCode(200)
  cubicaje(@Body(new ZodValidationPipe(cubicajeSchema)) body: CubicajeRequest) {
    return this.loadPlanning.simulate(body);
  }
}
