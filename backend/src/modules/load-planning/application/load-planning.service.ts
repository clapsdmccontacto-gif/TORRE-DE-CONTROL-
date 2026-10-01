import { Injectable } from '@nestjs/common';
import { ProductCatalog } from '../../catalog/application/product-catalog.port.js';
import { resolveLines } from '../../catalog/application/resolve-lines.js';
import { planLoad, type CubicajeResult } from '../domain/cubicaje.js';
import { maxItemLengthM, maxPayloadKg, tareKg, usableVolumeM3 } from '../domain/vehicle.js';
import type { CubicajeRequest } from '../http/load-planning.schemas.js';
import { FleetCatalog } from './fleet-catalog.port.js';

@Injectable()
export class LoadPlanningService {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly fleet: FleetCatalog,
  ) {}

  async listVehicleTypes() {
    const vehicles = await this.fleet.list();
    return vehicles.map((v) => ({
      ...v,
      tareKg: tareKg(v),
      maxPayloadKg: maxPayloadKg(v),
      usableVolumeM3: usableVolumeM3(v),
      maxItemLengthM: maxItemLengthM(v),
    }));
  }

  async simulate(request: CubicajeRequest): Promise<CubicajeResult> {
    const lines = await resolveLines(this.catalog, request.lines);
    return planLoad(lines, await this.fleet.list(), {
      siteHasUnloadingEquipment: request.siteHasUnloadingEquipment,
      loadCenterRatio: request.loadCenterRatio,
    });
  }
}
