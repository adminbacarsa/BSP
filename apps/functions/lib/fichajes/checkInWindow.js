"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convocadoPunchAnchorMs = convocadoPunchAnchorMs;
exports.convocadoPunchCapMs = convocadoPunchCapMs;
exports.evaluateServerCheckInWindow = evaluateServerCheckInWindow;
const lateAbsenceWindow_1 = require("../attendance/lateAbsenceWindow");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const altaArcaGate_1 = require("../arca/altaArcaGate");
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
function convocadoPunchAnchorMs(shift) {
    const acc = shift.acceptedAt?.toMillis?.() ?? 0;
    if (acc > 0)
        return acc;
    return createdMs(shift);
}
function convocadoPunchCapMs(shift) {
    const anchor = convocadoPunchAnchorMs(shift);
    const end = endMs(shift);
    const plus = anchor > 0 ? anchor + 60 * 60 * 1000 : 0;
    if (end > 0 && plus > 0)
        return Math.min(end, plus);
    if (plus > 0)
        return plus;
    return end > 0 ? end : 0;
}
function adjustedStartMs(shift) {
    const adj = shift.adjustedStartTime?.toMillis?.() ?? 0;
    if (adj > 0)
        return adj;
    return startMs(shift);
}
function hasPriorLateNotice(shift) {
    const etaAt = shift.lateArrivalEtaAt?.toMillis?.() ?? 0;
    if (etaAt > 0)
        return true;
    return shift.lateArrivalConfirmed === true || !!shift.lateArrivalAt;
}
function lateEtaDeadlineMs(shift, plannedStartMs) {
    const etaAt = shift.lateArrivalEtaAt?.toMillis?.() ?? 0;
    return (0, lateAbsenceWindow_1.lateAbsenceDeadlineMs)(plannedStartMs, etaAt);
}
function finishAllowed(anchorStartMs, nowMs, useAdjustedStart, lateNoNoticeEligible = false) {
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
        ...(lateNoNoticeEligible && lateMinutes > 0 ? { lateNoNotice: true } : {}),
    };
}
function evaluateServerCheckInWindow(shift, nowMs, opts) {
    if (!(0, altaArcaGate_1.isAltaArcaConfirmada)(shift)) {
        return { allowed: false, rejectCode: 'ALTA_ARCA_PENDIENTE' };
    }
    const plannedStartEarly = startMs(shift);
    if ((shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT')
        && (0, lateAbsenceWindow_1.isReversibleLateAbsence)(shift, nowMs)
        && plannedStartEarly > 0) {
        const endEarly = endMs(shift);
        if (endEarly > 0 && nowMs > endEarly)
            return { allowed: false, rejectCode: 'SHIFT_ENDED' };
        return finishAllowed(plannedStartEarly, nowMs, false, !hasPriorLateNotice(shift));
    }
    if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
        return { allowed: false, rejectCode: 'ABSENT' };
    }
    const originEarly = String(shift.origin || '').toUpperCase();
    const ctEarly = String(shift.coverageType || '').toUpperCase();
    if (originEarly === 'OPERATIONS_COVERAGE' && ctEarly === 'EXTEND') {
        return { allowed: false, rejectCode: 'EXT_NO_CHECKIN' };
    }
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift) && ctEarly !== 'ADVANCE') {
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
    if (origin === 'OPERATIONS_COVERAGE' && ct === 'EXTEND') {
        return { allowed: false, rejectCode: 'EXT_NO_CHECKIN' };
    }
    if (origin === 'OPERATIONS_COVERAGE') {
        const anchor = convocadoPunchAnchorMs(shift);
        const cap = convocadoPunchCapMs(shift);
        if (anchor > 0 && nowMs < anchor)
            return { allowed: false, rejectCode: 'TOO_EARLY' };
        if (cap > 0 && nowMs > cap)
            return { allowed: false, rejectCode: 'SHIFT_ENDED' };
        return { allowed: true, usePlannedStart: false, lateMinutes: 0 };
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
        return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
    }
    const windowStart = plannedStart - 15 * 60 * 1000;
    const windowEnd = lateEtaDeadlineMs(shift, plannedStart);
    if (nowMs < windowStart)
        return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (nowMs > windowEnd)
        return { allowed: false, rejectCode: 'TOO_LATE' };
    return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
}
//# sourceMappingURL=checkInWindow.js.map