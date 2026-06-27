import { useMemo } from 'react';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { objectiveCoverageStatus } from '@/lib/supervision/supervisionUtils';

export type ObjectiveLiveSummary = {
  objectiveId: string;
  objectiveName: string;
  clientName: string;
  activos: number;
  vacantes: number;
  ausentes: number;
  alertas: number;
  planificados: number;
  status: 'OK' | 'ALERTA' | 'CRITICO';
};

const isSameDay = (d1: Date, d2: Date) =>
  d1.toLocaleDateString('en-CA') === d2.toLocaleDateString('en-CA');

export function useSupervisionTablero(objectiveIds: string[], canViewAllObjectives: boolean) {
  const monitor = useOperacionesMonitor();

  const scopedShifts = useMemo(() => {
    let list = monitor.processedData;
    if (!canViewAllObjectives && objectiveIds.length) {
      const set = new Set(objectiveIds);
      list = list.filter((s: any) => set.has(s.objectiveId));
    } else if (!canViewAllObjectives && !objectiveIds.length) {
      list = [];
    }
    return list;
  }, [monitor.processedData, objectiveIds, canViewAllObjectives]);

  const todayShifts = useMemo(() => {
    const now = monitor.now;
    return scopedShifts.filter((s: any) => {
      if (s.isCompleted && !s.isRetention) return false;
      if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now) && s.endDateObj.getTime() < now.getTime()) {
        return false;
      }
      return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
    });
  }, [scopedShifts, monitor.now]);

  const objectiveSummaries = useMemo((): ObjectiveLiveSummary[] => {
    const map = new Map<string, ObjectiveLiveSummary>();
    todayShifts.forEach((s: any) => {
      if (s.isFranco) return;
      const oid = s.objectiveId || 'unknown';
      if (!map.has(oid)) {
        map.set(oid, {
          objectiveId: oid,
          objectiveName: s.objectiveName || oid,
          clientName: s.clientName || '',
          activos: 0,
          vacantes: 0,
          ausentes: 0,
          alertas: 0,
          planificados: 0,
          status: 'OK',
        });
      }
      const row = map.get(oid)!;
      if (s.isPresent && !s.isCompleted) row.activos += 1;
      if (s.isUnassigned) row.vacantes += 1;
      if (s.isAbsent || s.isPotentialAbsence) row.ausentes += 1;
      if (s.isLateNotified || s.isLateUnnotified) row.alertas += 1;
      if ((s.isFuture || s.isRRHHPlanned) && !s.isUnassigned) row.planificados += 1;
    });
    return Array.from(map.values())
      .map(o => ({ ...o, status: objectiveCoverageStatus(o) }))
      .sort((a, b) => {
        const rank = { CRITICO: 0, ALERTA: 1, OK: 2 };
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.objectiveName.localeCompare(b.objectiveName, 'es');
      });
  }, [todayShifts]);

  const totals = useMemo(() => ({
    activos: todayShifts.filter((s: any) => s.isPresent && !s.isCompleted && !s.isFranco).length,
    vacantes: todayShifts.filter((s: any) => s.isUnassigned && !s.isFranco).length,
    ausentes: todayShifts.filter((s: any) => (s.isAbsent || s.isPotentialAbsence) && !s.isFranco).length,
    alertas: todayShifts.filter((s: any) => (s.isLateNotified || s.isLateUnnotified) && !s.isFranco && !s.isAbsent).length,
    objetivos: objectiveSummaries.length,
  }), [todayShifts, objectiveSummaries.length]);

  return {
    ...monitor,
    scopedShifts,
    todayShifts,
    objectiveSummaries,
    totals,
  };
}
