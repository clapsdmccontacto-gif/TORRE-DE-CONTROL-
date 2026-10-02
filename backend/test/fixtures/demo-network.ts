import type { LatLng } from '../../src/common/geo.js';
import type { ProductLine } from '../../src/modules/catalog/domain/product.js';
import { DEFAULT_FLEET } from '../../src/modules/load-planning/infrastructure/default-fleet.js';
import type { DeliveryOrder, DeliverySite } from '../../src/modules/routing/domain/delivery.js';
import type { FleetUnit } from '../../src/modules/routing/domain/optimizer.js';
import { DEMO_PRODUCTS } from './demo-products.js';

/**
 * Red de prueba: sólo la usan los tests (la app parte vacía; bodega, obras, pedidos y
 * camiones se cargan en la interfaz). Coordenadas aproximadas; obras y pedidos ficticios.
 */
export const DEMO_DEPOT: { name: string; location: LatLng } = {
  name: 'Bodega Los Ángeles',
  location: { lat: -37.461, lng: -72.339 },
};

export const DEMO_SITES: readonly DeliverySite[] = [
  site('OBRA-ARAUCARIAS', 'Edificio Las Araucarias', 'Los Ángeles', -37.472, -72.356),
  site('OBRA-STA-BARBARA', 'Condominio Santa Bárbara', 'Santa Bárbara', -37.665, -72.02),
  site('OBRA-NACIMIENTO', 'Galpón Nacimiento', 'Nacimiento', -37.5, -72.67, true),
  site('OBRA-MULCHEN', 'Ampliación Liceo Mulchén', 'Mulchén', -37.7186, -72.2406),
  site('OBRA-LAJA', 'Viviendas Laja Oriente', 'Laja', -37.28, -72.71),
  site('OBRA-CABRERO', 'Bodega agrícola Cabrero', 'Cabrero', -37.035, -72.405, true),
  site('OBRA-NEGRETE', 'Sede social Negrete', 'Negrete', -37.587, -72.53),
  site('OBRA-LA-NORTE', 'Condominio Sector Norte', 'Los Ángeles', -37.448, -72.33),
  site('OBRA-LA-SUR', 'Casas Sector Sur', 'Los Ángeles', -37.493, -72.352),
  site('OBRA-LA-PONIENTE', 'Ampliación Colegio Poniente', 'Los Ángeles', -37.465, -72.38),
];

/** Pedidos para mañana: nota de venta, obra y líneas (SKU, cantidad). */
const ORDERS: readonly [string, string, [string, number][]][] = [
  [
    'NV-100231',
    'OBRA-ARAUCARIAS',
    [
      ['CEM-ESP-25', 60],
      ['MAK-HP1630', 2],
      ['BOS-GWS700', 1],
      ['CER-MUR-2540', 10],
    ],
  ],
  [
    'NV-100232',
    'OBRA-STA-BARBARA',
    [
      ['FIE-A630-12', 40],
      ['OSB-11-1224', 20],
    ],
  ],
  [
    'NV-100233',
    'OBRA-NACIMIENTO',
    [
      ['ARE-MAXI-1M3', 2],
      ['DIL-SIN-5L', 5],
    ],
  ],
  [
    'NV-100234',
    'OBRA-MULCHEN',
    [
      ['CEM-ESP-25', 80],
      ['CLA-COR-4', 30],
    ],
  ],
  [
    'NV-100235',
    'OBRA-LAJA',
    [
      ['MAK-HP1630', 3],
      ['BOS-GWS700', 2],
      ['DIL-SIN-5L', 4],
    ],
  ],
  ['NV-100236', 'OBRA-CABRERO', [['OSB-11-1224', 30]]],
  [
    'NV-100237',
    'OBRA-NEGRETE',
    [
      ['CER-MUR-2540', 20],
      ['LAV-LOZA-50', 6],
    ],
  ],
  [
    'NV-100238',
    'OBRA-LA-NORTE',
    [
      ['CEM-ESP-25', 30],
      ['MAK-HP1630', 2],
    ],
  ],
  ['NV-100239', 'OBRA-LA-SUR', [['FIE-A630-12', 60]]],
  [
    'NV-100240',
    'OBRA-LA-PONIENTE',
    [
      ['CER-MUR-2540', 10],
      ['LAV-LOZA-50', 4],
      ['BOS-GWS700', 1],
    ],
  ],
];

const productBySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
const siteById = new Map(DEMO_SITES.map((s) => [s.id, s]));

export const DEMO_ORDERS: readonly DeliveryOrder[] = ORDERS.map(([id, siteId, lines]) => ({
  id,
  site: siteById.get(siteId)!,
  lines: lines.map(([sku, quantity]): ProductLine => ({
    product: productBySku.get(sku)!,
    quantity,
  })),
}));

/** Vehículos de prueba. */
export const DEMO_UNITS: readonly FleetUnit[] = (
  [
    ['DEMO-01', 'CAMIONETA'],
    ['DEMO-02', 'CAMION_3_4'],
    ['DEMO-03', 'CAMION_3_4'],
    ['DEMO-04', 'CAMION_PLUMA'],
  ] as const
).map(([plate, code]) => ({ plate, vehicle: DEFAULT_FLEET.find((v) => v.code === code)! }));

function site(
  id: string,
  name: string,
  commune: string,
  lat: number,
  lng: number,
  hasUnloadingEquipment = false,
): DeliverySite {
  return { id, name, commune, location: { lat, lng }, hasUnloadingEquipment, notifyEtaMinutes: 15 };
}
