import { useEffect, useRef } from 'react';
import { destinationMarker, toLeaflet, truckMarker, useLeafletMap } from '@/components/map/leaflet';
import type { DeliveryProof } from '@/types/api';

/** Dónde quedó registrada la entrega frente a la obra. */
export function ProofMap({ proof }: { proof: DeliveryProof }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, layerRef } = useLeafletMap(containerRef, 15);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    const items = [destinationMarker(proof.siteLocation, proof.siteName).addTo(layer)];
    const points = [proof.siteLocation];
    if (proof.position) {
      items.push(
        truckMarker(proof.position, 'Entrega', 'Aquí se registró la entrega', 'selected').addTo(
          layer,
        ),
      );
      points.push(proof.position);
    }
    map.fitBounds(points.map(toLeaflet), { padding: [40, 40], maxZoom: 16, animate: false });
    return () => items.forEach((m) => m.remove());
  }, [mapRef, layerRef, proof]);
  return (
    <div
      ref={containerRef}
      className="h-56 w-full overflow-hidden rounded-lg border"
      role="region"
      aria-label="Mapa del punto de entrega"
    />
  );
}
