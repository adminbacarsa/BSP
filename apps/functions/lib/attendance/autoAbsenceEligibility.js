"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_ABSENCE_MAX_SPAN_MS = void 0;
exports.isAutoAbsenceSpanPlausible = isAutoAbsenceSpanPlausible;
exports.AUTO_ABSENCE_MAX_SPAN_MS = 13 * 60 * 60 * 1000;
function isAutoAbsenceSpanPlausible(startMs, endMs) {
    if (!startMs || !endMs)
        return true;
    const span = endMs - startMs;
    if (span <= 0)
        return true;
    return span <= exports.AUTO_ABSENCE_MAX_SPAN_MS;
}
//# sourceMappingURL=autoAbsenceEligibility.js.map