import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { MasterData } from '../application/master-data.js';
import {
  depotSchema,
  orderSchema,
  productSchema,
  siteSchema,
  vehicleSchema,
  type DepotRequest,
  type OrderRequest,
  type ProductRequest,
  type SiteRequest,
  type VehicleRequest,
} from './master-data.schemas.js';

/** Datos que carga la empresa: bodega, camiones, productos, obras y pedidos. */
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly data: MasterData) {}

  @Get()
  view() {
    return this.data.view();
  }

  @Put('depot')
  saveDepot(@Body(new ZodValidationPipe(depotSchema)) body: DepotRequest) {
    return this.data.saveDepot(body);
  }

  @Post('vehicles')
  @HttpCode(200)
  saveVehicle(@Body(new ZodValidationPipe(vehicleSchema)) body: VehicleRequest) {
    return this.data.saveVehicle(body);
  }

  @Delete('vehicles/:plate')
  removeVehicle(@Param('plate') plate: string) {
    return this.data.removeVehicle(plate);
  }

  @Post('products')
  @HttpCode(200)
  saveProduct(@Body(new ZodValidationPipe(productSchema)) body: ProductRequest) {
    return this.data.saveProduct(body);
  }

  @Delete('products/:sku')
  removeProduct(@Param('sku') sku: string) {
    return this.data.removeProduct(sku);
  }

  @Post('sites')
  @HttpCode(200)
  saveSite(@Body(new ZodValidationPipe(siteSchema)) body: SiteRequest) {
    return this.data.saveSite(body);
  }

  @Delete('sites/:id')
  removeSite(@Param('id') id: string) {
    return this.data.removeSite(id);
  }

  @Post('orders')
  @HttpCode(200)
  saveOrder(@Body(new ZodValidationPipe(orderSchema)) body: OrderRequest) {
    return this.data.saveOrder(body);
  }

  @Delete('orders/:id')
  removeOrder(@Param('id') id: string) {
    return this.data.removeOrder(id);
  }
}
