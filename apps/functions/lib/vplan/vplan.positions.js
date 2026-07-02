"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.is24hsPosition = is24hsPosition;
exports.isPositionActiveOnDay = isPositionActiveOnDay;
exports.shiftBandHours = shiftBandHours;
exports.normalizeSlaPositions = normalizeSlaPositions;
function is24hsPosition(pos) {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}
function isPositionActiveOnDay(pos, dayLetter) {
    const days = pos.activeDays;
    if (!days || days.length === 0)
        return true;
    return days.includes(dayLetter);
}
function shiftBandHours(shift) {
    const h = Number(shift.hours);
    if (Number.isFinite(h) && h > 0)
        return h;
    const code = String(shift.code || '').toUpperCase();
    if (code === 'D12' || code === 'N12')
        return 12;
    return 8;
}
function normalizeSlaPositions(rawPositions) {
    if (!Array.isArray(rawPositions))
        return [];
    return rawPositions.map((p) => {
        const rawShifts = (p.allowedShiftTypes || p.shifts || []);
        const shifts = rawShifts.map((s) => ({
            code: String(s.code || '').toUpperCase(),
            hours: Number(s.hours) || shiftBandHours({ code: String(s.code || '') }),
            startTime: s.startTime ? String(s.startTime) : undefined,
            endTime: s.endTime ? String(s.endTime) : undefined,
        })).filter((s) => s.code);
        return {
            positionName: String(p.name || p.positionName || 'General'),
            qty: Math.max(1, Number(p.quantity ?? p.qty) || 1),
            coverageType: String(p.coverageType || 'custom'),
            shifts: shifts.length > 0 ? shifts : [{ code: 'M', hours: 8 }],
            activeDays: Array.isArray(p.activeDays) ? p.activeDays.map(String) : undefined,
        };
    });
}
//# sourceMappingURL=vplan.positions.js.map