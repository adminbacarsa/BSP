import type { ClientRef } from '@/lib/crm/clientDataMatch';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import {
  buildSlaCodeHoursHintByObjectiveId,
  buildSlaCodeHoursHintFromServices,
  CRM_PLANNED_SHIFT_HOURS,
  getDurationHours,
  isCrmWorkingShiftCode,
  resolveClientIdForTurno,
  sumPlannedHoursForClient,
  toDateSafe,
  type PlannedHoursRange,
} from '@/lib/crm/plannedHours';
import { sumVigenteSlaHoursInRange } from '@/lib/crm/slaObjectiveHours';

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

export function aggregateCrmPortfolioHours(
  clientRefs: ClientRef[],
  slaDocsByClient: Map<string, any[]>,
  allTurnos: any[],
  validEmp: Record<string, boolean>,
  start: Date,
  end: Date,
  tenantClientIds: Set<string>,
  turnosByClient?: Map<string, any[]>,
): CrmPortfolioHours {
  let sla = 0;
  let planned = 0;
  const plannedRange: PlannedHoursRange = { start, end };

  for (const clientRef of clientRefs) {
    const clientSlas = slaDocsByClient.get(clientRef.id) || [];
    sla += sumVigenteSlaHoursInRange(clientSlas, start, end, clientRef.id);
    const slaExclusion = buildSlaExclusionContext(clientSlas, start, end);
    const clientTurnos = turnosByClient?.get(clientRef.id) ?? allTurnos;
    const slaCodeHoursHint = buildSlaCodeHoursHintFromServices(clientSlas);
    const slaCodeHoursHintByObjective = buildSlaCodeHoursHintByObjectiveId(clientSlas);
    planned += sumPlannedHoursForClient(
      clientTurnos,
      clientRef,
      plannedRange,
      slaExclusion,
      slaCodeHoursHint,
      slaCodeHoursHintByObjective,
    );
  }

  let executed = 0;
  for (const t of allTurnos) {
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;

    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid || !tenantClientIds.has(cid)) continue;

    const realStart = toDateSafe(t.realStartTime);
    const realEnd = toDateSafe(t.realEndTime);
    if (!realStart || !realEnd) continue;
    if (realStart < start || realStart > end) continue;
    if (!validEmp[t.employeeId]) continue;

    const code = String((t.code || t.type || '')).trim().toUpperCase();
    if (!isCrmWorkingShiftCode(code)) continue;
    let hrs = getDurationHours(realStart, realEnd);
    if (CRM_PLANNED_SHIFT_HOURS[code]) hrs = CRM_PLANNED_SHIFT_HOURS[code];
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = CRM_PLANNED_SHIFT_HOURS[code] || 8;
    executed += hrs;
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
  turnosByClient?: Map<string, any[]>,
): Record<string, CrmClientHours> {
  const out: Record<string, CrmClientHours> = {};
  const plannedRange: PlannedHoursRange = { start, end };

  for (const clientRef of clientRefs) {
    const clientSlas = slaDocsByClient.get(clientRef.id) || [];
    const sla = sumVigenteSlaHoursInRange(clientSlas, start, end, clientRef.id);
    const slaExclusion = buildSlaExclusionContext(clientSlas, start, end);
    const clientTurnos = turnosByClient?.get(clientRef.id) ?? allTurnos;
    const slaCodeHoursHint = buildSlaCodeHoursHintFromServices(clientSlas);
    const slaCodeHoursHintByObjective = buildSlaCodeHoursHintByObjectiveId(clientSlas);
    const planned = sumPlannedHoursForClient(
      clientTurnos,
      clientRef,
      plannedRange,
      slaExclusion,
      slaCodeHoursHint,
      slaCodeHoursHintByObjective,
    );
    out[clientRef.id] = { sla: Math.round(sla), planned: Math.round(planned), real: 0 };
  }

  for (const t of allTurnos) {
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;
    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid || !tenantClientIds.has(cid)) continue;
    const realStart = toDateSafe(t.realStartTime);
    const realEnd = toDateSafe(t.realEndTime);
    if (!realStart || !realEnd) continue;
    if (realStart < start || realStart > end) continue;
    if (!validEmp[t.employeeId]) continue;
    const code = String((t.code || t.type || '')).trim().toUpperCase();
    if (!isCrmWorkingShiftCode(code)) continue;
    let hrs = getDurationHours(realStart, realEnd);
    if (CRM_PLANNED_SHIFT_HOURS[code]) hrs = CRM_PLANNED_SHIFT_HOURS[code];
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = CRM_PLANNED_SHIFT_HOURS[code] || 8;
    const prev = out[cid] || { sla: 0, planned: 0, real: 0 };
    prev.real += hrs;
    out[cid] = prev;
  }

  for (const cid of Object.keys(out)) {
    out[cid].real = Math.round(out[cid].real);
  }
  return out;
}
