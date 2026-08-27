import { useMemo } from 'react';
import type { OperacionesMarkerPreset } from '@/lib/operaciones/mapMarkerIcons';

export type OperacionesMapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  client: string;
  shifts: any[];
  iconPreset: OperacionesMarkerPreset;
  statusText: string;
  hasShift: boolean;
  layerOrder: number;
};

export function useOperacionesMapMarkers(allObjectives: any[] = [], filteredShifts: any[] = []): OperacionesMapMarker[] {
  return useMemo(() => {
    const normId = (x: any) => String(x ?? '').trim();

    return allObjectives
      .filter(
        (obj: any) =>
          obj != null &&
          obj.lat != null &&
          obj.lng != null &&
          Number.isFinite(Number(obj.lat)) &&
          Number.isFinite(Number(obj.lng)),
      )
      .map((obj: any) => {
        const shiftsInObjective = filteredShifts.filter((s: any) => normId(s.objectiveId) === normId(obj.id));

        let iconPreset: OperacionesMarkerPreset = 'GRAY';
        let statusText = 'S/A';
        let priority = 0;

        if (shiftsInObjective.length > 0) {
          shiftsInObjective.forEach((s: any) => {
            const now = new Date();
            const start = s.shiftDateObj
              ? s.shiftDateObj.seconds
                ? new Date(s.shiftDateObj.seconds * 1000)
                : s.shiftDateObj
              : new Date();
            const diffMin = (now.getTime() - start.getTime()) / 60000;
            const isReportedOrReturned = s.isUnassigned && s.isReportedToPlanning;

            if (isReportedOrReturned && priority < 5) {
              const isReturned = s.status === 'UNCOVERED_REPORTED' || s.origin === 'INTERRUPTION';
              iconPreset = 'VIOLET';
              statusText = isReturned ? 'DEVUELTA A PLANIF.' : 'VACANTE REPORTADA';
              priority = 5;
            } else if ((s.isUnassigned || s.isAbsent || s.isPotentialAbsence) && priority < 5) {
              iconPreset = 'RED';
              statusText = s.isUnassigned ? 'VACANTE' : 'AUSENCIA';
              priority = 5;
            } else if (s.isRetention && priority < 4) {
              iconPreset = 'ORANGE';
              statusText = 'RETENCIÓN';
              priority = 4;
            } else if (
              !s.isPresent &&
              !s.isAbsent &&
              !s.isPotentialAbsence &&
              !s.isCompleted &&
              !s.isFranco &&
              diffMin > 5 &&
              priority < 3
            ) {
              iconPreset = 'YELLOW';
              statusText = 'TARDE';
              priority = 3;
            } else if ((s.isPresent || (diffMin >= -15 && diffMin <= 5 && !s.isPresent)) && priority < 2) {
              iconPreset = 'GREEN';
              statusText = s.isPresent ? 'ACTIVO' : 'A TIEMPO';
              priority = 2;
            } else if (s.isFranco && priority < 1) {
              iconPreset = 'BLUE';
              statusText = 'FRANCO';
              priority = 1;
            }
          });
        }

        const layerOrder = statusText === 'S/A' ? 0 : 1;

        return {
          id: obj.id,
          lat: Number(obj.lat),
          lng: Number(obj.lng),
          name: obj.name,
          client: obj.clientName || 'Cliente',
          shifts: shiftsInObjective,
          iconPreset,
          statusText,
          hasShift: shiftsInObjective.length > 0,
          layerOrder,
        };
      })
      .sort((a, b) => (a.layerOrder || 0) - (b.layerOrder || 0));
  }, [allObjectives, filteredShifts]);
}
