"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.posMatchRelief = exports.RELEVO_GAP_ALIGN_MS = void 0;
exports.findPresentOutgoingAlignedToGapStart = findPresentOutgoingAlignedToGapStart;
exports.RELEVO_GAP_ALIGN_MS = 30 * 60 * 1000;
const normPos = (n) => String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
const posMatchRelief = (a, b) => {
    const na = normPos(a);
    const nb = normPos(b);
    if (!na || !nb)
        return false;
    if (na === nb)
        return true;
    if (na.endsWith(nb) || nb.endsWith(na))
        return true;
    return false;
};
exports.posMatchRelief = posMatchRelief;
const checkInMs = (data) => {
    const real = data.realStartTime;
    if (real?.toMillis)
        return real.toMillis();
    const ci = data.checkInTime;
    if (ci?.toMillis)
        return ci.toMillis();
    const pres = data.presenciaAt;
    if (pres?.toMillis)
        return pres.toMillis();
    const st = data.startTime;
    return st?.toMillis?.() ?? 0;
};
const endMs = (data) => {
    const et = data.endTime;
    return et?.toMillis?.() ?? 0;
};
const startMs = (data) => {
    const st = data.startTime;
    return st?.toMillis?.() ?? 0;
};
async function findPresentOutgoingAlignedToGapStart(db, params) {
    const objectiveId = String(params.objectiveId || '').trim();
    const gapStartMs = params.gapStartMs;
    if (!objectiveId || !gapStartMs)
        return null;
    const exclude = new Set(params.excludeShiftIds || []);
    const absentEmpId = String(params.excludeEmployeeId || '').trim();
    const presentSnap = await db
        .collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('isPresent', '==', true)
        .limit(40)
        .get();
    const outgoing = presentSnap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter(({ id, data }) => {
        if (exclude.has(id))
            return false;
        if (data.isCompleted === true)
            return false;
        if (String(data.relievedBy || '').trim())
            return false;
        if (data.isAbsent || data.isVirtual === true)
            return false;
        if (!(0, exports.posMatchRelief)(data.positionName, params.positionName))
            return false;
        const eid = String(data.employeeId || '').trim();
        if (!eid || eid === 'VACANTE' || (absentEmpId && eid === absentEmpId))
            return false;
        const st = startMs(data);
        if (st >= gapStartMs + 60_000)
            return false;
        const en = endMs(data);
        if (!en)
            return false;
        if (Math.abs(en - gapStartMs) > exports.RELEVO_GAP_ALIGN_MS)
            return false;
        return true;
    })
        .sort((a, b) => checkInMs(b.data) - checkInMs(a.data));
    const absenceShiftId = String(params.absenceShiftId || '').trim();
    for (const cand of outgoing) {
        const linked = String(cand.data.retentionAbsenceShiftId || '').trim();
        if (cand.data.isRetention === true
            && linked
            && absenceShiftId
            && linked !== absenceShiftId) {
            continue;
        }
        return cand;
    }
    return null;
}
//# sourceMappingURL=relevoOutgoingMatch.js.map