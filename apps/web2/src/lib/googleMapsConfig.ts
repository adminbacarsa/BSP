/** Configuración central Google Maps — Operaciones CC y futuros rondines. */
export const GOOGLE_MAPS_LIBRARIES: ('geometry' | 'drawing' | 'places')[] = ['geometry'];

export function getGoogleMapsApiKey(): string {
  return String(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}

export function isGoogleMapsEnabled(): boolean {
  return getGoogleMapsApiKey().length > 0;
}

/** Estilo mapa operativo (Centro de Comando). */
export const OPERACIONES_MAP_OPTIONS = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
  gestureHandling: 'greedy',
  styles: [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ],
};

export const DEFAULT_MAP_CENTER = { lat: -31.4201, lng: -64.1888 };

export function toLatLng(center: [number, number] | { lat: number; lng: number } | undefined): { lat: number; lng: number } {
  if (!center) return DEFAULT_MAP_CENTER;
  if (Array.isArray(center)) return { lat: center[0], lng: center[1] };
  return center;
}
