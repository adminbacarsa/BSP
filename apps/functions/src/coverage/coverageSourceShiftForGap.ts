import { Timestamp } from 'firebase-admin/firestore';

const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);

export type CoverageGapWindow = {
  startMs: number;
  endMs: number;
  band?: string | null;
};

export function shiftStartMs(shift: Record<string, unknown>): number {
  const st = shift.startTime as Timestamp | undefined;
  return st?.toMillis?.() ?? 0;
}

export function shiftEndMs(shift: Record<string, unknown>): number {
  const en = shift.endTime as Timestamp | undefined;
  return en?.toMillis?.() ?? 0;
}

export function gapWindowFromTitularShift(titular: Record<string, unknown>): CoverageGapWindow | null {
  const startMs = shiftStartMs(titular);
  const endMs = shiftEndMs(titular);
  if (!startMs || !endMs || endMs <= startMs) return null;
  const band = String(titular.code || titular.shiftCode || titular.type || '').trim().toUpperCase();
  return { startMs, endMs, band: band || null };
}

export function gapWindowFromConvocatoria(conv: {
  startTime?: Timestamp;
  endTime?: Timestamp;
  shiftCode?: string;
}): CoverageGapWindow | null {
  const startMs = conv.startTime?.toMillis?.() ?? 0;
  const endMs = conv.endTime?.toMillis?.() ?? 0;
  if (!startMs || !endMs || endMs <= startMs) return null;
  const band = String(conv.shiftCode || '').trim().toUpperCase();
  return { startMs, endMs, band: band || null };
}

/** Banda operativa del hueco o del turno origen (REF/ESC usan deploymentBand). */
export function resolveOperationalBand(shift: Record<string, unknown>): string {
  const deploy = String(shift.deploymentBand || shift.coversBandCode || '').trim().toUpperCase();
  if (WORK_BANDS.has(deploy)) return deploy;
  const code = String(shift.code || shift.shiftCode || shift.type || '').trim().toUpperCase();
  if (WORK_BANDS.has(code)) return code;
  return deploy || code;
}

/**
 * REF/ESC/RET: el turno origen debe solapar el hueco y (misma banda operativa o inicio ≤ inicio del hueco).
 * Excluye origen ya marcado coverageUsed.
 */
export function sourceShiftEligibleForCoverageGap(
  sourceShift: Record<string, unknown>,
  gap: CoverageGapWindow,
): boolean {
  if (sourceShift.coverageUsed === true) return false;
  if (sourceShift.isDeleted === true) return false;

  const srcStart = shiftStartMs(sourceShift);
  const srcEnd = shiftEndMs(sourceShift);
  if (!srcStart || !srcEnd || srcEnd <= srcStart) return false;
  if (!gap.startMs || !gap.endMs || gap.endMs <= gap.startMs) return false;

  const code = String(sourceShift.code || '').trim().toUpperCase();

  if (srcStart >= gap.endMs) return false;
  if (srcEnd < gap.startMs) return false;
  if (srcEnd === gap.startMs && code !== 'RET') return false;

  if (code === 'RET') {
    return srcStart <= gap.startMs + 60_000;
  }

  const gapBand = String(gap.band || '').trim().toUpperCase();
  const srcBand = resolveOperationalBand(sourceShift);
  const sameBand = WORK_BANDS.has(gapBand) && WORK_BANDS.has(srcBand) && gapBand === srcBand;
  const startsBeforeOrAtGap = srcStart <= gap.startMs + 60_000;

  return sameBand || startsBeforeOrAtGap;
}

export function gapFromAbsenceLikeShift(absenceShift: Record<string, unknown>): CoverageGapWindow | null {
  const start = absenceShift.shiftDateObj
    ? new Date(absenceShift.shiftDateObj as Date | string).getTime()
    : shiftStartMs(absenceShift);
  const end = absenceShift.endDateObj
    ? new Date(absenceShift.endDateObj as Date | string).getTime()
    : shiftEndMs(absenceShift);
  if (!start || !end || end <= start) {
    return gapWindowFromTitularShift(absenceShift);
  }
  const band = String(absenceShift.code || '').trim().toUpperCase();
  return { startMs: start, endMs: end, band: band || null };
}
