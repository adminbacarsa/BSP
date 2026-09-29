"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openLateAbsenceVacancy = openLateAbsenceVacancy;
const firestore_1 = require("firebase-admin/firestore");
const convocatoriasCobertura_1 = require("../coverage/convocatoriasCobertura");
const reliefEligibility_1 = require("../common/reliefEligibility");
const opsManualMode_1 = require("../ops/opsManualMode");
const lateAbsenceWindow_1 = require("./lateAbsenceWindow");
async function openLateAbsenceVacancy(db, shiftId) {
    const sid = String(shiftId || '').trim();
    if (!sid)
        return false;
    const ref = db.collection('turnos').doc(sid);
    const snap = await ref.get();
    if (!snap.exists)
        return false;
    const shift = snap.data();
    if (!(0, lateAbsenceWindow_1.lateVacancyDue)(shift, Date.now()))
        return false;
    const empresaId = String(shift.empresaId || '').trim() || 'bacarsa';
    const manual = await (0, opsManualMode_1.isEmpresaManualMode)(db, empresaId);
    if (!manual && !(0, reliefEligibility_1.isExtraNonReliefShift)(shift)) {
        const start = shift.startTime;
        if (start) {
            await (0, convocatoriasCobertura_1.iniciarCascadaCobertura)(db, {
                id: sid,
                objectiveId: String(shift.objectiveId || ''),
                objectiveName: String(shift.objectiveName || ''),
                positionName: String(shift.positionName || ''),
                clientId: String(shift.clientId || ''),
                clientName: String(shift.clientName || ''),
                code: String(shift.code || ''),
                startTime: start,
                endTime: shift.endTime,
                empresaId,
            }, 'AUTO');
        }
    }
    await ref.update({ absenceVacancyOpenedAt: firestore_1.Timestamp.now() });
    return true;
}
//# sourceMappingURL=openLateAbsenceVacancy.js.map