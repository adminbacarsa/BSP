import { PLANNING_NON_BILLABLE_CODES } from './positionCoverageUnits';
import { isDeploymentOrPoolShift, normalizeDeploymentShiftCode, shiftCountsForEmployeeCronoHours } from './deploymentRoles';

const SHIFT_HOURS_LOOKUP: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, EN: 9,
  F: 0, FF: 0, FP: 0, FT: 0, V: 0, L: 0, A: 0, E: 0, AA: 0, PG: 0, RET: 0, REF: 0, RFZ: 8, TURA: 8, ESC: 0, C: 8, GU: 8,
};

export { isDeploymentOrPoolShift, normalizeDeploymentShiftCode as normalizeShiftCode } from './deploymentRoles';

function parseHHmmToHours(t: string | undefined | null): number | null {
  if (!t || typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** Duración en horas entre dos horarios HH:mm (puede cruzar medianoche). */
export function hoursBetweenClockTimes(from: string, to: string): number | null {
  const f = parseHHmmToHours(from);
  const t = parseHHmmToHours(to);
  if (f == null || t == null) return null;
  let dur = t - f;
  if (dur <= 0) dur += 24;
  return Math.max(0, Math.min(dur, 24));
}

/**
 * Horas billables adicionales por extensión o adelanto de cobertura (split / cierre SLA).
 * El código base (E1, M, etc.) ya se suma aparte; esto es el tramo extra (segmentFrom→segmentTo).
 */
export function shiftCoverageExtensionExtraHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift || shift.isDeleted) return 0;

  const explicit = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, 12);
  }

  if (!shift.isExtended && !shift.isEarlyStart) return 0;

  const fromRaw = shift.segmentFromTime
    || (shift.isEarlyStart ? shift.adjustedStartTime : null);
  const toRaw = shift.segmentToTime
    || (shift.isExtended ? (shift.adjustedEndTime || shift.extensionEndTime) : null);

  if (fromRaw && toRaw) {
    const from = String(fromRaw).slice(0, 5);
    const to = String(toRaw).slice(0, 5);
    const h = hoursBetweenClockTimes(from, to);
    if (h != null && h > 0) {
      const code = String(shift.code || '').toUpperCase();
      const codeBase = SHIFT_HOURS_LOOKUP[code] ?? slaHoursHint?.[code];
      if (codeBase !== undefined && h >= codeBase - 0.5) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      if (h <= 5) return h;
      if (codeBase !== undefined) {
        return Math.max(0, Math.min(h - codeBase, 12));
      }
      return 0;
    }
  }

  return 0;
}

/** Turnos de cobertura operativa (reten, ops) — no son crono planificado del objetivo. */
export function isOperationalOriginShift(data: any): boolean {
  const o = String(data?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
  if (data?.resolvedBy === 'OPERACIONES') return true;
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

/** Pie «Hs. Plan.» / CRM — misma elegibilidad que planificador (sin filtros extra de cobertura SLA). */
export function isPlanificadorPlannedHoursShift(t: any): boolean {
  if (!t) return false;
  if (String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
  const status = String(t.status || '').toLowerCase();
  if (status.includes('cancel') || status.includes('delet')) return false;
  if (isOperationalOriginShift(t)) return false;
  if (!shiftCountsForEmployeeCronoHours(t)) return false;
  return true;
}

/**
 * Horas billables de un turno planificado: código SLA + tramo extra de extensión/adelanto.
 * Misma regla que el pie «Hs. Plan.» del planificador (lookup CCT/custom antes que timestamps).
 */
export function calcPlanningBillableShiftHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift) return 0;
  const code = String(shift.code || shift.type || '').toUpperCase();
  if (PLANNING_NON_BILLABLE_CODES.has(code)) return 0;

  let codeBase = 0;
  const fromLookup = SHIFT_HOURS_LOOKUP[code];
  if (fromLookup !== undefined) codeBase = fromLookup;
  else if (slaHoursHint?.[code] !== undefined) codeBase = slaHoursHint[code];
  else {
    const stored = Number(shift.hours);
    if (stored > 0) codeBase = Math.min(stored, 24);
    else if (shift.startTime?.seconds && shift.endTime?.seconds) {
      codeBase = Math.max(0, Math.min((shift.endTime.seconds - shift.startTime.seconds) / 3600000, 24));
    } else if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
      const parseH = (t: string) => {
        const m = t.match(/^(\d{1,2}):(\d{2})$/);
        return m ? +m[1] + +m[2] / 60 : null;
      };
      const s = parseH(shift.startTime);
      const e = parseH(shift.endTime);
      if (s !== null && e !== null) {
        let dur = e - s;
        if (dur <= 0) dur += 24;
        codeBase = Math.max(0, Math.min(dur, 24));
      }
    }
    if (codeBase <= 0) codeBase = 8;
  }

  const stored = Number(shift.hours);
  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  if (stored > 0 && stored > codeBase + 0.25 && extra > 0) {
    return Math.min(stored, 24);
  }
  if (stored > 0 && stored > codeBase + 0.25 && !shift.isExtended && !shift.isEarlyStart) {
    return Math.min(stored, 24);
  }

  return codeBase + extra;
}

export function calcPlanificadorShiftHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  return calcPlanningBillableShiftHours(shift, slaHoursHint);
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
