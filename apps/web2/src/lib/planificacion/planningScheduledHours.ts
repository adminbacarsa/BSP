import { PLANNING_NON_BILLABLE_CODES } from './positionCoverageUnits';
import { isDeploymentOrPoolShift, normalizeDeploymentShiftCode } from './deploymentRoles';

const SHIFT_HOURS_LOOKUP: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, EN: 9,
  F: 0, FF: 0, FP: 0, FT: 0, V: 0, L: 0, A: 0, E: 0, AA: 0, PG: 0, RET: 0, REF: 0, ESC: 0, C: 8, GU: 8,
};

export { isDeploymentOrPoolShift, normalizeDeploymentShiftCode as normalizeShiftCode } from './deploymentRoles';

/** Turnos de cobertura operativa (reten, ops) — no son crono planificado del objetivo. */
export function isOperationalOriginShift(data: any): boolean {
  const o = String(data?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
  if (data?.resolvedBy === 'OPERACIONES') return true;
  if (data?.isReten === true) return true;
  return false;
}

/** Misma regla que el pie «Hs. Plan.» del planificador por objetivo. */
export function isPlanningScheduledCoverageShift(t: any): boolean {
  if (!t) return false;
  if (String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
  const status = String(t.status || '').toLowerCase();
  if (status.includes('cancel') || status.includes('delet')) return false;
  if (t.isFranco === true) return false;
  if (isDeploymentOrPoolShift(t)) return false;
  const code = normalizeDeploymentShiftCode(t?.code || t?.type);
  if (PLANNING_NON_BILLABLE_CODES.has(code)) return false;
  if (isOperationalOriginShift(t)) return false;
  const origin = String(t.origin || '').trim().toUpperCase();
  if (origin === 'INTERRUPTION') return false;
  return true;
}

export function calcPlanningScheduledShiftHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift) return 0;
  if (isDeploymentOrPoolShift(shift)) return 0;
  const code = String(shift.code || '').toUpperCase();
  if (PLANNING_NON_BILLABLE_CODES.has(code)) return 0;
  const stored = Number(shift.hours);
  if (stored > 0) return Math.min(stored, 24);
  if (shift.startTime?.seconds && shift.endTime?.seconds) {
    return Math.max(0, Math.min((shift.endTime.seconds - shift.endTime.seconds) / 3600, 24));
  }
  if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
    const parseH = (t: string) => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      return m ? +m[1] + +m[2] / 60 : null;
    };
    const s = parseH(shift.startTime);
    const e = parseH(shift.endTime);
    if (s !== null && e !== null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      return Math.max(0, Math.min(dur, 24));
    }
  }
  const fromLookup = SHIFT_HOURS_LOOKUP[code];
  if (fromLookup !== undefined) return fromLookup;
  if (slaHoursHint?.[code] !== undefined) return slaHoursHint[code];
  return 8;
}
