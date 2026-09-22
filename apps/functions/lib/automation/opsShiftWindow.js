"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPS_ZOMBIE_PRESENT_MAX_MS = exports.OPS_PLAN_LOOKAHEAD_MS = void 0;
exports.opsMonitorQueryWindow = opsMonitorQueryWindow;
exports.isOpsShiftHoyServer = isOpsShiftHoyServer;
const firestore_1 = require("firebase-admin/firestore");
exports.OPS_PLAN_LOOKAHEAD_MS = 16 * 60 * 60 * 1000;
exports.OPS_ZOMBIE_PRESENT_MAX_MS = 48 * 60 * 60 * 1000;
function turnoTimestamp(row, key) {
    const value = row[key];
    return value instanceof firestore_1.Timestamp ? value : null;
}
function normalizeCode(row) {
    return String(row.code ?? '').trim().toUpperCase();
}
function isRestFrancoShift(row) {
    if (!row || row.isFrancoTrabajado === true)
        return false;
    const code = normalizeCode(row);
    if (code === 'F' || code === 'FF' || code === 'FP')
        return true;
    if (row.isFrancoCompensatorio === true)
        return true;
    if (row.isFranco === true || row.objectiveName === 'FRANCO')
        return true;
    return false;
}
function arYmdFromDate(d) {
    const msAr = d.getTime() - 3 * 60 * 60 * 1000;
    return new Date(msAr).toISOString().slice(0, 10);
}
function arYmdFromTimestamp(ts) {
    return arYmdFromDate(ts.toDate());
}
function opsMonitorQueryWindow(now) {
    return {
        start: new Date(now.getTime() - exports.OPS_ZOMBIE_PRESENT_MAX_MS),
        end: new Date(now.getTime() + exports.OPS_PLAN_LOOKAHEAD_MS),
    };
}
function isOpsShiftHoyServer(row, now) {
    if (row.isCompleted === true && row.isReten !== true && !isRestFrancoShift(row)) {
        return false;
    }
    const start = turnoTimestamp(row, 'startTime');
    const end = turnoTimestamp(row, 'endTime');
    if (!start)
        return false;
    if (row.isVirtual === true && end) {
        if (arYmdFromTimestamp(start) !== arYmdFromDate(now) &&
            end.toMillis() < now.getTime()) {
            return false;
        }
    }
    const nowMs = now.getTime();
    const startMs = start.toMillis();
    let endMs = end?.toMillis() ?? 0;
    if (startMs > 0 && endMs > 0 && endMs <= startMs)
        endMs += 86400000;
    if (arYmdFromTimestamp(start) === arYmdFromDate(now))
        return true;
    if ((row.isPresent === true || row.isReten === true || row.isRetention === true) &&
        row.isCompleted !== true) {
        return startMs > 0 && nowMs - startMs <= exports.OPS_ZOMBIE_PRESENT_MAX_MS;
    }
    if (startMs > 0 && endMs > nowMs && startMs <= nowMs)
        return true;
    if (startMs > nowMs && startMs - nowMs <= exports.OPS_PLAN_LOOKAHEAD_MS)
        return true;
    return false;
}
//# sourceMappingURL=opsShiftWindow.js.map