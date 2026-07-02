"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dateKeyFromParts = dateKeyFromParts;
exports.getDayLetter = getDayLetter;
exports.buildMonthDays = buildMonthDays;
exports.previousMonth = previousMonth;
const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
function dateKeyFromParts(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function getDayLetter(dateStr) {
    const parts = dateStr.split('-').map(Number);
    const dow = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    return DAY_LETTERS[dow] ?? 'L';
}
function buildMonthDays(year, month) {
    const last = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= last; d++) {
        const dateStr = dateKeyFromParts(year, month, d);
        days.push({ dateStr, dayLetter: getDayLetter(dateStr) });
    }
    return days;
}
function previousMonth(year, month) {
    if (month <= 1)
        return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
}
//# sourceMappingURL=vplan.calendar.js.map