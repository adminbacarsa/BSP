"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSimulableShift = exports.simulableShiftSkipReason = exports.isLicenseShift = exports.isFrancoShiftCode = exports.isLicenseShiftCode = exports.shiftGridCode = exports.FRANCO_SHIFT_CODES = exports.LICENSE_SHIFT_CODES = void 0;
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
exports.shiftGridCode = shiftGridCode;
function isLicenseShiftCode(code) {
    return exports.LICENSE_SHIFT_CODES.has(normalizeCode(code));
}
exports.isLicenseShiftCode = isLicenseShiftCode;
function isFrancoShiftCode(code) {
    return exports.FRANCO_SHIFT_CODES.has(normalizeCode(code));
}
exports.isFrancoShiftCode = isFrancoShiftCode;
function isLicenseShift(data) {
    return isLicenseShiftCode(shiftGridCode(data));
}
exports.isLicenseShift = isLicenseShift;
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
exports.simulableShiftSkipReason = simulableShiftSkipReason;
function isSimulableShift(data) {
    return simulableShiftSkipReason(data) === null;
}
exports.isSimulableShift = isSimulableShift;
//# sourceMappingURL=simulableShift.js.map