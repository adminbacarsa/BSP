"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arDayBoundsMs = exports.arPlanificacionEstadoKey = exports.arYearMonth = exports.arHmOnYmdMs = exports.arHmOnDayMs = exports.arYmd = exports.arHour = exports.arMidnightMs = exports.AR_OFFSET_MS = void 0;
exports.AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
function arMidnightMs(ms) {
    return Math.floor((ms - exports.AR_OFFSET_MS) / DAY_MS) * DAY_MS + exports.AR_OFFSET_MS;
}
exports.arMidnightMs = arMidnightMs;
function arHour(ms) {
    return new Date(ms - exports.AR_OFFSET_MS).getUTCHours();
}
exports.arHour = arHour;
function arYmd(ms) {
    return new Date(ms - exports.AR_OFFSET_MS).toISOString().slice(0, 10);
}
exports.arYmd = arYmd;
function arHmOnDayMs(dayMs, h, m) {
    return arMidnightMs(dayMs) + (h * 60 + m) * 60 * 1000;
}
exports.arHmOnDayMs = arHmOnDayMs;
function arHmOnYmdMs(ymd, h, m) {
    const [y, mo, d] = ymd.split('-').map(Number);
    return Date.UTC(y, (mo || 1) - 1, d || 1) + exports.AR_OFFSET_MS + (h * 60 + m) * 60 * 1000;
}
exports.arHmOnYmdMs = arHmOnYmdMs;
function arYearMonth(ms) {
    const d = new Date(ms - exports.AR_OFFSET_MS);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
exports.arYearMonth = arYearMonth;
function arPlanificacionEstadoKey(objectiveId, ms) {
    const { year, month } = arYearMonth(ms);
    return `${objectiveId}_${year}_${month}`;
}
exports.arPlanificacionEstadoKey = arPlanificacionEstadoKey;
function arDayBoundsMs(ms) {
    const startMs = arMidnightMs(ms);
    return { startMs, endMs: startMs + DAY_MS - 1000 };
}
exports.arDayBoundsMs = arDayBoundsMs;
//# sourceMappingURL=arClock.js.map