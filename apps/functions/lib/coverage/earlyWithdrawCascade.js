"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarEarlyWithdrawCascade = iniciarEarlyWithdrawCascade;
const firestore_1 = require("firebase-admin/firestore");
const eligibilityFilter_1 = require("./eligibilityFilter");
const convocatoriasCobertura_1 = require("./convocatoriasCobertura");
const escalarVacanteSinCobertura_1 = require("./escalarVacanteSinCobertura");
const EARLY_WITHDRAW_CASCADE = ['RET', 'REF', 'ESC', 'ADVANCE', 'FT'];
async function iniciarEarlyWithdrawCascade(db, shift, createdBy = 'AUTO') {
    const { isTitularAlreadyCovered, isActiveOpsCoverageDoc } = await Promise.resolve().then(() => require('./syncAusenciaCobertura'));
    const titularSnap = await db.collection('turnos').doc(shift.id).get();
    const titularData = (titularSnap.data() || {});
    if (isTitularAlreadyCovered(titularData))
        return;
    const priorCov = await db.collection('turnos').where('absenceShiftId', '==', shift.id).limit(20).get();
    if (priorCov.docs.some((d) => isActiveOpsCoverageDoc(d.data())))
        return;
    const existing = await db
        .collection('convocatorias_cobertura')
        .where('shiftId', '==', shift.id)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(1)
        .get();
    if (!existing.empty)
        return;
    const baseConvData = {
        empresaId: shift.empresaId,
        shiftId: shift.id,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        positionName: String(shift.positionName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type: 'RET',
        urgency: (0, eligibilityFilter_1.getUrgency)(shift.startTime),
        cascadeStep: 0,
        candidateEmployeeId: '',
        candidateEmployeeName: '',
        status: 'PENDING',
        timeoutAt: firestore_1.Timestamp.now(),
        createdAt: firestore_1.Timestamp.now(),
        createdBy,
    };
    for (const type of EARLY_WITHDRAW_CASCADE) {
        if (type === 'FT') {
            await (0, convocatoriasCobertura_1.dispararBroadcastFT)(db, baseConvData);
            return;
        }
        const candidate = await (0, convocatoriasCobertura_1.findBestCandidate)(db, baseConvData, type);
        if (!candidate)
            continue;
        if (type === 'ADVANCE' && candidate.advanceShiftId) {
            const advSnap = await db.collection('turnos').doc(candidate.advanceShiftId).get();
            const advEnd = advSnap.data()?.endTime?.toMillis?.() ?? 0;
            const gapEnd = shift.endTime?.toMillis?.() ?? 0;
            if (advEnd && gapEnd && (gapEnd - advEnd) / 3600000 > 4)
                continue;
        }
        await (0, convocatoriasCobertura_1.crearConvocatoriaDoc)(db, {
            ...baseConvData,
            type,
            cascadeStep: EARLY_WITHDRAW_CASCADE.indexOf(type),
            candidateEmployeeId: candidate.id,
            candidateEmployeeName: candidate.name,
            candidateUid: candidate.uid,
            ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
            ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
            createdBy,
        });
        return;
    }
    await (0, escalarVacanteSinCobertura_1.escalarVacanteSinCobertura)(db, {
        shiftId: shift.id,
        empresaId: shift.empresaId,
        objectiveId: shift.objectiveId,
        objectiveName: shift.objectiveName || '',
        positionName: shift.positionName || '',
        message: `Retiro anticipado: sin candidatos en ${shift.objectiveName || 'objetivo'}.`,
        attemptRetention: true,
        source: 'EARLY_WITHDRAW',
    });
}
//# sourceMappingURL=earlyWithdrawCascade.js.map