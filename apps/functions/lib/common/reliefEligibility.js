"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_RELIEF_EXTRA_CODES = void 0;
exports.reliefShiftCode = reliefShiftCode;
exports.reliefIneligibleReason = reliefIneligibleReason;
exports.isReliefEligibleShift = isReliefEligibleShift;
exports.isExtraNonReliefShift = isExtraNonReliefShift;
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
exports.NON_RELIEF_EXTRA_CODES = new Set(['ESC', 'REF', 'RET']);
const RELIEF_LICENSE_CODES = new Set([
    'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);
const RELIEF_FRANCO_CODES = new Set(['F', 'FF', 'FP']);
function normCode(value) {
    return String(value ?? '').trim().toUpperCase();
}
function reliefShiftCode(shift) {
    if (!shift)
        return '';
    return normCode(shift.code) || normCode(shift.type) || normCode(shift.shiftCode);
}
function isActiveCoverageDoc(shift) {
    if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE')
        return false;
    if (shift.coverageSuperseded === true)
        return false;
    if (String(shift.status || '').toUpperCase() === 'CANCELLED')
        return false;
    if (shift.isDeleted === true)
        return false;
    return true;
}
function reliefIneligibleReason(shift) {
    if (!shift)
        return 'SIN_TURNO';
    if (shift.draft === true)
        return 'DRAFT';
    if (shift.isVirtual === true)
        return 'VIRTUAL';
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift))
        return 'OPS_COV_TRACE';
    const code = reliefShiftCode(shift);
    if (RELIEF_LICENSE_CODES.has(code))
        return 'LICENCIA';
    if (shift.isFranco === true || RELIEF_FRANCO_CODES.has(code))
        return 'FRANCO';
    if (exports.NON_RELIEF_EXTRA_CODES.has(code) && !isActiveCoverageDoc(shift))
        return 'EXTRA_NO_RELEVA';
    return null;
}
function isReliefEligibleShift(shift) {
    return reliefIneligibleReason(shift) === null;
}
function isExtraNonReliefShift(shift) {
    return reliefIneligibleReason(shift) === 'EXTRA_NO_RELEVA';
}
//# sourceMappingURL=reliefEligibility.js.map