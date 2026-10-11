import { isValidLatLng, type LatLng } from '../../../common/geo.js';
import type { DeliverySite } from '../../routing/domain/delivery.js';
import { issueMessage } from './import-products.js';
import {
  normalizeIsoDate,
  normalizePhone,
  type MasterDataSnapshot,
  type OrderRecord,
} from './master-data.js';
import {
  cellDate,
  cellNumber,
  cellText,
  headerKey,
  readSheet,
  type Cell,
  type ColumnSpec,
  type RowIssue,
} from './spreadsheet.js';

/** Columnas de la planilla de pedidos: una fila por producto de cada pedido. */
export const ORDER_COLUMNS: readonly ColumnSpec[] = [
  {
    field: 'orderId',
    header: 'N° pedido',
    aliases: ['pedido', 'nro pedido', 'numero pedido', 'número de pedido', 'nota de venta', 'nv'],
    required: true,
    help: 'Número del pedido o nota de venta. Repítalo en cada fila de productos del mismo pedido. Si ya existe, se reemplaza.',
  },
  {
    field: 'customerName',
    header: 'Cliente',
    aliases: ['razón social', 'razon social'],
    required: false,
    help: 'Opcional.',
  },
  {
    field: 'siteName',
    header: 'Obra',
    aliases: ['nombre obra', 'destino', 'lugar de entrega'],
    required: true,
    help: 'Nombre de la obra. Si ya existe con ese nombre y comuna, se usa esa obra.',
  },
  {
    field: 'address',
    header: 'Dirección',
    aliases: ['direccion', 'dirección de entrega', 'domicilio'],
    required: false,
    help: 'Calle y número. Con ella se ubica la obra en el mapa.',
  },
  {
    field: 'commune',
    header: 'Comuna',
    aliases: ['ciudad'],
    required: false,
    help: 'Obligatoria para una obra nueva.',
  },
  {
    field: 'contactName',
    header: 'Contacto',
    aliases: ['recibe', 'contacto obra'],
    required: false,
    help: 'Quién recibe en la obra (opcional).',
  },
  {
    field: 'contactPhone',
    header: 'Teléfono',
    aliases: ['telefono', 'fono', 'celular', 'teléfono contacto'],
    required: false,
    help: 'Teléfono de quien recibe (opcional).',
  },
  {
    field: 'deliveryDate',
    header: 'Fecha de entrega',
    aliases: ['fecha', 'fecha entrega'],
    required: false,
    help: 'Día-mes-año (opcional).',
  },
  {
    field: 'sku',
    header: 'SKU',
    aliases: ['código', 'codigo', 'producto'],
    required: true,
    help: 'Código del producto (debe estar en «Productos»).',
  },
  {
    field: 'quantity',
    header: 'Cantidad',
    aliases: ['cant', 'unidades'],
    required: true,
    help: 'Unidades del producto.',
  },
  {
    field: 'lat',
    header: 'Latitud',
    aliases: ['lat'],
    required: false,
    help: 'Opcional: si la trae, no se busca la dirección.',
  },
  { field: 'lng', header: 'Longitud', aliases: ['lng', 'lon'], required: false, help: 'Opcional.' },
  {
    field: 'notes',
    header: 'Notas',
    aliases: ['observaciones', 'comentario'],
    required: false,
    help: 'Indicaciones para la entrega (opcional).',
  },
];

export interface SiteDraft {
  /** Nombre + comuna normalizados: une las filas de la misma obra. */
  key: string;
  id: string;
  action: 'NUEVA' | 'EXISTENTE' | 'ACTUALIZA';
  name: string;
  commune: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** null: hay que ubicarla (buscando la dirección o en el mapa) antes de importar. */
  location: LatLng | null;
  hasUnloadingEquipment: boolean;
  notifyEtaMinutes: number;
  lines: number[];
}

export interface OrderDraft {
  id: string;
  siteKey: string;
  action: 'NUEVO' | 'ACTUALIZA';
  record: OrderRecord;
  lines: number[];
}

export interface OrderImportPreview {
  sites: SiteDraft[];
  orders: OrderDraft[];
  issues: RowIssue[];
  missingColumns: string[];
}

