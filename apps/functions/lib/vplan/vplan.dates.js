"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VPLAN_AR_TIMEZONE = void 0;
exports.formatDateStrCordoba = formatDateStrCordoba;
const firestore_1 = require("firebase-admin/firestore");
exports.VPLAN_AR_TIMEZONE = 'America/Argentina/Cordoba';
function timestampToDate(val) {
    if (!val)
        return null;
    if (val instanceof firestore_1.Timestamp)
        return val.toDate();
    if (val instanceof Date)
        return val;
    if (typeof val === 'object' && val !== null && 'toDate' in val && typeof val.toDate === 'function') {
        return val.toDate();
    }
    if (typeof val === 'object' && val !== null && 'seconds' in val) {
        const s = Number(val.seconds);
        if (Number.isFinite(s))
            return new Date(s * 1000);
    }
    return null;
}
function formatDateStrCordoba(val) {
    if (val == null)
        return null;
    if (typeof val === 'string') {
        const s = val.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s))
            return s.slice(0, 10);
        const parsed = Date.parse(s);
        if (!Number.isFinite(parsed))
            return null;
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: exports.VPLAN_AR_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(parsed));
    }
    const d = timestampToDate(val);
    if (!d || Number.isNaN(d.getTime()))
        return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: exports.VPLAN_AR_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
//# sourceMappingURL=vplan.dates.js.map