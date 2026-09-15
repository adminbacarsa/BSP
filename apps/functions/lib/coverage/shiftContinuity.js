"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasTuraOrExtension = hasTuraOrExtension;
exports.employeeHasPosteriorShift = employeeHasPosteriorShift;
exports.decideShiftCloseOrRetain = decideShiftCloseOrRetain;
exports.vacancyCoverageLabel = vacancyCoverageLabel;
exports.isPassiveStandbyCode = isPassiveStandbyCode;
exports.hasCoverageLedgerWithoutRealCode = hasCoverageLedgerWithoutRealCode;
exports.buildReassignPassiveToVacancyFields = buildReassignPassiveToVacancyFields;
exports.toTimestampMs = toTimestampMs;
const firestore_1 = require("firebase-admin/firestore");
function hasTuraOrExtension(shift) {
    if (shift.isExtended === true)
        return true;
    if (shift.retentionEndTime)
        return true;
    const code = String(shift.code || '').toUpperCase();
    if (code === 'D12' || code === 'N12' || code === 'TURA')
        return true;
    if (String(shift.extendedBy || '') === 'CONVOCATORIA' || String(shift.extendedBy || '') === 'TURA')
        return true;
    return false;
}
function employeeHasPosteriorShift(params) {
    const { employeeId, objectiveId, currentShiftId, currentEndMs, dayShifts } = params;
    if (!employeeId || !objectiveId || !currentEndMs)
        return false;
    const skipCodes = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'SUS']);
    for (const s of dayShifts) {
        if (s.id === currentShiftId)
            continue;
        if (String(s.employeeId || '') !== employeeId)
            continue;
        if (String(s.objectiveId || '') !== objectiveId)
            continue;
        if (s.isFranco)
            continue;
        const code = String(s.code || '').toUpperCase();
        if (skipCodes.has(code))
            continue;
        const startMs = s.startTime?.toMillis?.() ?? (s.startTime?.seconds ? s.startTime.seconds * 1000 : 0);
        if (startMs > currentEndMs - 5 * 60 * 1000)
            return true;
    }
    return false;
}
function decideShiftCloseOrRetain(params) {
    const { shift, requiresContinuousCoverage24h, hasPosteriorShift } = params;
    if (requiresContinuousCoverage24h) {
        return { action: 'RETAIN', reason: 'CONTINUIDAD_24HS' };
    }
    if (hasPosteriorShift) {
        return { action: 'RETAIN', reason: 'TURNO_POSTERIOR_MISMO_OBJETIVO' };
    }
    if (hasTuraOrExtension(shift)) {
        return { action: 'RETAIN', reason: 'EXTENSION_TURA_ACTIVA' };
    }
    return { action: 'AUTO_CLOSE', reason: 'SIN_POSTERIOR_NI_EXTENSION' };
}
function vacancyCoverageLabel(params) {
    const who = String(params.titularName || '').trim() || 'titular';
    const code = String(params.shiftCode || '').trim().toUpperCase() || '—';
    const pos = String(params.positionName || '').trim();
    const obj = String(params.objectiveName || '').trim();
    const tr = String(params.timeRange || '').trim();
    return [
        `Vacante por ausencia de ${who}`,
        `turno ${code}`,
        pos ? `puesto ${pos}` : '',
        obj || '',
        tr || '',
    ].filter(Boolean).join(' · ');
}
function isPassiveStandbyCode(code) {
    const c = String(code || '').toUpperCase();
    return c === 'RET' || c === 'ESC' || c === 'REF';
}
function hasCoverageLedgerWithoutRealCode(shift) {
    if (!isPassiveStandbyCode(shift?.code))
        return false;
    if (String(shift?.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE')
        return true;
    if (shift?.coversAbsenceEmployeeName || shift?.absenceEmployeeName)
        return true;
    if (shift?.absenceShiftId || shift?.coveredShiftId)
        return true;
    if (shift?.coverageEventId && shift?.previousPassiveCode)
        return true;
    return false;
}
function buildReassignPassiveToVacancyFields(vacancy, opts) {
    const prev = String(opts.previousCode || opts.coverageType).toUpperCase();
    const gapPos = vacancy.positionName || null;
    return {
        code: String(vacancy.code || vacancy.shiftCode || 'M').toUpperCase(),
        objectiveId: vacancy.objectiveId || null,
        objectiveName: vacancy.objectiveName || null,
        clientId: vacancy.clientId || null,
        clientName: vacancy.clientName || null,
        positionName: gapPos,
        startTime: vacancy.startTime || null,
        endTime: vacancy.endTime || null,
        plannedStartTime: vacancy.startTime || null,
        plannedEndTime: vacancy.endTime || null,
        isReten: false,
        isFranco: false,
        origin: 'OPERATIONS_COVERAGE',
        coverageType: opts.coverageType,
        previousPassiveCode: prev,
        ...(opts.previousPositionName
            ? {
                previousPositionName: opts.previousPositionName,
                homePositionName: opts.previousPositionName,
                coversPositionName: gapPos,
            }
            : {}),
        reassignedFromPassiveAt: firestore_1.FieldValue.serverTimestamp(),
        resolvedBy: opts.resolvedBy || 'AUTO',
        ...(opts.coverageEventId ? { coverageEventId: opts.coverageEventId } : {}),
    };
}
function toTimestampMs(t) {
    if (!t)
        return 0;
    if (t instanceof firestore_1.Timestamp)
        return t.toMillis();
    if (typeof t.toMillis === 'function')
        return t.toMillis();
    if (typeof t.seconds === 'number')
        return t.seconds * 1000;
    return 0;
}
//# sourceMappingURL=shiftContinuity.js.map