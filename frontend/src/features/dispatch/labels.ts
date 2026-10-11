import type { MasterDataView } from '@/types/api';

/** Lo que va impreso en la etiqueta del bulto de un pedido. */
export interface LabelData {
  orderId: string;
  customerName: string | null;
  siteName: string;
  address: string | null;
  commune: string;
  contact: string | null;
  deliveryDate: string | null;
  plate: string | null;
  /** N° de entrega en la ruta del camión. */
  position: number | null;
  units: number;
}

/** Datos de etiqueta de cada pedido, con su camión si ya tiene. */
export function labelsFor(
  orderIds: readonly string[],
  master: MasterDataView,
  trucks: ReadonlyMap<string, { plate: string; position: number | null }> = new Map(),
): LabelData[] {
  return orderIds.flatMap((id) => {
    const order = master.orders.find((o) => o.id === id);
    if (!order) return [];
    const site = master.sites.find((s) => s.id === order.siteId);
    const truck = trucks.get(id);
    return [
      {
        orderId: order.id,
        customerName: order.customerName ?? null,
        siteName: site?.name ?? order.siteName,
        address: site?.address ?? null,
        commune: site?.commune ?? '',
        contact: [site?.contactName, site?.contactPhone].filter(Boolean).join(' · ') || null,
        deliveryDate: order.deliveryDate ?? null,
        plate: truck?.plate ?? null,
        position: truck?.position ?? null,
        units: order.lines.reduce((sum, l) => sum + l.quantity, 0),
      },
    ];
  });
}
