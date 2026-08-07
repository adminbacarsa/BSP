import { normalizePlanningPositionName, PLANNING_NON_BILLABLE_CODES } from './positionCoverageUnits';
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

  const isCoverageAdjust = !!(
    shift.isExtended
    || shift.isEarlyStart
    || shift.coveragePackageId
    || shift.extExtraHours != null
  );

  let codeBase = 0;
  const fromLookup = SHIFT_HOURS_LOOKUP[code];
  if (fromLookup !== undefined) codeBase = fromLookup;
  else if (slaHoursHint?.[code] !== undefined) codeBase = slaHoursHint[code];
  else {
    const storedForBase = Number(shift.hours);
    if (storedForBase > 0 && !isCoverageAdjust) codeBase = Math.min(storedForBase, 24);
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

  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  if (!isCoverageAdjust && extra <= 0) {
    const stored = Number(shift.hours);
    if (stored > 0 && stored > codeBase + 0.25) return Math.min(stored, 24);
  }

  const bandHint = slaHoursHint?.[code] ?? SHIFT_HOURS_LOOKUP[code];
  const coverageLike = isCoverageAdjust
    || !!shift.coversPositionName
    || !!shift.coverageSegmentRole
    || !!shift.coveragePackageId;

  if (bandHint != null && bandHint > 0 && coverageLike) {
    const storedH = Number(shift.hours);
    const extraPart = Math.max(
      extra,
      (Number.isFinite(storedH) && storedH > 0 && storedH < bandHint - 0.5) ? storedH : 0,
    );
    const baseBand = codeBase >= bandHint - 0.5 ? codeBase : bandHint;
    return Math.round((baseBand + extraPart) * 100) / 100;
  }

  if (
    bandHint != null
    && bandHint >= 8
    && codeBase > 0
    && codeBase < bandHint - 0.5
    && (shift.isExtended || shift.isEarlyStart || shift.extExtraHours != null)
  ) {
    const extraPart = Math.max(extra, codeBase);
    return Math.round((bandHint + extraPart) * 100) / 100;
  }

  return Math.round((codeBase + extra) * 100) / 100;
}

/** Desglose jornada facturable (base SLA + tramo ext/adel). */
export function planningShiftBillableBreakdown(
  shift: any,
  slaHoursHint?: Record<string, number>,
): { gross: number; base: number; extra: number } {
  const gross = calcPlanningBillableShiftHours(shift, slaHoursHint);
  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  const base = Math.max(0, Math.round((gross - extra) * 100) / 100);
  return { gross, base, extra: Math.round(extra * 100) / 100 };
}

/**
 * Horas del tramo en el puesto cubierto (ext/adel): primero o después del turno “casa”.
 * Usa segmentFrom→segmentTo del paquete split o extensión de celda.
 */
export function shiftCoverageSegmentBillableHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift || shift.isDeleted) return 0;
  const cover = normalizePlanningPositionName(shift.coversPositionName || '');
  if (!cover) return 0;

  const isSegment = shift.isExtended
    || shift.isEarlyStart
    || shift.coverageSegmentRole === 'EXTENSION'
    || shift.coverageSegmentRole === 'EARLY_START'
    || shift.coveragePackageId;
  if (!isSegment) return 0;

  const fromRaw = shift.segmentFromTime
    ?? (shift.isEarlyStart ? shift.adjustedStartTime : null);
  const toRaw = shift.segmentToTime
    ?? (shift.isExtended ? (shift.adjustedEndTime || shift.extensionEndTime) : null);

  if (fromRaw && toRaw) {
    const h = hoursBetweenClockTimes(String(fromRaw).slice(0, 5), String(toRaw).slice(0, 5));
    if (h != null && h > 0) return Math.round(h * 100) / 100;
  }

  const explicit = Number(shift.extExtraHours ?? shift.extensionExtraHours);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, 12);

  return shiftCoverageExtensionExtraHours(shift, slaHoursHint);
}

/**
 * Imputación por puesto: tramo de cobertura → coversPositionName; jornada base → positionName.
 * Totales por legajo siguen usando calcPlanningBillableShiftHours (sin doble conteo global).
 */
export function calcPlanningBillableHoursAttributedToPosition(
  shift: any,
  positionName: string,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift) return 0;
  const code = String(shift.code || shift.type || '').toUpperCase();
  if (PLANNING_NON_BILLABLE_CODES.has(code)) return 0;

  const target = normalizePlanningPositionName(positionName);
  const home = normalizePlanningPositionName(shift.positionName || '');
  const cover = normalizePlanningPositionName(shift.coversPositionName || '');
  const total = calcPlanningBillableShiftHours(shift, slaHoursHint);

  const crossCover = !!cover && cover !== home;
  if (!crossCover) {
    if (!home) return total;
    return home === target ? total : 0;
  }

  const atCover = shiftCoverageSegmentBillableHours(shift, slaHoursHint);
  const atHome = Math.max(0, Math.round((total - atCover) * 100) / 100);

  if (target === cover) return atCover;
  if (home && target === home) return atHome;
  return 0;
}

export function calcPlanificadorShiftHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  return calcPlanningBillableShiftHours(shift, slaHoursHint);
}

/**
 * Horas que cierran contra «vendidas» del SLA mensual: jornada/banda vendida sin tramos
 * extra de extensión o adelanto (cobertura operativa dentro del mismo contrato).
 * CRM / liquidación puede seguir usando calcPlanningBillableShiftHours (base + extra).
 */
export function calcPlanningSlaReconciliationHours(
  shift: any,
  slaHoursHint?: Record<string, number>,
): number {
  if (!shift || shift.isDeleted) return 0;
  const total = calcPlanningBillableShiftHours(shift, slaHoursHint);
  const extra = shiftCoverageExtensionExtraHours(shift, slaHoursHint);
  if (extra <= 0) return total;
  return Math.max(0, Math.round((total - extra) * 100) / 100);
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
