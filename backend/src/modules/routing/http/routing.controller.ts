import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RoutePlanner } from '../application/route-planner.js';
import {
  optimizeSchema,
  roadAdjustmentSchema,
  type OptimizeRequest,
  type RoadAdjustmentRequest,
} from './routing.schemas.js';

@Controller('routing')
export class RoutingController {
  constructor(private readonly planner: RoutePlanner) {}

  @Get('deliveries')
  deliveries() {
    return this.planner.deliveries();
  }

  @Post('optimize')
  @HttpCode(200)
  async optimize(@Body(new ZodValidationPipe(optimizeSchema)) body: OptimizeRequest) {
    const plan = this.planner.optimize(body);
    await this.planner.flush();
    return plan;
  }

  /** Ruta por calles con tráfico calculada en el navegador (TomTom) para una ruta del plan. */
  @Post('plans/:id/routes/:plate/road')
  @HttpCode(200)
  async applyRoad(
    @Param('id') id: string,
    @Param('plate') plate: string,
    @Body(new ZodValidationPipe(roadAdjustmentSchema)) body: RoadAdjustmentRequest,
  ) {
    const plan = this.planner.applyRoadAdjustment(id, plate, body);
    await this.planner.flush();
    return plan;
  }

  @Post('plans/:id/publish')
  @HttpCode(200)
  async publish(@Param('id') id: string) {
    const plan = this.planner.publish(id);
    await this.planner.flush();
    return plan;
  }

  @Get('plans/active')
  activePlan() {
    return { plan: this.planner.activePlan() };
  }
}
