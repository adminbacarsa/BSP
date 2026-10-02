import { useMemo } from 'react';
import { buildOperacionesMapMarkers, type OperacionesMapMarker } from '@/lib/operaciones/mapMarkersBuild';

export type { OperacionesMapMarker } from '@/lib/operaciones/mapMarkersBuild';

/**
 * Pines del mapa táctico: uno por objetivo con geo y uno por evento · servicio en la
 * ubicación del evento (lógica pura en `lib/operaciones/mapMarkersBuild.ts`).
 */
export function useOperacionesMapMarkers(allObjectives: any[] = [], filteredShifts: any[] = []): OperacionesMapMarker[] {
  return useMemo(() => buildOperacionesMapMarkers(allObjectives, filteredShifts, new Date()), [allObjectives, filteredShifts]);
}
