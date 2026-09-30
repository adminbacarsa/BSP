"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASCADE_LOCK_MS = void 0;
exports.cascadeLockHeld = cascadeLockHeld;
exports.shouldAdvanceOnReject = shouldAdvanceOnReject;
exports.toMillisLoose = toMillisLoose;
exports.CASCADE_LOCK_MS = 90 * 1000;
function cascadeLockHeld(lockAtMs, nowMs) {
    if (!lockAtMs || !Number.isFinite(lockAtMs))
        return false;
    const age = nowMs - lockAtMs;
    return age >= 0 && age < exports.CASCADE_LOCK_MS;
}
function shouldAdvanceOnReject(previousStatus) {
    return String(previousStatus || '').toUpperCase() !== 'ESCALATED';
}
function toMillisLoose(value) {
    if (!value)
        return 0;
    const v = value;
    if (typeof v.toMillis === 'function')
        return v.toMillis();
    if (typeof v.seconds === 'number')
        return v.seconds * 1000;
    if (value instanceof Date)
        return value.getTime();
    if (typeof value === 'number')
        return value;
    return 0;
}
//# sourceMappingURL=cascadeGuards.js.map