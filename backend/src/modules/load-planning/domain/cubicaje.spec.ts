import { DomainError } from '../../../common/domain-error.js';
import type { ProductLine } from '../../catalog/domain/product.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import { DEFAULT_FLEET } from '../infrastructure/default-fleet.js';
import { buildLoadProfile, planLoad } from './cubicaje.js';

const bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
const line = (sku: string, quantity = 1): ProductLine => ({ product: bySku.get(sku)!, quantity });
const issueCodes = (result: ReturnType<typeof planLoad>, vehicleCode: string) =>
  result.evaluations.find((e) => e.vehicleCode === vehicleCode)!.issues.map((i) => i.code);

describe('planLoad', () => {
  it('asigna camioneta a un pedido chico de herramientas', () => {
    const result = planLoad([line('MAK-HP1630', 2), line('BOS-GWS700')], DEFAULT_FLEET);
    expect(result.recommendation?.vehicleCode).toBe('CAMIONETA');
    expect(result.splitSuggestion).toBeNull();
    expect(result.evaluations.map((e) => e.vehicleCode)).toEqual([
      'CAMIONETA',
      'CAMION_3_4',
      'CAMION_PLUMA',
    ]);
  });

  it('pasa a camión 3/4 cuando el peso supera la carga útil de la camioneta', () => {
    const result = planLoad([line('CEM-ESP-25', 60)], DEFAULT_FLEET);
    expect(result.profile.totalWeightKg).toBe(1_500);
    expect(issueCodes(result, 'CAMIONETA')).toEqual(['EXCEDE_CARGA_UTIL']);
    expect(result.recommendation).toMatchObject({
      vehicleCode: 'CAMION_3_4',
      weightUtilization: 0.4,
    });
  });

  it('exige camión pluma para fierros de 6 m por largo', () => {
    const result = planLoad([line('FIE-A630-12', 40)], DEFAULT_FLEET);
    expect(issueCodes(result, 'CAMIONETA')).toContain('EXCEDE_LARGO');
    expect(issueCodes(result, 'CAMION_3_4')).toEqual(['EXCEDE_LARGO']);
    expect(result.recommendation?.vehicleCode).toBe('CAMION_PLUMA');
  });

  it('exige pluma para un maxisaco salvo que la obra tenga equipo de descarga', () => {
    const lines = [line('ARE-MAXI-1M3')];

    const withoutEquipment = planLoad(lines, DEFAULT_FLEET);
    expect(issueCodes(withoutEquipment, 'CAMION_3_4')).toEqual(['REQUIERE_PLUMA']);
    expect(withoutEquipment.recommendation?.vehicleCode).toBe('CAMION_PLUMA');

    const withEquipment = planLoad(lines, DEFAULT_FLEET, { siteHasUnloadingEquipment: true });
    expect(withEquipment.recommendation?.vehicleCode).toBe('CAMION_3_4');
  });

  it('detecta sobrecarga del eje trasero cuando la carga va en la cola', () => {
    const lines = [line('CEM-ESP-25', 100)]; // 2.500 kg

    expect(planLoad(lines, DEFAULT_FLEET).recommendation?.vehicleCode).toBe('CAMION_3_4');

    const atTail = planLoad(lines, DEFAULT_FLEET, { loadCenterRatio: 1 });
    expect(issueCodes(atTail, 'CAMION_3_4')).toEqual([
      'SOBRECARGA_EJE_TRASERO',
      'EJE_DELANTERO_DESCARGADO',
    ]);
    expect(atTail.recommendation?.vehicleCode).toBe('CAMION_PLUMA');
  });

  it('sugiere dividir en viajes cuando nada cabe en uno, eligiendo el menor costo', () => {
    const result = planLoad([line('CEM-ESP-25', 400)], DEFAULT_FLEET); // 10.000 kg
    expect(result.recommendation).toBeNull();
    // 3 viajes × 900 CLP/km (3/4) < 2 viajes × 1.600 CLP/km (pluma) < 11 viajes en camioneta.
    expect(result.splitSuggestion).toMatchObject({
      vehicleCode: 'CAMION_3_4',
      trips: 3,
      maxPayloadPerTripKg: 3_750,
    });
  });

  it('no sugiere dividir en vehículos con problemas indivisibles (largo)', () => {
    const result = planLoad([line('CEM-ESP-25', 400), line('FIE-A630-12', 40)], DEFAULT_FLEET);
    expect(result.splitSuggestion).toMatchObject({ vehicleCode: 'CAMION_PLUMA', trips: 2 });
  });

  it('rechaza una carga vacía', () => {
    expect(() => planLoad([], DEFAULT_FLEET)).toThrow(DomainError);
  });
});

describe('buildLoadProfile', () => {
  it('aplica el límite de manipulación manual de 25 kg (Ley 20.949)', () => {
    const cement = bySku.get('CEM-ESP-25')!;
    const atLimit = buildLoadProfile([{ product: cement, quantity: 1 }], 25);
    expect(atLimit.mechanicalUnloadSkus).toEqual([]);

    const overLimit = buildLoadProfile(
      [{ product: { ...cement, unitWeightKg: 25.5 }, quantity: 1 }],
      25,
    );
    expect(overLimit.mechanicalUnloadSkus).toEqual(['CEM-ESP-25']);
  });
});
