import { computeAxleLoads, maxPayloadWithinAxleLimits } from './axle-load.js';
import type { VehicleType } from './vehicle.js';

// Vehículo con números redondos: L = 4 m, plataforma de 4 m que parte 1 m detrás del eje delantero.
const truck: VehicleType = {
  code: 'TEST',
  name: 'Camión de prueba',
  sizeRank: 1,
  gvwrKg: 10_000,
  cargo: { lengthM: 4, widthM: 2, heightM: 2, stowageFactor: 1, maxRearOverhangM: 0 },
  wheelbaseM: 4,
  cargoStartFromFrontAxleM: 1,
  frontAxle: { type: 'SIMPLE_RUEDA_SIMPLE', tareKg: 2_000, ratingKg: 4_000 },
  rearAxle: { type: 'SIMPLE_RUEDA_DOBLE', tareKg: 1_000, ratingKg: 6_000 },
  craneMaxLiftKg: null,
  costPerKm: 1,
};

describe('computeAxleLoads', () => {
  it('reparte la carga con la regla de la palanca (centro de gravedad al centro)', () => {
    // x = 1 + 2 = 3 m → el eje trasero toma 3/4 de la carga.
    const loads = computeAxleLoads(truck, 4_000);
    expect(loads.rearKg).toBe(1_000 + 3_000);
    expect(loads.frontKg).toBe(2_000 + 1_000);
    expect(loads.frontShare).toBeCloseTo(3_000 / 7_000);
  });

  it('descarga el eje delantero cuando la carga queda detrás del eje trasero', () => {
    // x = 1 + 4 = 5 m > L → el eje delantero pierde 1/4 de la carga.
    const loads = computeAxleLoads(truck, 4_000, 1);
    expect(loads.rearKg).toBe(6_000);
    expect(loads.frontKg).toBe(1_000);
  });

  it('usa el menor entre el límite legal chileno y la capacidad del fabricante', () => {
    expect(computeAxleLoads(truck, 0)).toMatchObject({ frontLimitKg: 4_000, rearLimitKg: 6_000 });

    const heavyDuty = { ...truck, rearAxle: { ...truck.rearAxle, ratingKg: 13_000 } };
    expect(computeAxleLoads(heavyDuty, 0).rearLimitKg).toBe(11_000);
  });
});

describe('maxPayloadWithinAxleLimits', () => {
  it('queda limitada por el eje trasero con la carga centrada', () => {
    // PBV permite 7.000 kg, pero el eje trasero sólo admite (6.000 − 1.000) / 0,75.
    expect(maxPayloadWithinAxleLimits(truck, 0.2)).toBeCloseTo(5_000 / 0.75);
  });

  it('queda limitada por el peso mínimo sobre la dirección con la carga en la cola', () => {
    const payload = maxPayloadWithinAxleLimits(truck, 0.2, 1);
    expect(payload).toBeCloseTo((2_000 - 0.2 * 3_000) / 0.45);
    expect(computeAxleLoads(truck, payload, 1).frontShare).toBeCloseTo(0.2);
  });
});
