"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOpsCoverageHoursOnSourceDoc = isOpsCoverageHoursOnSourceDoc;
exports.skipAbsencePipelineForShift = skipAbsencePipelineForShift;
function isOpsCoverageHoursOnSourceDoc(data) {
    if (!data)
        return false;
    if (data.coverageHoursOnSource === true)
        return true;
    const ct = String(data.coverageType || '').toUpperCase();
    if (String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE'
        && (ct === 'EXTEND' || ct === 'ADVANCE')) {
        return true;
    }
    return false;
}
function skipAbsencePipelineForShift(data) {
    return isOpsCoverageHoursOnSourceDoc(data);
}
//# sourceMappingURL=coverageTraceShift.js.map