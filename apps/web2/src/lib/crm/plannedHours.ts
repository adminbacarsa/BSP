import { clientRowMatchesClient, type ClientRef } from './clientDataMatch';
import { isProformaVacancyShift } from './proformaGrid';

export const CRM_PLANNED_SHIFT_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
};

const NON_PLANNED_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA']);

export function isCrmWorkingShiftCode(code: string): boolean {
  return !NON_PLANNED_CODES.has((code || '').trim().toUpperCase());
}

/** Misma elegibilidad que Prefactura → Detalle planificado. */
export function isCrmPlannedEligibleShift(t: any): boolean {
  const status = String(t.status || '').toLowerCase();
  if (status.includes('cancel') || status.includes('delet')) return false;
  if (String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
  if (isProformaVacancyShift(t)) return false;
  const code = String((t.code || t.type || '')).trim().toUpperCase();
  return isCrmWorkingShiftCode(code);
}

export const toDateSafe = (val: any): Date | null => {
  if (!val) return null;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val?.seconds === 'number') return new Date(val.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const getDurationHours = (start: Date, end: Date) => {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0) return diff;
  return diff + 24;
};

export function resolveCrmPlannedShiftHours(t: any, plannedStart: Date, plannedEnd: Date): number {
  const code = String((t.code || t.type || '')).trim().toUpperCase();
  let hrs = Number(t.hours) || getDurationHours(plannedStart, plannedEnd);
  if (CRM_PLANNED_SHIFT_HOURS[code]) hrs = CRM_PLANNED_SHIFT_HOURS[code];
  if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = CRM_PLANNED_SHIFT_HOURS[code] || 8;
  return hrs;
};

export type PlannedHoursRange = { start: Date | null; end: Date | null };

export function shiftPlannedStartInRange(plannedStart: Date, range: PlannedHoursRange): boolean {
  const { start, end } = range;
  if (!start || !end) return true;
  return plannedStart >= start && plannedStart <= end;
}

export function sumPlannedHoursForTurnos(turnos: any[], range: PlannedHoursRange): number {
  let total = 0;
  for (const t of turnos) {
    if (!isCrmPlannedEligibleShift(t)) continue;
    const plannedStart = toDateSafe(t.startTime);
    const plannedEnd = toDateSafe(t.endTime);
    if (!plannedStart || !plannedEnd) continue;
    if (!shiftPlannedStartInRange(plannedStart, range)) continue;
    total += resolveCrmPlannedShiftHours(t, plannedStart, plannedEnd);
  }
  return total;
}

export function resolveClientIdForTurno(
  t: Record<string, unknown>,
  clients: ClientRef[],
): string | null {
  const direct = String(t.clientId ?? '').trim();
  if (direct) {
    const byId = clients.find((c) => c.id === direct);
    if (byId) return byId.id;
  }
  for (const c of clients) {
    if (clientRowMatchesClient(t, c)) return c.id;
  }
  return null;
}
