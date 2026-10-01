import { Injectable } from '@nestjs/common';
import { FleetCatalog } from '../application/fleet-catalog.port.js';
import type { VehicleType } from '../domain/vehicle.js';
import { DEFAULT_FLEET } from './default-fleet.js';

@Injectable()
export class InMemoryFleetCatalog extends FleetCatalog {
  async list(): Promise<VehicleType[]> {
    return [...DEFAULT_FLEET];
  }
}
