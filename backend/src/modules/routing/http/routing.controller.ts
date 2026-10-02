import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RoutePlanner } from '../application/route-planner.js';
import { optimizeSchema, type OptimizeRequest } from './routing.schemas.js';

@Controller('routing')
export class RoutingController {
  constructor(private readonly planner: RoutePlanner) {}

  @Get('deliveries')
  deliveries() {
    return this.planner.deliveries();
  }

  @Post('optimize')
  @HttpCode(200)
  optimize(@Body(new ZodValidationPipe(optimizeSchema)) body: OptimizeRequest) {
    return this.planner.optimize(body);
  }

  @Post('plans/:id/publish')
  @HttpCode(200)
  publish(@Param('id') id: string) {
    return this.planner.publish(id);
  }

  @Get('plans/active')
  activePlan() {
    return { plan: this.planner.activePlan() };
  }
}
