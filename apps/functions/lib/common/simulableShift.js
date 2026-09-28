"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRANCO_SHIFT_CODES = exports.LICENSE_SHIFT_CODES = void 0;
exports.shiftGridCode = shiftGridCode;
exports.isLicenseShiftCode = isLicenseShiftCode;
exports.isFrancoShiftCode = isFrancoShiftCode;
exports.isLicenseShift = isLicenseShift;
exports.simulableShiftSkipReason = simulableShiftSkipReason;
exports.isSimulableShift = isSimulableShift;
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
exports.LICENSE_SHIFT_CODES = new Set([
    'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);
exports.FRANCO_SHIFT_CODES = new Set(['F', 'FF', 'FP']);
function normalizeCode(value) {
    return String(value ?? '').trim().toUpperCase();
}
function shiftGridCode(data) {
    if (!data)
        return '';
    return normalizeCode(data.code) || normalizeCode(data.shiftCode);
}
function isLicenseShiftCode(code) {
    return exports.LICENSE_SHIFT_CODES.has(normalizeCode(code));
}
function isFrancoShiftCode(code) {
    return exports.FRANCO_SHIFT_CODES.has(normalizeCode(code));
}
function isLicenseShift(data) {
    return isLicenseShiftCode(shiftGridCode(data));
}
function simulableShiftSkipReason(data) {
    if (!data)
        return 'VIRTUAL';
    if (data.draft === true)
        return 'DRAFT';
    if (data.isVirtual === true)
        return 'VIRTUAL';
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(data))
        return 'OPS_COV_TRACE';
    const code = shiftGridCode(data);
    if (isLicenseShiftCode(code))
        return 'LICENCIA';
    if (data.isFranco === true || isFrancoShiftCode(code))
        return 'FRANCO';
    return null;
}
function isSimulableShift(data) {
    return simulableShiftSkipReason(data) === null;
}
//# sourceMappingURL=simulableShift.js.map