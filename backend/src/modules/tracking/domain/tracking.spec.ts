import {
  deviceStatus,
  etaMinutes,
  evaluateFix,
  progressStops,
  summarizeTrack,
  type PositionFix,
  type TrackedStop,
} from './tracking.js';

const fix = (
  lat: number,
  lng: number,
  at: string,
  extra: Partial<PositionFix> = {},
): PositionFix => ({
  lat,
  lng,
  accuracyM: 10,
  speedKmh: null,
  headingDeg: null,
  recordedAt: at,
  ...extra,
});

describe('evaluateFix', () => {
  const previous = fix(-37.461, -72.339, '2026-10-02T12:00:00Z');

  it('acepta una lectura coherente', () => {
    expect(evaluateFix(previous, fix(-37.462, -72.34, '2026-10-02T12:00:10Z'))).toEqual({
      accepted: true,
    });
  });

  it('descarta lecturas imprecisas, fuera de orden o con saltos imposibles', () => {
    expect(
      evaluateFix(null, fix(-37.46, -72.34, '2026-10-02T12:00:00Z', { accuracyM: 350 })),
    ).toEqual({
      accepted: false,
      reason: 'PRECISION_BAJA',
    });
    expect(evaluateFix(previous, fix(-37.46, -72.34, '2026-10-02T11:59:00Z'))).toMatchObject({
      reason: 'FUERA_DE_ORDEN',
    });
    // 10 km en 10 segundos = 3.600 km/h.
    expect(evaluateFix(previous, fix(-37.55, -72.339, '2026-10-02T12:00:10Z'))).toMatchObject({
      reason: 'SALTO_IMPOSIBLE',
    });
    expect(evaluateFix(null, fix(Number.NaN, -72.3, '2026-10-02T12:00:00Z'))).toMatchObject({
      reason: 'COORDENADA_INVALIDA',
    });
  });
});

describe('deviceStatus', () => {
  const last = fix(-37.46, -72.34, '2026-10-02T12:00:00Z');
  const now = Date.parse('2026-10-02T12:01:00Z');

  it('distingue en movimiento, detenido y sin señal', () => {
    expect(deviceStatus(last, 42, now)).toBe('EN_MOVIMIENTO');
    expect(deviceStatus(last, 1, now)).toBe('DETENIDO');
    expect(deviceStatus(last, 42, now + 5 * 60_000)).toBe('SIN_SENAL');
    expect(deviceStatus(null, null, now)).toBe('SIN_SENAL');
  });
});

describe('summarizeTrack', () => {
  it('suma distancia, duración y velocidad máxima', () => {
    const summary = summarizeTrack([
      fix(-37.0, -72.3, '2026-10-02T12:00:00Z'),
      fix(-37.01, -72.3, '2026-10-02T12:01:00Z'),
      fix(-37.02, -72.3, '2026-10-02T12:02:00Z'),
    ]);
    expect(summary.distanceKm).toBeCloseTo(2.224, 2);
    expect(summary.durationMin).toBe(2);
    expect(summary.maxSpeedKmh).toBeCloseTo(66.7, 0);
  });
});

describe('etaMinutes', () => {
  it('usa la velocidad típica cuando el camión va lento', () => {
    const from = { lat: -37.0, lng: -72.3 };
    const to = { lat: -37.1, lng: -72.3 }; // 11,1 km × 1,3 = 14,5 km
    expect(etaMinutes(from, to, 80)).toBeCloseTo((14.455 / 80) * 60, 0);
    expect(etaMinutes(from, to, 5)).toBeCloseTo((14.455 / 40) * 60, 0);
  });
});

describe('progressStops', () => {
  const obra = { lat: -37.5, lng: -72.3 };
  const stops: TrackedStop[] = [
    {
      deliveryId: 'NV-1',
      siteName: 'Obra 1',
      location: obra,
      notifyEtaMinutes: 15,
      state: 'PENDIENTE',
      proximityNotified: false,
    },
    {
      deliveryId: 'NV-2',
      siteName: 'Obra 2',
      location: { lat: -37.6, lng: -72.3 },
      notifyEtaMinutes: 15,
      state: 'PENDIENTE',
      proximityNotified: false,
    },
  ];

  it('avisa al capataz una sola vez, marca llegada y salida, y pasa a la siguiente obra', () => {
    // A ~22 km: sin aviso todavía.
    let progress = progressStops(stops, { lat: -37.3, lng: -72.3 }, 45);
    expect(progress.events).toEqual([]);

    // A ~5,6 km (≈ 9 min): aviso de proximidad.
    progress = progressStops(progress.stops, { lat: -37.45, lng: -72.3 }, 45);
    expect(progress.events.map((e) => e.type)).toEqual(['AVISO_PROXIMIDAD']);

    // Más cerca: no repite el aviso.
    progress = progressStops(progress.stops, { lat: -37.47, lng: -72.3 }, 45);
    expect(progress.events).toEqual([]);

    // Dentro del radio de la obra.
    progress = progressStops(progress.stops, { lat: -37.5005, lng: -72.3 }, 2);
    expect(progress.events.map((e) => e.type)).toEqual(['LLEGADA_OBRA']);
    expect(progress.stops[0].state).toBe('EN_OBRA');

    // Sale de la obra: queda completada y la ETA apunta a la siguiente.
    progress = progressStops(progress.stops, { lat: -37.51, lng: -72.3 }, 40);
    expect(progress.events.map((e) => e.type)).toEqual(['SALIDA_OBRA']);
    expect(progress.stops.map((s) => s.state)).toEqual(['COMPLETADA', 'PENDIENTE']);
    expect(progress.nextStopEtaMin).toBeGreaterThan(15);
  });
});
