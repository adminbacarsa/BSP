"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAY_ON_TIME_GRACE_MS = void 0;
exports.resolveCheckInPayClock = resolveCheckInPayClock;
exports.PAY_ON_TIME_GRACE_MS = 5 * 60 * 1000;
function resolveCheckInPayClock(input) {
    const nowMs = input.nowMs;
    const plannedStartMs = input.plannedStartMs;
    const pastGrace = plannedStartMs > 0 && nowMs > plannedStartMs + exports.PAY_ON_TIME_GRACE_MS;
    const lateFromClock = plannedStartMs > 0
        ? Math.max(0, Math.round((nowMs - plannedStartMs) / 60000))
        : 0;
    const windowLate = Math.max(0, input.windowLateMinutes ?? 0);
    return {
        checkInAtMs: nowMs,
        realStartMs: pastGrace || !plannedStartMs ? nowMs : plannedStartMs,
        isLate: pastGrace,
        lateMinutes: pastGrace ? Math.max(lateFromClock, windowLate) : 0,
    };
}
//# sourceMappingURL=checkInPay.js.map