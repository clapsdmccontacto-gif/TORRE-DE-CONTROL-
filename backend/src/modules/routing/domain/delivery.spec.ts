import { DEFAULT_FLEET } from '../../load-planning/infrastructure/default-fleet.js';
import { DEMO_ORDERS } from '../infrastructure/demo-network.js';
import { toDeliveryRequest } from './delivery.js';

const order = (id: string) => DEMO_ORDERS.find((o) => o.id === id)!;

describe('toDeliveryRequest', () => {
  it('sólo admite camión pluma para fierros de 6 m', () => {
    expect(toDeliveryRequest(order('NV-100232'), DEFAULT_FLEET).allowedVehicleCodes).toEqual([
      'CAMION_PLUMA',
    ]);
  });

  it('admite camión 3/4 para maxisacos cuando la obra tiene equipo de descarga', () => {
    const withEquipment = toDeliveryRequest(order('NV-100233'), DEFAULT_FLEET);
    expect(withEquipment.allowedVehicleCodes).toEqual(['CAMION_3_4', 'CAMION_PLUMA']);

    const base = order('NV-100233');
    const withoutEquipment = toDeliveryRequest(
      { ...base, site: { ...base.site, hasUnloadingEquipment: false } },
      DEFAULT_FLEET,
    );
    expect(withoutEquipment.allowedVehicleCodes).toEqual(['CAMION_PLUMA']);
  });

  it('estima la descarga según el peso', () => {
    const request = toDeliveryRequest(order('NV-100231'), DEFAULT_FLEET);
    expect(request.weightKg).toBeCloseTo(1676.7);
    expect(request.serviceMinutes).toBe(32);
  });
});
