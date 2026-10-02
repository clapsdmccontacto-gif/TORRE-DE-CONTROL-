import type { LatLng } from '@/types/api';

/** "-37.4693, -72.3527" o un enlace de Google Maps con "@-37.46,-72.35" o "q=-37.46,-72.35". */
export function parseLatLng(text: string): LatLng | null {
  const match = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
