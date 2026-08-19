import { getDateKeyInTimezone } from '@/lib/crm/crmDateUtils';
import { resolveCanonicalObjectiveId } from '@/lib/crm/objectiveIdentity';
import {
  calcPlanificadorShiftHours,
  isPlanificadorPlannedHoursShift,
} from '@/lib/planificacion/planningScheduledHours';
import {
  coverageHoursFromShift,
  isFrancoTrabajadoShift,
  isVacantShift,
  shiftStartMs,
  type AbsenceEvent,
} from './analisisQueries';

export const SIN_OBJETIVO = 'SIN_OBJETIVO';

export type LeaveAttributionSource = 'ausencia' | 'malla_periodo' | 'malla_historial' | 'legajo' | 'sin_objetivo';

/** Home de un legajo = objetivo donde más horas de malla planificó en el período. */
export function homeObjectiveByEmployee(
  turnos: any[],
  objectiveAliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
): Map<string, string> {
  const acc = new Map<string, Map<string, number>>();
  turnos.forEach((t: any) => {
    if (isVacantShift(t)) return;
    if (!isPlanificadorPlannedHoursShift(t) && !isFrancoTrabajadoShift(t)) return;
    const eid = String(t.employeeId || '').trim();
    if (!eid || eid === 'VACANTE') return;
    const oid =
      resolveCanonicalObjectiveId(t, objectiveAliases) ||
      String(t.objectiveId ?? '').trim();
    if (!oid) return;
    const byObj = acc.get(eid) || new Map<string, number>();
    const hs = isPlanificadorPlannedHoursShift(t)
      ? calcPlanificadorShiftHours(t)
      : coverageHoursFromShift(t);
    byObj.set(oid, (byObj.get(oid) || 0) + hs);
    acc.set(eid, byObj);
  });
  const home = new Map<string, string>();
  acc.forEach((byObj, eid) => {
    let best = '';
    let max = -1;
    byObj.forEach((hs, oid) => {
      if (hs > max) {
        max = hs;
        best = oid;
      }
    });
    if (best) home.set(eid, best);
  });
  return home;
}

export function homeFromEmployees(employees: any[]): Map<string, string> {
  const m = new Map<string, string>();
  (employees || []).forEach((e) => {
    const id = String(e?.id || e?.employeeId || '').trim();
    const oid = String(e?.preferredObjectiveId || e?.objectiveId || e?.objetivoId || '').trim();
    if (id && oid) m.set(id, oid);
  });
  return m;
}

/** Último puesto de malla del legajo antes de `beforeDay` (YYYY-MM-DD). */
export function lastPlannedObjectiveBefore(
  turnos: any[],
  employeeId: string,
  beforeDay: string | undefined,
  aliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
): string {
  const eid = String(employeeId || '').trim();
  if (!eid) return '';
  let bestOid = '';
  let bestMs = -1;
  for (const t of turnos) {
    if (String(t.employeeId || '').trim() !== eid) continue;
    if (isVacantShift(t)) continue;
    if (!isPlanificadorPlannedHoursShift(t) && !isFrancoTrabajadoShift(t)) continue;
    const ms = shiftStartMs(t);
    if (ms == null) continue;
    if (beforeDay) {
      const day = getDateKeyInTimezone(new Date(ms));
      if (day >= beforeDay) continue;
    }
    if (ms < bestMs) continue;
    const oid =
      resolveCanonicalObjectiveId(t, aliases) ||
      String(t.objectiveId ?? '').trim();
    if (!oid) continue;
    bestMs = ms;
    bestOid = oid;
  }
  return bestOid;
}

export function resolveLeaveObjective(
  ev: AbsenceEvent,
  homePeriod: Map<string, string>,
  homeLookback: Map<string, string>,
  turnosPeriodo: any[],
  turnosHistorial: any[],
  aliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
  employeeHome?: Map<string, string>,
): { oid: string; source: LeaveAttributionSource } {
  if (ev.objectiveId) {
    const oid = resolveCanonicalObjectiveId({ objectiveId: ev.objectiveId }, aliases) || ev.objectiveId;
    return { oid, source: 'ausencia' };
  }
  const eid = String(ev.employeeId || '').trim();
  const lastPeriod = lastPlannedObjectiveBefore(turnosPeriodo, eid, ev.fromDay, aliases);
  if (lastPeriod) return { oid: lastPeriod, source: 'malla_periodo' };
  const homeP = eid ? homePeriod.get(eid) : '';
  if (homeP) return { oid: homeP, source: 'malla_periodo' };
  const lastHist = lastPlannedObjectiveBefore(turnosHistorial, eid, ev.fromDay, aliases);
  if (lastHist) return { oid: lastHist, source: 'malla_historial' };
  const homeH = eid ? homeLookback.get(eid) : '';
  if (homeH) return { oid: homeH, source: 'malla_historial' };
  const homeEmp = eid && employeeHome ? employeeHome.get(eid) : '';
  if (homeEmp) {
    const oid = resolveCanonicalObjectiveId({ objectiveId: homeEmp }, aliases) || homeEmp;
    return { oid, source: 'legajo' };
  }
  return { oid: SIN_OBJETIVO, source: 'sin_objetivo' };
}
