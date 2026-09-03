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

/** Estilo mapa operativo (Centro de Comando). */
export const OPERACIONES_MAP_STYLES: Array<Record<string, unknown>> = [
  { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1e293b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#475569' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
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
