/** Configuración central Google Maps — Operaciones CC y futuros rondines. */
export const GOOGLE_MAPS_LIBRARIES: ('geometry' | 'drawing' | 'places')[] = ['geometry'];

export function getEnvGoogleMapsApiKey(): string {
  return String(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}

/** Prioridad: key de empresa (Firestore) → env NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. */
export function getGoogleMapsApiKey(runtimeKey?: string | null): string {
  const fromEmpresa = String(runtimeKey ?? '').trim();
  if (fromEmpresa) return fromEmpresa;
  return getEnvGoogleMapsApiKey();
}

export function isGoogleMapsEnabled(runtimeKey?: string | null): boolean {
  return getGoogleMapsApiKey(runtimeKey).length > 0;
}

/**
 * Estilo mapa operativo — claro/legible (no night mode).
 * Terreno suave slate, calles blancas, agua azul, pines de estado destacan.
 */
export const OPERACIONES_MAP_STYLES: Array<Record<string, unknown>> = [
  { elementType: 'geometry', stylers: [{ color: '#e8eef5' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d4e8d4' }, { visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fde68a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#f59e0b' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#93c5fd' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1e40af' }] },
];

export const OPERACIONES_MAP_OPTIONS = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
  gestureHandling: 'greedy',
  styles: OPERACIONES_MAP_STYLES,
};

export const DEFAULT_MAP_CENTER = { lat: -31.4201, lng: -64.1888 };

export function toLatLng(center: [number, number] | { lat: number; lng: number } | undefined): { lat: number; lng: number } {
  if (!center) return DEFAULT_MAP_CENTER;
  if (Array.isArray(center)) return { lat: center[0], lng: center[1] };
  return center;
}
