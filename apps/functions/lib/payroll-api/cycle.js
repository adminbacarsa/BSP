"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTs = exports.listRecentCycles = exports.parseCycleId = exports.DEFAULT_CYCLE_END_DAY = exports.DEFAULT_CYCLE_START_DAY = void 0;
exports.arDayStart = arDayStart;
exports.arDayEnd = arDayEnd;
const admin = require("firebase-admin");
const PAD2 = (n) => String(n).padStart(2, '0');
const AR_OFFSET = '-03:00';
exports.DEFAULT_CYCLE_START_DAY = 26;
exports.DEFAULT_CYCLE_END_DAY = 25;
function arDayStart(year, month1to12, day) {
    return new Date(`${year}-${PAD2(month1to12)}-${PAD2(day)}T00:00:00.000${AR_OFFSET}`);
}
function arDayEnd(year, month1to12, day) {
    return new Date(`${year}-${PAD2(month1to12)}-${PAD2(day)}T23:59:59.999${AR_OFFSET}`);
}
const parseCycleId = (cycleId) => {
    const m = /^(\d{4})-(\d{2})$/.exec(cycleId);
    if (!m)
        return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!year || !month || month < 1 || month > 12)
        return null;
    const startAnchor = new Date(Date.UTC(year, month - 1, 1));
    startAnchor.setUTCMonth(startAnchor.getUTCMonth() - 1);
    const startY = startAnchor.getUTCFullYear();
    const startM = startAnchor.getUTCMonth() + 1;
    const cycleStart = arDayStart(startY, startM, exports.DEFAULT_CYCLE_START_DAY);
    const cycleEnd = arDayEnd(year, month, exports.DEFAULT_CYCLE_END_DAY);
    const fmt = (d) => {
        const ar = new Date(d.getTime() - 3 * 3600 * 1000);
        return `${ar.getUTCFullYear()}-${PAD2(ar.getUTCMonth() + 1)}-${PAD2(ar.getUTCDate())}`;
    };
    return {
        cycleId,
        cycleStart,
        cycleEnd,
        cycleStartStr: fmt(cycleStart),
        cycleEndStr: fmt(cycleEnd),
    };
};
exports.parseCycleId = parseCycleId;
const listRecentCycles = (count = 12, ref = new Date()) => {
    const out = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 15);
        const id = `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}`;
        const range = (0, exports.parseCycleId)(id);
        if (range)
            out.push(range);
    }
    return out;
};
exports.listRecentCycles = listRecentCycles;
const toTs = (d) => admin.firestore.Timestamp.fromDate(d);
exports.toTs = toTs;
//# sourceMappingURL=cycle.js.map