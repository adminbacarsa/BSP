"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVERSIBLE_LATE_REASONS = exports.PROVISIONAL_LATE_REASONS = exports.LATE_ABSENCE_CAP_MS = exports.LATE_ETA_MAX_MINUTES = exports.LATE_ABSENCE_FLOOR_MS = void 0;
exports.clampLateEtaMinutes = clampLateEtaMinutes;
exports.shiftStartMs = shiftStartMs;
exports.lateAbsenceDeadlineMs = lateAbsenceDeadlineMs;
exports.isProvisionalLateAbsence = isProvisionalLateAbsence;
exports.isReversibleLateAbsence = isReversibleLateAbsence;
exports.lateVacancyDue = lateVacancyDue;
exports.LATE_ABSENCE_FLOOR_MS = 30 * 60 * 1000;
exports.LATE_ETA_MAX_MINUTES = 30;
function clampLateEtaMinutes(raw, fallback = exports.LATE_ETA_MAX_MINUTES) {
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(exports.LATE_ETA_MAX_MINUTES, Math.max(1, Math.floor(n)));
}
exports.LATE_ABSENCE_CAP_MS = 60 * 60 * 1000;
exports.PROVISIONAL_LATE_REASONS = new Set(['ETA_VENCIDA']);
exports.REVERSIBLE_LATE_REASONS = new Set(['AUTO_T30', 'ETA_VENCIDA']);
function shiftStartMs(shift) {
    const st = shift.startTime;
    return st?.toMillis?.() ?? 0;
}
function lateAbsenceDeadlineMs(plannedStartMs, etaAtMs) {
    if (plannedStartMs <= 0)
        return 0;
    const floor = plannedStartMs + exports.LATE_ABSENCE_FLOOR_MS;
    const cap = plannedStartMs + exports.LATE_ABSENCE_CAP_MS;
    if (etaAtMs > 0)
        return Math.max(floor, Math.min(etaAtMs, cap));
    return floor;
}
function absentBeforeCap(shift, nowMs, reasons) {
    const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
    if (!absent)
        return false;
    const by = String(shift.absenceDetectedBy || '').toUpperCase();
    if (!reasons.has(by))
        return false;
    const start = shiftStartMs(shift);
    if (start <= 0)
        return false;
    return nowMs < start + exports.LATE_ABSENCE_CAP_MS;
}
function isProvisionalLateAbsence(shift, nowMs) {
    return absentBeforeCap(shift, nowMs, exports.PROVISIONAL_LATE_REASONS);
}
function isReversibleLateAbsence(shift, nowMs) {
    return absentBeforeCap(shift, nowMs, exports.REVERSIBLE_LATE_REASONS);
}
function lateVacancyDue(shift, nowMs) {
    const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
    if (!absent)
        return false;
    if (shift.absenceVacancyOpenedAt)
        return false;
    const by = String(shift.absenceDetectedBy || '').toUpperCase();
    const start = shiftStartMs(shift);
    const operatorDeclared = by === 'MANUAL_OPS'
        || String(shift.absenceType || '').toUpperCase() === 'MANUAL_OPS'
        || !!shift.absenceConfirmedBy;
    if (operatorDeclared)
        return true;
    if (by === 'AUTO_T30')
        return true;
    if (exports.PROVISIONAL_LATE_REASONS.has(by)) {
        return start > 0 && nowMs >= start + exports.LATE_ABSENCE_CAP_MS;
    }
    return false;
}
//# sourceMappingURL=lateAbsenceWindow.js.map