export interface OrderImport {
  sites: DeliverySite[];
  orders: OrderRecord[];
  /** Pedidos que quedan fuera porque su obra no tiene ubicación. */
  skipped: string[];
}

const siteKey = (name: string, commune: string) => `${headerKey(name)}|${headerKey(commune)}`;

function slug(text: string): string {
  return headerKey(text).replace(/ñ/g, 'n').replace(/\s+/g, '-').toUpperCase();
}

/**
 * Vista previa de la importación de pedidos: agrupa las filas por N° de pedido, reconoce
 * las obras ya registradas (por nombre y comuna) y prepara las nuevas. Un pedido con
 * alguna fila con error queda fuera completo (no se importa a medias).
 */
export function parseOrderSheet(
  table: readonly (readonly Cell[])[],
  data: MasterDataSnapshot,
): OrderImportPreview {
  const sheet = readSheet(table, ORDER_COLUMNS);
  const issues: RowIssue[] = [];
  const sites = new Map<string, SiteDraft>();
  const orders = new Map<string, OrderDraft & { quantities: Map<string, number> }>();
  const failed = new Set<string>();
  const usedIds = new Set(data.sites.map((s) => s.id));

  for (const { line, cells } of sheet.rows) {
    const orderId = cellText(cells.orderId).toUpperCase().replace(/\s+/g, '');
    try {
      if (!orderId) throw new Error('Falta el N° de pedido.');
      if (orderId.length > 40) throw new Error('N° de pedido: máximo 40 caracteres.');
      const siteName = cellText(cells.siteName).replace(/\s+/g, ' ');
      if (siteName.length < 2) throw new Error('Falta el nombre de la obra.');
      const commune = cellText(cells.commune).replace(/\s+/g, ' ');
      const sku = cellText(cells.sku).toUpperCase();
      if (!sku) throw new Error('Falta el SKU.');
      if (!data.products.some((p) => p.sku === sku)) {
        throw new Error(`El producto ${sku} no está en «Productos»: impórtelo primero.`);
      }
      const quantity = cellNumber(cells.quantity, 'Cantidad');
      if (quantity === null || quantity <= 0 || quantity > 100_000) {
        throw new Error('Cantidad: un número mayor que 0.');
      }
      const address = cellText(cells.address).replace(/\s+/g, ' ') || null;
      const contactName = cellText(cells.contactName).replace(/\s+/g, ' ') || null;
      const contactPhone = normalizePhone(cellText(cells.contactPhone), 'Teléfono');
      const deliveryDate = normalizeIsoDate(
        cellDate(cells.deliveryDate, 'Fecha de entrega'),
        'Fecha de entrega',
      );
      const lat = cellNumber(cells.lat, 'Latitud');
      const lng = cellNumber(cells.lng, 'Longitud');
      const location =
        lat !== null && lng !== null && isValidLatLng({ lat, lng }) ? { lat, lng } : null;
      if ((lat !== null || lng !== null) && !location) {
        throw new Error('Latitud y longitud: coordenadas inválidas.');
      }

      const existing =
        data.sites.find((s) => siteKey(s.name, s.commune) === siteKey(siteName, commune)) ??
        (commune === ''
          ? data.sites.find((s) => headerKey(s.name) === headerKey(siteName))
          : undefined);
      const key = existing ? siteKey(existing.name, existing.commune) : siteKey(siteName, commune);
      let site = sites.get(key);
      if (!site) {
        if (!existing && commune.length < 2) {
          throw new Error(`Comuna: obligatoria para la obra nueva «${siteName}».`);
        }
        site = existing
          ? {
              key,
              id: existing.id,
              action: 'EXISTENTE',
              name: existing.name,
              commune: existing.commune,
              address: existing.address ?? null,
              contactName: existing.contactName ?? null,
              contactPhone: existing.contactPhone ?? null,
              location: existing.location,
              hasUnloadingEquipment: existing.hasUnloadingEquipment,
              notifyEtaMinutes: existing.notifyEtaMinutes,
              lines: [],
            }
          : {
              key,
              id: uniqueId(`OBRA-${slug(siteName)}-${slug(commune)}`.slice(0, 72), usedIds),
              action: 'NUEVA',
              name: siteName,
              commune,
              address: null,
              contactName: null,
              contactPhone: null,
              location: null,
              hasUnloadingEquipment: false,
              notifyEtaMinutes: 15,
              lines: [],
            };
        sites.set(key, site);
      }
      // Lo que trae la planilla completa o actualiza la obra (sin borrar con celdas vacías).
      const changed =
        (address !== null && address !== site.address) ||
        (contactName !== null && contactName !== site.contactName) ||
        (contactPhone !== null && contactPhone !== site.contactPhone) ||
        (location !== null && site.action === 'NUEVA' && site.location === null);
      if (changed) {
        site.address = address ?? site.address;
        site.contactName = contactName ?? site.contactName;
        site.contactPhone = contactPhone ?? site.contactPhone;
        if (site.action === 'NUEVA') site.location ??= location;
        if (site.action === 'EXISTENTE') site.action = 'ACTUALIZA';
      }
      if (!site.lines.includes(line)) site.lines.push(line);

      let order = orders.get(orderId);
      if (order && order.siteKey !== key) {
        throw new Error(
          `El pedido ${orderId} ya tiene otra obra (fila ${order.lines[0]}): un pedido va a una sola obra.`,
        );
      }
      if (!order) {
        order = {
          id: orderId,
          siteKey: key,
          action: data.orders.some((o) => o.id === orderId) ? 'ACTUALIZA' : 'NUEVO',
          record: {
            id: orderId,
            siteId: site.id,
            lines: [],
            customerName: null,
            deliveryDate: null,
            notes: null,
          },
          lines: [],
          quantities: new Map(),
        };
        orders.set(orderId, order);
      }
      order.lines.push(line);
      order.quantities.set(sku, (order.quantities.get(sku) ?? 0) + quantity);
      order.record.customerName ??= cellText(cells.customerName).replace(/\s+/g, ' ') || null;
      order.record.deliveryDate ??= deliveryDate;
      order.record.notes ??= cellText(cells.notes) || null;
    } catch (error) {
      issues.push({ line, message: issueMessage(error) });
      if (orderId) failed.add(orderId);
    }
  }

  for (const id of failed) {
    const order = orders.get(id);
    if (!order) continue;
    orders.delete(id);
    issues.push({
      line: order.lines[0],
      message: `El pedido ${id} no se importa: corrija sus filas con error y vuelva a cargar la planilla.`,
    });
  }
  const validOrders = [...orders.values()].map(({ quantities, ...order }) => ({
    ...order,
    record: {
      ...order.record,
      lines: [...quantities].map(([sku, quantity]) => ({ sku, quantity })),
    },
  }));
  const usedSites = new Set(validOrders.map((o) => o.siteKey));
  return {
    sites: [...sites.values()].filter((s) => usedSites.has(s.key)),
    orders: validOrders,
    issues: issues.sort((a, b) => a.line - b.line),
    missingColumns: sheet.missing,
  };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * Lo que se envía a guardar: las obras nuevas o actualizadas (con su ubicación, propia o
 * encontrada por dirección) y los pedidos. Los pedidos de obras sin ubicar quedan fuera.
 */
export function buildOrderImport(
  preview: OrderImportPreview,
  locations: Readonly<Record<string, LatLng>> = {},
): OrderImport {
  const located = new Map<string, DeliverySite>();
  for (const draft of preview.sites) {
    const location = draft.location ?? locations[draft.key] ?? null;
    if (!location) continue;
    located.set(draft.key, {
      id: draft.id,
      name: draft.name,
      commune: draft.commune,
      location,
      hasUnloadingEquipment: draft.hasUnloadingEquipment,
      notifyEtaMinutes: draft.notifyEtaMinutes,
      address: draft.address,
      contactName: draft.contactName,
      contactPhone: draft.contactPhone,
    });
  }
  const orders = preview.orders.filter((o) => located.has(o.siteKey));
  const usedSites = new Set(orders.map((o) => o.siteKey));
  return {
    sites: preview.sites
      .filter((s) => s.action !== 'EXISTENTE' && usedSites.has(s.key))
      .map((s) => located.get(s.key)!),
    orders: orders.map((o) => o.record),
    skipped: preview.orders.filter((o) => !located.has(o.siteKey)).map((o) => o.id),
  };
}
