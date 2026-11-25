"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftWorkStartMs = exports.shiftHardCapAtMs = exports.STALE_CAP_GRACE_MS = exports.SHIFT_HARD_CAP_MS = void 0;
exports.buildAutoClosePatch = buildAutoClosePatch;
exports.clearRetentionOnReliefClose = clearRetentionOnReliefClose;
const firestore_1 = require("firebase-admin/firestore");
const shiftCloseCore_1 = require("./shiftCloseCore");
Object.defineProperty(exports, "SHIFT_HARD_CAP_MS", { enumerable: true, get: function () { return shiftCloseCore_1.SHIFT_HARD_CAP_MS; } });
Object.defineProperty(exports, "STALE_CAP_GRACE_MS", { enumerable: true, get: function () { return shiftCloseCore_1.STALE_CAP_GRACE_MS; } });
Object.defineProperty(exports, "shiftHardCapAtMs", { enumerable: true, get: function () { return shiftCloseCore_1.shiftHardCapAtMs; } });
Object.defineProperty(exports, "shiftWorkStartMs", { enumerable: true, get: function () { return shiftCloseCore_1.shiftWorkStartMs; } });
function patchPresenciaBloquesAlCerrar(data, realEnd) {
    const pb = data.presenciaBloques;
    if (!pb || typeof pb !== 'object')
        return {};
    const extra = {};
    for (const [key, raw] of Object.entries(pb)) {
        if (!raw || typeof raw !== 'object')
            continue;
        if (!raw.realStartTime)
            continue;
        if (raw.realEndTime || raw.cerrado === true)
            continue;
        extra[`presenciaBloques.${key}.realEndTime`] = realEnd;
        extra[`presenciaBloques.${key}.cerrado`] = true;
    }
    return extra;
}
function buildAutoClosePatch(data, opts) {
    const times = (0, shiftCloseCore_1.computeShiftCloseTimes)(data, opts.realEndMs);
    const realEnd = firestore_1.Timestamp.fromMillis(times.realEndMs);
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
        ...patchPresenciaBloquesAlCerrar(data, realEnd),
        ...(opts.extra || {}),
    };
    if (times.retentionEndedMs != null) {
        patch.retentionEndedAt = firestore_1.Timestamp.fromMillis(times.retentionEndedMs);
        if (times.retentionMinutes != null)
            patch.retentionMinutes = times.retentionMinutes;
    }
    return patch;
}
function clearRetentionOnReliefClose(patch) {
    patch.isRetention = false;
    patch.retentionReason = firestore_1.FieldValue.delete();
    return patch;
}
//# sourceMappingURL=shiftClose.js.map