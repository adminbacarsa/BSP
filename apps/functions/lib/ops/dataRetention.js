"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONLINE_MONTHS_SPAN = exports.HOT_CLOSED_MONTHS = void 0;
exports.toYearMonth = toYearMonth;
exports.addCalendarMonths = addCalendarMonths;
exports.compareYearMonth = compareYearMonth;
exports.calendarMonthBounds = calendarMonthBounds;
exports.hotYearMonths = hotYearMonths;
exports.hotWindow = hotWindow;
exports.onlineOldestYearMonth = onlineOldestYearMonth;
exports.classifyYearMonth = classifyYearMonth;
exports.classifyDate = classifyDate;
exports.HOT_CLOSED_MONTHS = 2;
exports.ONLINE_MONTHS_SPAN = 12;
function toYearMonth(d) {
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function addCalendarMonths(ym, delta) {
    const idx = ym.year * 12 + (ym.month - 1) + delta;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
function compareYearMonth(a, b) {
    return a.year * 12 + a.month - (b.year * 12 + b.month);
}
function calendarMonthBounds(ym) {
    return {
        start: new Date(ym.year, ym.month - 1, 1, 0, 0, 0, 0),
        end: new Date(ym.year, ym.month, 0, 23, 59, 59, 999),
    };
}
function hotYearMonths(now = new Date()) {
    const cur = toYearMonth(now);
    const out = [];
    for (let i = exports.HOT_CLOSED_MONTHS; i >= 0; i -= 1) {
        out.push(addCalendarMonths(cur, -i));
    }
    return out;
}
function hotWindow(now = new Date()) {
    const months = hotYearMonths(now);
    return {
        start: calendarMonthBounds(months[0]).start,
        end: calendarMonthBounds(months[months.length - 1]).end,
        months,
    };
}
function onlineOldestYearMonth(now = new Date()) {
    return addCalendarMonths(toYearMonth(now), -(exports.ONLINE_MONTHS_SPAN - 1));
}
function classifyYearMonth(year, month, now = new Date()) {
    const ym = { year, month };
    const hot = hotYearMonths(now);
    if (hot.some((h) => h.year === ym.year && h.month === ym.month))
        return 'hot';
    const oldest = onlineOldestYearMonth(now);
    if (compareYearMonth(ym, oldest) >= 0)
        return 'warm';
    return 'cold';
}
function classifyDate(d, now = new Date()) {
    return classifyYearMonth(d.getFullYear(), d.getMonth() + 1, now);
}
//# sourceMappingURL=dataRetention.js.map