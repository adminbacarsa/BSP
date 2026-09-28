"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_CAP_GRACE_MS = exports.SHIFT_HARD_CAP_MS = void 0;
exports.shiftWorkStartMs = shiftWorkStartMs;
exports.shiftHardCapAtMs = shiftHardCapAtMs;
exports.buildAutoClosePatch = buildAutoClosePatch;
const firestore_1 = require("firebase-admin/firestore");
exports.SHIFT_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;
exports.STALE_CAP_GRACE_MS = 2 * 60 * 60 * 1000;
const ms = (v) => v?.toMillis?.() ?? 0;
function shiftWorkStartMs(data) {
    return ms(data.realStartTime) || ms(data.checkInTime) || ms(data.presenciaAt) || ms(data.startTime);
}
function shiftHardCapAtMs(data) {
    const start = shiftWorkStartMs(data);
    return start > 0 ? start + exports.SHIFT_HARD_CAP_MS : 0;
}
function buildAutoClosePatch(data, opts) {
    const capAt = shiftHardCapAtMs(data);
    const endMs = capAt > 0 ? Math.min(opts.realEndMs, capAt) : opts.realEndMs;
    const realEnd = firestore_1.Timestamp.fromMillis(endMs);
    const patch = {
        status: 'COMPLETED',
        isCompleted: true,
        isPresent: false,
        realEndTime: realEnd,
        completedAt: opts.now,
        completedBy: 'Sistema',
        autoCompletedAt: opts.now,
        autoCompletedBy: opts.by || 'SYSTEM_SCHEDULER',
        autoCloseReason: opts.reason,
        completionReason: opts.reason,
        ...(opts.extra || {}),
    };
    const plannedEnd = ms(data.endTime);
    if (data.isRetention === true) {
        patch.retentionEndedAt = realEnd;
        if (plannedEnd > 0 && endMs > plannedEnd) {
            patch.retentionMinutes = Math.round((endMs - plannedEnd) / 60000);
        }
    }
    return patch;
}
//# sourceMappingURL=shiftClose.js.map