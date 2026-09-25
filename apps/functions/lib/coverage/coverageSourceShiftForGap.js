"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftStartMs = shiftStartMs;
exports.shiftEndMs = shiftEndMs;
exports.gapWindowFromTitularShift = gapWindowFromTitularShift;
exports.gapWindowFromConvocatoria = gapWindowFromConvocatoria;
exports.resolveOperationalBand = resolveOperationalBand;
exports.sourceShiftEligibleForCoverageGap = sourceShiftEligibleForCoverageGap;
exports.gapFromAbsenceLikeShift = gapFromAbsenceLikeShift;
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
function shiftStartMs(shift) {
    const st = shift.startTime;
    return st?.toMillis?.() ?? 0;
}
function shiftEndMs(shift) {
    const en = shift.endTime;
    return en?.toMillis?.() ?? 0;
}
function gapWindowFromTitularShift(titular) {
    const startMs = shiftStartMs(titular);
    const endMs = shiftEndMs(titular);
    if (!startMs || !endMs || endMs <= startMs)
        return null;
    const band = String(titular.code || titular.shiftCode || titular.type || '').trim().toUpperCase();
    return { startMs, endMs, band: band || null };
}
function gapWindowFromConvocatoria(conv) {
    const startMs = conv.startTime?.toMillis?.() ?? 0;
    const endMs = conv.endTime?.toMillis?.() ?? 0;
    if (!startMs || !endMs || endMs <= startMs)
        return null;
    const band = String(conv.shiftCode || '').trim().toUpperCase();
    return { startMs, endMs, band: band || null };
}
/** Banda operativa del hueco o del turno origen (REF/ESC usan deploymentBand). */
function resolveOperationalBand(shift) {
    const deploy = String(shift.deploymentBand || shift.coversBandCode || '').trim().toUpperCase();
    if (WORK_BANDS.has(deploy))
        return deploy;
    const code = String(shift.code || shift.shiftCode || shift.type || '').trim().toUpperCase();
    if (WORK_BANDS.has(code))
        return code;
    return deploy || code;
}
/**
 * REF/ESC/RET: el turno origen debe solapar el hueco y (misma banda operativa o inicio ≤ inicio del hueco).
 * Excluye origen ya marcado coverageUsed.
 */
function sourceShiftEligibleForCoverageGap(sourceShift, gap) {
    if (sourceShift.coverageUsed === true)
        return false;
    if (sourceShift.isDeleted === true)
        return false;
    const srcStart = shiftStartMs(sourceShift);
    const srcEnd = shiftEndMs(sourceShift);
    if (!srcStart || !srcEnd || srcEnd <= srcStart)
        return false;
    if (!gap.startMs || !gap.endMs || gap.endMs <= gap.startMs)
        return false;
    const code = String(sourceShift.code || '').trim().toUpperCase();
    if (srcStart >= gap.endMs)
        return false;
    if (srcEnd < gap.startMs)
        return false;
    if (srcEnd === gap.startMs && code !== 'RET')
        return false;
    if (code === 'RET') {
        return srcStart <= gap.startMs + 60000;
    }
    const gapBand = String(gap.band || '').trim().toUpperCase();
    const srcBand = resolveOperationalBand(sourceShift);
    const sameBand = WORK_BANDS.has(gapBand) && WORK_BANDS.has(srcBand) && gapBand === srcBand;
    const startsBeforeOrAtGap = srcStart <= gap.startMs + 60000;
    return sameBand || startsBeforeOrAtGap;
}
function gapFromAbsenceLikeShift(absenceShift) {
    const start = absenceShift.shiftDateObj
        ? new Date(absenceShift.shiftDateObj).getTime()
        : shiftStartMs(absenceShift);
    const end = absenceShift.endDateObj
        ? new Date(absenceShift.endDateObj).getTime()
        : shiftEndMs(absenceShift);
    if (!start || !end || end <= start) {
        return gapWindowFromTitularShift(absenceShift);
    }
    const band = String(absenceShift.code || '').trim().toUpperCase();
    return { startMs: start, endMs: end, band: band || null };
}
