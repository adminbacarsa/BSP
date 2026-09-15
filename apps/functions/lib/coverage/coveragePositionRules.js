"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CROSS_OBJ_MAX_KM = void 0;
exports.normCoveragePositionName = normCoveragePositionName;
exports.coverageHaversineKm = coverageHaversineKm;
exports.countPresentInPositionDocs = countPresentInPositionDocs;
exports.canSparePresentFromDocs = canSparePresentFromDocs;
exports.isWithinCrossObjRadiusKm = isWithinCrossObjRadiusKm;
exports.CROSS_OBJ_MAX_KM = 10;
function normCoveragePositionName(p) {
    return String(p || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function coverageHaversineKm(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
        return Infinity;
    const a = Number(lat1);
    const b = Number(lon1);
    const c = Number(lat2);
    const d = Number(lon2);
    if (![a, b, c, d].every((n) => Number.isFinite(n)))
        return Infinity;
    const R = 6371;
    const dLat = ((c - a) * Math.PI) / 180;
    const dLon = ((d - b) * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function countPresentInPositionDocs(docs, objectiveId, positionName, dayStartMs) {
    const oid = String(objectiveId || '').trim();
    const pos = normCoveragePositionName(positionName);
    if (!oid || !pos)
        return 0;
    const anchorKey = dayStartMs
        ? new Date(dayStartMs - 3 * 3600 * 1000).toISOString().slice(0, 10)
        : null;
    return docs.filter((d) => {
        const t = d.data();
        if (!t.employeeId || t.employeeId === 'VACANTE')
            return false;
        if (t.isUnassigned || t.isAbsent || t.isFranco || t.isCompleted)
            return false;
        if (t.isPresent !== true)
            return false;
        if (String(t.objectiveId || '').trim() !== oid)
            return false;
        if (normCoveragePositionName(t.positionName) !== pos)
            return false;
        if (anchorKey) {
            const sec = t.startTime?.seconds ?? t.plannedStartTime?.seconds;
            if (typeof sec !== 'number')
                return true;
            const key = new Date(sec * 1000 - 3 * 3600 * 1000).toISOString().slice(0, 10);
            if (key !== anchorKey)
                return false;
        }
        return true;
    }).length;
}
function canSparePresentFromDocs(docs, source) {
    const oid = String(source.objectiveId || '').trim();
    const pos = String(source.positionName || '').trim();
    if (!oid || !pos)
        return false;
    const dayMs = source.startTime?.seconds ? source.startTime.seconds * 1000 : undefined;
    return countPresentInPositionDocs(docs, oid, pos, dayMs) >= 2;
}
function isWithinCrossObjRadiusKm(distanceKm, maxKm = exports.CROSS_OBJ_MAX_KM) {
    return Number.isFinite(distanceKm) && distanceKm <= maxKm;
}
//# sourceMappingURL=coveragePositionRules.js.map