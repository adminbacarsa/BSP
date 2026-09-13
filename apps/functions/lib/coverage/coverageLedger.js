"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newCoverageEventId = newCoverageEventId;
exports.resolveTitularFromAbsenceOrVacancy = resolveTitularFromAbsenceOrVacancy;
exports.covererLedgerFields = covererLedgerFields;
exports.coveredPartyLedgerFields = coveredPartyLedgerFields;
exports.applyCoverageLedgerToBatch = applyCoverageLedgerToBatch;
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
const isVirtualShiftId = (id) => {
    const s = String(id || '');
    return !s || s.startsWith('V124_') || s.startsWith('SLA_GAP');
};
function newCoverageEventId() {
    try {
        return `cov_${(0, crypto_1.randomUUID)()}`;
    }
    catch {
        return `cov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
}
function resolveTitularFromAbsenceOrVacancy(absenceShift) {
    const causedRaw = absenceShift?.causedByShiftId
        || absenceShift?.originRef
        || null;
    const caused = causedRaw && !isVirtualShiftId(causedRaw) ? String(causedRaw) : null;
    const originUp = String(absenceShift?.origin || '').toUpperCase();
    const isVac = absenceShift?.isUnassigned === true
        || absenceShift?.employeeId === 'VACANTE'
        || String(absenceShift?.employeeName || '').toUpperCase().startsWith('VACANTE')
        || originUp.startsWith('VACANTE_')
        || originUp === 'INTERRUPTION';
    const vacancyShiftId = isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id) && !absenceShift?.isVirtual
        ? String(absenceShift.id)
        : null;
    const titularShiftId = absenceShift?.sourceShiftDeleted === true
        ? null
        : (caused
            || (!isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id)
                ? String(absenceShift.id)
                : null));
    const titularEmployeeId = (absenceShift?.causedByEmployeeId && absenceShift.causedByEmployeeId !== 'VACANTE'
        ? String(absenceShift.causedByEmployeeId)
        : null)
        || (!isVac && absenceShift?.employeeId && absenceShift.employeeId !== 'VACANTE'
            ? String(absenceShift.employeeId)
            : null);
    const titularEmployeeName = String(absenceShift?.causedByEmployeeName
        || (!isVac
            && absenceShift?.employeeName
            && !String(absenceShift.employeeName).toUpperCase().startsWith('VACANTE')
            ? absenceShift.employeeName
            : '')
        || '').trim();
    return { titularShiftId, titularEmployeeId, titularEmployeeName, vacancyShiftId };
}
function covererLedgerFields(input) {
    const titularName = String(input.titularEmployeeName || '').trim();
    return {
        coverageEventId: input.coverageEventId,
        coversEmployeeId: input.titularEmployeeId || null,
        coversAbsenceEmployeeName: titularName || null,
        absenceShiftId: input.vacancyShiftId || input.titularShiftId || null,
        causedByShiftId: input.titularShiftId || input.causedByShiftIdPreserve || null,
        coverageType: input.coverageType,
        resolvedBy: input.resolvedBy || 'AUTO',
        coveredAt: firestore_1.FieldValue.serverTimestamp(),
        comments: titularName
            ? `Cubriendo a ${titularName} (${input.coverageType})`
            : `Cobertura ${input.coverageType}`,
        ...(input.covererExtra || {}),
    };
}
function coveredPartyLedgerFields(input, kind) {
    const base = {
        coverageEventId: input.coverageEventId,
        coveredByEmployeeId: input.covererEmployeeId,
        coveredByEmployeeName: input.covererEmployeeName,
        coverageType: input.coverageType,
        resolvedBy: input.resolvedBy || 'AUTO',
        coveredAt: firestore_1.FieldValue.serverTimestamp(),
        operacionallyCovered: true,
        ...(kind === 'vacancy' ? input.vacancyExtra || {} : {}),
    };
    if (kind === 'vacancy' && input.markVacancyCovered !== false) {
        base.status = 'COVERED';
    }
    return base;
}
function applyCoverageLedgerToBatch(batch, db, input) {
    const coverageEventId = input.coverageEventId || newCoverageEventId();
    const payload = { ...input, coverageEventId };
    if (input.vacancyShiftId && !isVirtualShiftId(input.vacancyShiftId)) {
        batch.update(db.collection('turnos').doc(input.vacancyShiftId), coveredPartyLedgerFields(payload, 'vacancy'));
    }
    if (input.titularShiftId
        && !isVirtualShiftId(input.titularShiftId)
        && input.titularShiftId !== input.vacancyShiftId) {
        batch.update(db.collection('turnos').doc(input.titularShiftId), coveredPartyLedgerFields(payload, 'titular'));
    }
    if (input.covererShiftId && !isVirtualShiftId(input.covererShiftId)) {
        batch.update(db.collection('turnos').doc(input.covererShiftId), covererLedgerFields(payload));
    }
    return coverageEventId;
}
//# sourceMappingURL=coverageLedger.js.map