/**
 * Espejo de apps/functions/src/coverage/coverageSourceShiftForGap.ts
 */

const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);

export type CoverageGapWindow = {
  startMs: number;
  endMs: number;
  band?: string | null;
};

function toMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    return Number((v as { seconds: number }).seconds) * 1000;
  }
  if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  const t = new Date(v as string | number).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function shiftStartMs(shift: Record<string, unknown>): number {
  if (shift.shiftDateObj) return toMs(shift.shiftDateObj);
  return toMs(shift.startTime);
}

export function shiftEndMs(shift: Record<string, unknown>): number {
  if (shift.endDateObj) return toMs(shift.endDateObj);
  return toMs(shift.endTime);
}

export function resolveOperationalBand(shift: Record<string, unknown>): string {
  const deploy = String(shift.deploymentBand || shift.coversBandCode || '').trim().toUpperCase();
  if (WORK_BANDS.has(deploy)) return deploy;
  const code = String(shift.code || shift.shiftCode || shift.type || '').trim().toUpperCase();
  if (WORK_BANDS.has(code)) return code;
  return deploy || code;
}

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
  const startMs = shiftStartMs(absenceShift);
  const endMs = shiftEndMs(absenceShift);
  if (!startMs || !endMs || endMs <= startMs) return null;
  const band = String(absenceShift.code || '').trim().toUpperCase();
  return { startMs, endMs, band: band || null };
}
