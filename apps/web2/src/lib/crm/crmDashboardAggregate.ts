import type { ClientRef } from '@/lib/crm/clientDataMatch';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import { fichadaAnchorDate, fichadaHoursForShift, isShiftFichado } from '@/lib/crm/fichadaHours';
import { resolveClientIdForTurno } from '@/lib/crm/plannedHours';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';
import { sumVigenteSlaHoursInRange, pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import {
  buildDemandaByObjective,
  coveragePlannedFromDemandaRow,
} from '@/lib/analisis/analisisDemanda';
import { buildObjectiveAliasesFromSla } from '@/lib/hoursBalance/buildHoursBalance';

export type CrmPortfolioHours = {
  sla: number;
  planned: number;
  executed: number;
};

export type CrmClientHours = {
  sla: number;
  planned: number;
  real: number;
};

function clientIdForDemandaClientName(name: string, clientRefs: ClientRef[]): string | null {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  for (const c of clientRefs) {
    const n = String(c.name || '').trim().toLowerCase();
    const ln = String(c.legalName || '').trim().toLowerCase();
    if (n === key || ln === key) return c.id;
  }
  return null;
}

function buildDemandaForCrmAggregate(
  clientRefs: ClientRef[],
  slaDocsByClient: Map<string, any[]>,
  allTurnos: any[],
  start: Date,
  end: Date,
) {
  const allSlas = clientRefs.flatMap((c) => slaDocsByClient.get(c.id) || []);
  const vigente = pickVigenteSlasForPeriod(allSlas, start, end);
  const aliases = buildObjectiveAliasesFromSla(allSlas);
  const slaExclusionCtx = buildSlaExclusionContext(allSlas, start, end);
  return buildDemandaByObjective({
    turnos: allTurnos,
    ausenciasStats: null,
    vigenteServices: vigente,
    periodStart: start,
    periodEnd: end,
    objectiveAliases: aliases,
    slaExclusionCtx,
  });
}

export function aggregateCrmPortfolioHours(
  clientRefs: ClientRef[],
  slaDocsByClient: Map<string, any[]>,
  allTurnos: any[],
  validEmp: Record<string, boolean>,
  start: Date,
  end: Date,
  tenantClientIds: Set<string>,
  _turnosByClient?: Map<string, any[]>,
): CrmPortfolioHours {
  let sla = 0;

  for (const clientRef of clientRefs) {
    const clientSlas = slaDocsByClient.get(clientRef.id) || [];
    sla += sumVigenteSlaHoursInRange(clientSlas, start, end, clientRef.id);
  }

  const demanda = buildDemandaForCrmAggregate(clientRefs, slaDocsByClient, allTurnos, start, end);
  const planned = coveragePlannedFromDemandaRow(demanda.totals);

  let executed = 0;
  for (const t of allTurnos) {
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;

    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid || !tenantClientIds.has(cid)) continue;
    if (!validEmp[t.employeeId]) continue;
    if (!isShiftFichado(t)) continue;

    const when = fichadaAnchorDate(t);
    if (!when || when < start || when > end) continue;

    const hrs = fichadaHoursForShift(t);
    if (hrs > 0) executed += hrs;
  }

  return {
    sla: Math.round(sla),
    planned: Math.round(planned),
    executed: Math.round(executed),
  };
}

/** Misma fórmula que el dashboard, desglosada por cliente (para cachear cada mes). */
export function aggregateCrmHoursByClient(
  clientRefs: ClientRef[],
  slaDocsByClient: Map<string, any[]>,
  allTurnos: any[],
  validEmp: Record<string, boolean>,
  start: Date,
  end: Date,
  tenantClientIds: Set<string>,
  _turnosByClient?: Map<string, any[]>,
): Record<string, CrmClientHours> {
  const out: Record<string, CrmClientHours> = {};
  for (const clientRef of clientRefs) {
    const clientSlas = slaDocsByClient.get(clientRef.id) || [];
    const sla = sumVigenteSlaHoursInRange(clientSlas, start, end, clientRef.id);
    out[clientRef.id] = { sla: Math.round(sla), planned: 0, real: 0 };
  }

  const demanda = buildDemandaForCrmAggregate(clientRefs, slaDocsByClient, allTurnos, start, end);
  for (const row of demanda.rows) {
    const cid = clientIdForDemandaClientName(row.client, clientRefs);
    if (!cid || !out[cid]) continue;
    out[cid].planned = Math.round(out[cid].planned + coveragePlannedFromDemandaRow(row));
  }

  for (const t of allTurnos) {
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;
    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid || !tenantClientIds.has(cid)) continue;
    if (!validEmp[t.employeeId]) continue;
    if (!isShiftFichado(t)) continue;
    const when = fichadaAnchorDate(t);
    if (!when || when < start || when > end) continue;
    const hrs = fichadaHoursForShift(t);
    if (!(hrs > 0)) continue;
    const prev = out[cid] || { sla: 0, planned: 0, real: 0 };
    prev.real += hrs;
    out[cid] = prev;
  }

  for (const cid of Object.keys(out)) {
    out[cid].real = Math.round(out[cid].real);
  }
  return out;
}

const MONTH_SHORT_AR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function eachCalendarDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor.getTime() <= last.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Serie diaria SLA / plan / realizadas — misma fórmula que los KPI, recorte de un día. */
export function buildCrmDailyTrendSeries(
  clientRefs: ClientRef[],
  slaDocsByClient: Map<string, any[]>,
  allTurnos: any[],
  validEmp: Record<string, boolean>,
  start: Date,
  end: Date,
  tenantClientIds: Set<string>,
): { label: string; sla: number; planificado: number; ejecutado: number }[] {
  const turnosByDay = new Map<string, any[]>();
  for (const t of allTurnos) {
    const key = resolveTurnoScheduleDateKey(t);
    if (!key) continue;
    const list = turnosByDay.get(key) || [];
    list.push(t);
    turnosByDay.set(key, list);
  }

  const executedByDay = new Map<string, number>();
  for (const t of allTurnos) {
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;
    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid || !tenantClientIds.has(cid)) continue;
    if (!validEmp[t.employeeId]) continue;
    if (!isShiftFichado(t)) continue;
    const when = fichadaAnchorDate(t);
    if (!when || when < start || when > end) continue;
    const hrs = fichadaHoursForShift(t);
    if (!(hrs > 0)) continue;
    const key = getDateKeyInTimezone(when);
    executedByDay.set(key, (executedByDay.get(key) || 0) + hrs);
  }

  return eachCalendarDay(start, end).map((day) => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const demanda = buildDemandaForCrmAggregate(
      clientRefs,
      slaDocsByClient,
      turnosByDay.get(key) || [],
      dayStart,
      dayEnd,
    );
    return {
      label: `${day.getDate()} ${MONTH_SHORT_AR[day.getMonth()]}`,
      sla: Math.round(demanda.totals.slaHours || 0),
      planificado: Math.round(coveragePlannedFromDemandaRow(demanda.totals)),
      ejecutado: Math.round(executedByDay.get(key) || 0),
    };
  });
}
