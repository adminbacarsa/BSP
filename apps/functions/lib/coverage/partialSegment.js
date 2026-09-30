"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completesPartialSegment = completesPartialSegment;
exports.uncoveredRemainderMs = uncoveredRemainderMs;
const TOL_MS = 2 * 60 * 1000;
function completesPartialSegment(existingType, incomingType) {
    const ex = String(existingType || '').toUpperCase();
    const inc = String(incomingType || '').toUpperCase();
    if (!ex || !inc || ex === inc)
        return false;
    if ((ex === 'EXTEND' && inc === 'ADVANCE') || (ex === 'ADVANCE' && inc === 'EXTEND'))
        return true;
    if ((ex === 'EXTEND' || ex === 'ADVANCE') && ['FT', 'RET', 'REF', 'ESC'].includes(inc))
        return true;
    return false;
}
function uncoveredRemainderMs(gapStart, gapEnd, coveredStart, coveredEnd) {
    if (!gapStart || !gapEnd || gapEnd <= gapStart)
        return null;
    if (!coveredStart || !coveredEnd || coveredEnd <= coveredStart)
        return null;
    if (Math.abs(coveredStart - gapStart) <= TOL_MS && coveredEnd < gapEnd - TOL_MS) {
        return { startMs: coveredEnd, endMs: gapEnd };
    }
    if (Math.abs(coveredEnd - gapEnd) <= TOL_MS && coveredStart > gapStart + TOL_MS) {
        return { startMs: gapStart, endMs: coveredStart };
    }
    return null;
}
//# sourceMappingURL=partialSegment.js.map