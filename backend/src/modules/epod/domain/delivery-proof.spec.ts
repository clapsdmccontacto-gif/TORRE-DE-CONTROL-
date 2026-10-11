import {
  buildProof,
  deliveryDistance,
  deliveryOutcome,
  parseImageDataUrl,
  type DeliverySubmission,
  type OrderForProof,
} from './delivery-proof.js';

// Imagen de prueba: ~600 bytes en base64 (el contenido no importa para las reglas).
const IMAGE = `data:image/jpeg;base64,${'A'.repeat(800)}`;
const order: OrderForProof = {
  id: 'NV-801',
  customerName: 'Constructora Sur',
  siteName: 'Edificio Las Rosas',
  siteAddress: 'Av. Alemania 1234',
  commune: 'Los Ángeles',
  siteLocation: { lat: -37.4651, lng: -72.3509 },
  lines: [
    { sku: 'CEM-25', name: 'Cemento 25 kg', quantity: 40 },
    { sku: 'FIE-12', name: 'Fierro 12 mm', quantity: 30 },
  ],
};
const submission: DeliverySubmission = {
  id: 'POD-0123456789',
  orderId: 'NV-801',
  sessionId: 'RUTA-1',
  receiverName: '  Juan   Pérez ',
  receiverRut: '12.345.678-5',
  lines: [
    { sku: 'cem-25', delivered: 40 },
    { sku: 'FIE-12', delivered: 30 },
  ],
  reason: null,
  signature: IMAGE,
  photos: [IMAGE],
  position: { lat: -37.4652, lng: -72.351, accuracyM: 8 },
  capturedAt: '2026-10-15T14:05:00-03:00',
};
const context = {
  vehiclePlate: 'LXCD21',
  driverName: 'Pedro Soto',
  receivedAt: '2026-10-15T17:05:03.000Z',
  imageIds: ['IMG-1', 'IMG-2', 'IMG-3'],
};

describe('comprobante de entrega', () => {
  it('arma el comprobante con quien recibe, cantidades, fotos y distancia a la obra', () => {
    const { proof, images } = buildProof(submission, order, context);
    expect(proof).toMatchObject({
      outcome: 'ENTREGADO',
      receiverName: 'Juan Pérez',
      receiverRut: '12345678-5',
      vehiclePlate: 'LXCD21',
      farFromSite: false,
      capturedAt: '2026-10-15T17:05:00.000Z',
      images: [
        { id: 'IMG-1', kind: 'FIRMA' },
        { id: 'IMG-2', kind: 'FOTO' },
      ],
    });
    expect(proof.distanceM).toBeLessThan(20);
    expect(images.map((i) => [i.kind, i.mime])).toEqual([
      ['FIRMA', 'image/jpeg'],
      ['FOTO', 'image/jpeg'],
    ]);
  });

  it('entrega parcial o rechazo piden motivo; el rechazo no exige firma ni RUT', () => {
    expect(() =>
      buildProof(
        {
          ...submission,
          lines: [
            { sku: 'CEM-25', delivered: 40 },
            { sku: 'FIE-12', delivered: 10 },
          ],
        },
        order,
        context,
      ),
    ).toThrow('Indique el motivo de la entrega parcial.');
    const partial = buildProof(
      {
        ...submission,
        lines: [
          { sku: 'CEM-25', delivered: 40 },
          { sku: 'FIE-12', delivered: 10 },
        ],
        reason: 'Faltaron 20 fierros',
      },
      order,
      context,
    );
    expect(partial.proof.outcome).toBe('ENTREGA_PARCIAL');
    const rejected = buildProof(
      {
        ...submission,
        lines: [
          { sku: 'CEM-25', delivered: 0 },
          { sku: 'FIE-12', delivered: 0 },
        ],
        reason: 'Obra cerrada, nadie recibe',
        receiverName: null,
        receiverRut: null,
        signature: null,
      },
      order,
      context,
    );
    expect(rejected.proof).toMatchObject({ outcome: 'RECHAZADO', receiverRut: null });
    expect(rejected.images.map((i) => i.kind)).toEqual(['FOTO']);
  });

  it('exige RUT válido, firma, foto y cantidades del pedido', () => {
    const fails = (patch: Partial<DeliverySubmission>, message: string) =>
      expect(() => buildProof({ ...submission, ...patch }, order, context)).toThrow(message);
    fails({ receiverRut: '12.345.678-6' }, 'El RUT de quien recibe no es válido.');
    fails({ receiverRut: null }, 'Escriba el RUT de quien recibe.');
    fails({ signature: null }, 'Falta la firma de quien recibe.');
    fails({ photos: [] }, 'Falta la foto del lugar de entrega.');
    fails({ photos: [IMAGE, IMAGE, IMAGE] }, 'Se admiten hasta 2 fotos.');
    fails(
      { lines: [{ sku: 'CEM-25', delivered: 40 }] },
      'Falta la cantidad entregada de Fierro 12 mm.',
    );
    fails(
      { lines: [...submission.lines, { sku: 'OTRO', delivered: 1 }] },
      'El pedido no tiene OTRO.',
    );
    fails(
      {
        lines: [
          { sku: 'CEM-25', delivered: 41 },
          { sku: 'FIE-12', delivered: 30 },
        ],
      },
      'entre 0 y 40',
    );
  });

  it('marca para revisar una entrega a más de 300 m de la obra', () => {
    expect(deliveryDistance(null, order.siteLocation)).toEqual({
      distanceM: null,
      farFromSite: false,
    });
    const far = deliveryDistance({ lat: -37.47, lng: -72.3509 }, order.siteLocation);
    expect(far.distanceM).toBeGreaterThan(500);
    expect(far.farFromSite).toBe(true);
  });

  it('acepta sólo imágenes JPEG, PNG o WebP de hasta 1 MB', () => {
    expect(parseImageDataUrl(IMAGE, 'FOTO').mime).toBe('image/jpeg');
    expect(() => parseImageDataUrl('data:image/gif;base64,AAAA', 'FOTO')).toThrow(
      'no es una imagen',
    );
    expect(() =>
      parseImageDataUrl(`data:image/png;base64,${'A'.repeat(1_400_000)}`, 'FIRMA'),
    ).toThrow('el máximo es 1 MB');
  });

  it('resultado según lo entregado', () => {
    const line = (ordered: number, delivered: number) => ({
      sku: 'X',
      name: 'X',
      ordered,
      delivered,
    });
    expect(deliveryOutcome([line(5, 5), line(2, 2)])).toBe('ENTREGADO');
    expect(deliveryOutcome([line(5, 5), line(2, 0)])).toBe('ENTREGA_PARCIAL');
    expect(deliveryOutcome([line(5, 0), line(2, 0)])).toBe('RECHAZADO');
  });
});
