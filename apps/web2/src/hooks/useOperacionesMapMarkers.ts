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
  isEvent?: boolean;
};

function isEventShift(shift: any): boolean {
  const code = String(shift?.code || shift?.shiftCode || '').trim().toUpperCase();
  const origin = String(shift?.origin || '').trim().toUpperCase();
  return code === 'EV' || origin === 'EVENTO' || !!String(shift?.eventoId || '').trim();
}

/** Separa pines apilados en el mismo lat/lng (p. ej. varios objetivos sin geo real). */
function applyCoordJitter(markers: OperacionesMapMarker[]): OperacionesMapMarker[] {
  const groups = new Map<string, OperacionesMapMarker[]>();
  for (const m of markers) {
    const key = `${m.lat.toFixed(5)}:${m.lng.toFixed(5)}`;
    const list = groups.get(key) || [];
    list.push(m);
    groups.set(key, list);
  }
  const out: OperacionesMapMarker[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const radius = 0.00035 * Math.min(list.length, 8);
    list.forEach((m, i) => {
      const angle = (2 * Math.PI * i) / list.length;
      out.push({
        ...m,
        lat: m.lat + radius * Math.cos(angle),
        lng: m.lng + radius * Math.sin(angle),
      });
    });
  }
  return out;
}

export function useOperacionesMapMarkers(allObjectives: any[] = [], filteredShifts: any[] = []): OperacionesMapMarker[] {
  return useMemo(() => {
    const normId = (x: any) => String(x ?? '').trim();

    const built = allObjectives
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
        const eventShifts = shiftsInObjective.filter(isEventShift);
        const hasEvent = eventShifts.length > 0;

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
            const event = isEventShift(s);

            if (isReportedOrReturned && priority < 5) {
              const isReturned = s.status === 'UNCOVERED_REPORTED' || s.origin === 'INTERRUPTION';
              iconPreset = 'VIOLET';
              statusText = isReturned ? 'DEVUELTA A PLANIF.' : 'VACANTE REPORTADA';
              priority = 5;
            } else if ((s.isUnassigned || s.isAbsent || s.isPotentialAbsence) && priority < 5) {
              iconPreset = 'RED';
              statusText = event ? 'EVENTO · VACANTE/AUS' : s.isUnassigned ? 'VACANTE' : 'AUSENCIA';
              priority = 5;
            } else if (event && priority < 4.5) {
              iconPreset = 'AMBER';
              statusText = 'EVENTO';
              priority = 4.5;
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
              statusText = event ? 'EVENTO · TARDE' : 'TARDE';
              priority = 3;
            } else if ((s.isPresent || (diffMin >= -15 && diffMin <= 5 && !s.isPresent)) && priority < 2) {
              iconPreset = event ? 'AMBER' : 'GREEN';
              statusText = event ? (s.isPresent ? 'EVENTO · ACTIVO' : 'EVENTO') : s.isPresent ? 'ACTIVO' : 'A TIEMPO';
              priority = event ? 4.5 : 2;
            } else if (s.isFranco && priority < 1) {
              iconPreset = 'BLUE';
              statusText = 'FRANCO';
              priority = 1;
            }
          });
        }

        const layerOrder = statusText === 'S/A' ? 0 : hasEvent ? 2 : 1;
        const displayName = hasEvent && !String(obj.name || '').toUpperCase().includes('EVENT')
          ? `${obj.name} · Evento`
          : obj.name;

        return {
          id: obj.id,
          lat: Number(obj.lat),
          lng: Number(obj.lng),
          name: displayName,
          client: obj.clientName || 'Cliente',
          shifts: shiftsInObjective,
          iconPreset,
          statusText,
          hasShift: shiftsInObjective.length > 0,
          layerOrder,
          isEvent: hasEvent,
        };
      })
      .sort((a, b) => (a.layerOrder || 0) - (b.layerOrder || 0));

    return applyCoordJitter(built);
  }, [allObjectives, filteredShifts]);
}
