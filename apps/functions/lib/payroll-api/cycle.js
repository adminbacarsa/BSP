"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTs = exports.listRecentCycles = exports.parseCycleId = exports.DEFAULT_CYCLE_END_DAY = exports.DEFAULT_CYCLE_START_DAY = void 0;
const admin = require("firebase-admin");
const PAD2 = (n) => String(n).padStart(2, '0');
exports.DEFAULT_CYCLE_START_DAY = 26;
exports.DEFAULT_CYCLE_END_DAY = 25;
const parseCycleId = (cycleId) => {
    const m = /^(\d{4})-(\d{2})$/.exec(cycleId);
    if (!m)
        return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!year || !month || month < 1 || month > 12)
        return null;
    const cycleStart = new Date(year, month - 2, exports.DEFAULT_CYCLE_START_DAY, 0, 0, 0, 0);
    const cycleEnd = new Date(year, month - 1, exports.DEFAULT_CYCLE_END_DAY, 23, 59, 59, 999);
    const fmt = (d) => `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`;
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