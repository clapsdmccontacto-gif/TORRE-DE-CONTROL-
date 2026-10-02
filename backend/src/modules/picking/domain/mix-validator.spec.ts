import { DomainError } from '../../../common/domain-error.js';
import type { ProductLine } from '../../catalog/domain/product.js';
import { DEMO_PRODUCTS } from '../../../../test/fixtures/demo-products.js';
import { DEFAULT_CART_SPECS } from './cart.js';
import { DEFAULT_MIX_POLICY, type MixPolicy } from './mix-policy.js';
import { auditCart, checkCartAddition } from './mix-validator.js';

const bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
const line = (sku: string, quantity = 1): ProductLine => ({ product: bySku.get(sku)!, quantity });

const MODULAR = DEFAULT_CART_SPECS.MODULAR;
const LARGOS = DEFAULT_CART_SPECS.CARRO_LARGOS;

describe('checkCartAddition', () => {
  it('permite un carro vacío con una herramienta', () => {
    const result = checkCartAddition(MODULAR, [], line('MAK-HP1630'));
    expect(result.decision).toBe('PERMITIDO');
    expect(result.violations).toEqual([]);
  });

  it('bloquea cemento en un carro con herramientas Makita/Bosch', () => {
    const result = checkCartAddition(
      MODULAR,
      [line('MAK-HP1630'), line('BOS-GWS700')],
      line('CEM-ESP-25', 2),
    );
    expect(result.decision).toBe('BLOQUEADO');
    expect(result.violations.map((v) => [v.rule, v.skus])).toEqual([
      ['MEZCLA_INCOMPATIBLE', ['CEM-ESP-25', 'MAK-HP1630']],
      ['MEZCLA_INCOMPATIBLE', ['CEM-ESP-25', 'BOS-GWS700']],
    ]);
  });

  it('es simétrica: bloquea la herramienta que entra a un carro con cemento', () => {
    const result = checkCartAddition(MODULAR, [line('CEM-ESP-25')], line('MAK-HP1630'));
    expect(result.decision).toBe('BLOQUEADO');
    expect(result.violations[0].rule).toBe('MEZCLA_INCOMPATIBLE');
  });

  it('permite mezclar frágiles entre sí', () => {
    const result = checkCartAddition(MODULAR, [line('CER-MUR-2540', 2)], line('LAV-LOZA-50'));
    expect(result.decision).toBe('PERMITIDO');
  });

  it('advierte (sin bloquear) químicos junto a herramientas', () => {
    const result = checkCartAddition(MODULAR, [line('MAK-HP1630')], line('DIL-SIN-5L'));
    expect(result.decision).toBe('PERMITIDO_CON_ADVERTENCIA');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      rule: 'MEZCLA_INCOMPATIBLE',
      severity: 'ADVERTENCIA',
    });
  });

  it('bloquea un ítem pesado de clase GENERAL junto a frágiles (defensa ante mala clasificación)', () => {
    const result = checkCartAddition(MODULAR, [line('CER-MUR-2540')], line('CLA-COR-4'));
    expect(result.decision).toBe('BLOQUEADO');
    expect(result.violations[0]).toMatchObject({
      rule: 'PESADO_CON_SENSIBLE',
      skus: ['CLA-COR-4', 'CER-MUR-2540'],
    });
  });

  it('no duplica el aviso de peso cuando la matriz de clases ya bloquea el par', () => {
    const result = checkCartAddition(MODULAR, [line('CER-MUR-2540')], line('CEM-ESP-25'));
    expect(result.violations.map((v) => v.rule)).toEqual(['MEZCLA_INCOMPATIBLE']);
  });

  it('bloquea fierros de 6 m en el carro modular', () => {
    const result = checkCartAddition(MODULAR, [], line('FIE-A630-12', 10));
    expect(result.decision).toBe('BLOQUEADO');
    expect(result.violations[0].rule).toBe('LARGO_EXCEDE_CARRO');
  });

  it('acepta fierros en el carro de largos, advirtiendo si hay herramientas', () => {
    const result = checkCartAddition(LARGOS, [line('MAK-HP1630')], line('FIE-A630-12', 10));
    expect(result.decision).toBe('PERMITIDO_CON_ADVERTENCIA');
    expect(result.violations.map((v) => v.rule)).toEqual(['MEZCLA_INCOMPATIBLE']);
  });

  it('advierte cuando el carro llega al 90 % y bloquea al superar la capacidad', () => {
    // Carro modular: 250 kg. Clavos: 25 kg por caja.
    const nearFull = checkCartAddition(MODULAR, [line('CLA-COR-4', 8)], line('CLA-COR-4', 1));
    expect(nearFull.decision).toBe('PERMITIDO_CON_ADVERTENCIA');
    expect(nearFull.violations.map((v) => v.rule)).toEqual(['CARRO_CASI_LLENO']);
    expect(nearFull.load).toMatchObject({ totalWeightKg: 225, weightUtilization: 0.9 });

    const over = checkCartAddition(MODULAR, [line('CLA-COR-4', 10)], line('CLA-COR-4', 1));
    expect(over.decision).toBe('BLOQUEADO');
    expect(over.violations.map((v) => v.rule)).toEqual(['SOBREPESO_CARRO']);
  });

  it('no vuelve a reportar conflictos que ya estaban en el carro', () => {
    // Cemento + taladro ya fue autorizado por un supervisor; entra un lavamanos.
    const result = checkCartAddition(
      DEFAULT_CART_SPECS.PLATAFORMA_PESADA,
      [line('CEM-ESP-25'), line('MAK-HP1630')],
      line('LAV-LOZA-50'),
    );
    expect(result.violations.map((v) => v.skus)).toEqual([['LAV-LOZA-50', 'CEM-ESP-25']]);
  });

  it('respeta una política configurada distinta a la por defecto', () => {
    const strict: MixPolicy = {
      ...DEFAULT_MIX_POLICY,
      classPairRules: [
        { classes: ['HERRAMIENTA', 'QUIMICO'], severity: 'BLOQUEO', reason: 'política estricta' },
      ],
    };
    const result = checkCartAddition(MODULAR, [line('MAK-HP1630')], line('DIL-SIN-5L'), strict);
    expect(result.decision).toBe('BLOQUEADO');
  });

  it('rechaza cantidades no positivas', () => {
    expect(() => checkCartAddition(MODULAR, [], line('MAK-HP1630', 0))).toThrow(DomainError);
  });
});

describe('auditCart', () => {
  it('revisa todas las parejas del carro sin duplicar', () => {
    const result = auditCart(DEFAULT_CART_SPECS.PLATAFORMA_PESADA, [
      line('CEM-ESP-25'),
      line('MAK-HP1630'),
      line('LAV-LOZA-50'),
      line('CEM-ESP-25'),
    ]);
    expect(result.decision).toBe('BLOQUEADO');
    expect(result.violations.map((v) => v.skus)).toEqual([
      ['CEM-ESP-25', 'MAK-HP1630'],
      ['CEM-ESP-25', 'LAV-LOZA-50'],
    ]);
  });
});
