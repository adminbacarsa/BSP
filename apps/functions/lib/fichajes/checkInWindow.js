"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateServerCheckInWindow = evaluateServerCheckInWindow;
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
function startMs(shift) {
    return shift.startTime?.toMillis?.() ?? 0;
}
function endMs(shift) {
    return shift.endTime?.toMillis?.() ?? 0;
}
function createdMs(shift) {
    return (shift.createdAt?.toMillis?.()
        ?? shift.coverageCreatedAt?.toMillis?.()
        ?? startMs(shift));
}
function adjustedStartMs(shift) {
    const adj = shift.adjustedStartTime?.toMillis?.() ?? 0;
    if (adj > 0)
        return adj;
    return startMs(shift);
}
function lateEtaDeadlineMs(shift, plannedStartMs) {
    const etaAt = shift.lateArrivalEtaAt?.toMillis?.() ?? 0;
    const cap60 = plannedStartMs + 60 * 60 * 1000;
    if (etaAt > 0)
        return Math.min(etaAt, cap60);
    if (shift.lateArrivalConfirmed === true || shift.lateArrivalAt) {
        return plannedStartMs + 30 * 60 * 1000;
    }
    return plannedStartMs + 5 * 60 * 1000;
}
function finishAllowed(anchorStartMs, nowMs, useAdjustedStart) {
    const onTimeEnd = anchorStartMs + 5 * 60 * 1000;
    if (nowMs <= onTimeEnd) {
        return {
            allowed: true,
            usePlannedStart: true,
            useAdjustedStart,
            lateMinutes: 0,
        };
    }
    const lateMinutes = Math.max(0, Math.round((nowMs - anchorStartMs) / 60000));
    return {
        allowed: true,
        usePlannedStart: false,
        useAdjustedStart,
        lateMinutes,
    };
}
function evaluateServerCheckInWindow(shift, nowMs, opts) {
    if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
        return { allowed: false, rejectCode: 'ABSENT' };
    }
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift)) {
        return { allowed: false, rejectCode: 'TRACE_REGISTRATION' };
    }
    const source = String(opts?.source || '').toUpperCase();
    if (source === 'OPERATIONS'
        || source === 'VIGI'
        || source === 'DEMO'
        || source === 'MANUAL_RADIO'
        || source === 'MANUAL_PHONE') {
        return { allowed: true, usePlannedStart: false, lateMinutes: 0 };
    }
    const origin = String(shift.origin || '').toUpperCase();
    const ct = String(shift.coverageType || '').toUpperCase();
    const plannedStart = startMs(shift);
    const end = endMs(shift);
    if (end > 0 && nowMs > end)
        return { allowed: false, rejectCode: 'SHIFT_ENDED' };
    if (!plannedStart)
        return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (origin === 'OPERATIONS_COVERAGE' && ct !== 'EXTEND' && ct !== 'ADVANCE') {
        const gapStart = plannedStart;
        const windowStart = gapStart - 15 * 60 * 1000;
        const windowEnd = Math.max(createdMs(shift), gapStart) + 60 * 60 * 1000;
        if (nowMs < windowStart)
            return { allowed: false, rejectCode: 'TOO_EARLY' };
        if (nowMs > windowEnd)
            return { allowed: false, rejectCode: 'TOO_LATE' };
        return finishAllowed(gapStart, nowMs, false);
    }
    if (shift.isEarlyStart === true) {
        const advStart = adjustedStartMs(shift);
        const advWinStart = advStart - 15 * 60 * 1000;
        const advWinEnd = advStart + 60 * 60 * 1000;
        const ownWinStart = plannedStart - 15 * 60 * 1000;
        const ownWinEnd = lateEtaDeadlineMs(shift, plannedStart);
        const inAdv = nowMs >= advWinStart && nowMs <= advWinEnd;
        const inOwn = nowMs >= ownWinStart && nowMs <= ownWinEnd;
        if (!inAdv && !inOwn) {
            const tooEarly = nowMs < advWinStart && nowMs < ownWinStart;
            return { allowed: false, rejectCode: tooEarly ? 'TOO_EARLY' : 'TOO_LATE' };
        }
        if (inAdv) {
            return finishAllowed(advStart, nowMs, true);
        }
        return finishAllowed(plannedStart, nowMs, false);
    }
    const windowStart = plannedStart - 15 * 60 * 1000;
    const windowEnd = lateEtaDeadlineMs(shift, plannedStart);
    if (nowMs < windowStart)
        return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (nowMs > windowEnd)
        return { allowed: false, rejectCode: 'TOO_LATE' };
    return finishAllowed(plannedStart, nowMs, false);
}
//# sourceMappingURL=checkInWindow.js.map