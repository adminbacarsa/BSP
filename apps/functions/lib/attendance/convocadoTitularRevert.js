"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revertTitularAfterConvocadoNoLlego = revertTitularAfterConvocadoNoLlego;
exports.cancelPendingConvocatoriasForTitular = cancelPendingConvocatoriasForTitular;
const firestore_1 = require("firebase-admin/firestore");
const syncAusenciaCobertura_1 = require("../coverage/syncAusenciaCobertura");
async function revertTitularAfterConvocadoNoLlego(db, opsCov) {
    const titularId = String(opsCov.absenceShiftId || opsCov.coveredShiftId || '').trim();
    if (!titularId)
        return false;
    const batch = db.batch();
    const opsRef = db.collection('turnos').doc(opsCov.id);
    const opsSnap = await opsRef.get();
    if (!opsSnap.exists)
        return false;
    const opsData = opsSnap.data();
    if ((0, syncAusenciaCobertura_1.isActiveOpsCoverageDoc)(opsData)) {
        const sourceId = String(opsData.sourceShiftId || '').trim();
        if (sourceId) {
            batch.update(db.collection('turnos').doc(sourceId), (0, syncAusenciaCobertura_1.clearSourceCoverageUsedPatch)());
        }
        batch.update(opsRef, {
            coverageSuperseded: true,
            coverageSupersededAt: firestore_1.FieldValue.serverTimestamp(),
            coverageSupersededBy: 'CONVOCADO_NO_LLEGO',
            status: 'CANCELLED',
        });
    }
    const titRef = db.collection('turnos').doc(titularId);
    const titSnap = await titRef.get();
    if (titSnap.exists) {
        batch.update(titRef, {
            operacionallyCovered: false,
            coverageStatus: 'PENDING',
            coveredByEmployeeId: null,
            coveredByEmployeeName: null,
            coverageDocId: null,
            coverageType: null,
            coverageConvocatoriaId: null,
            coverageClaimConvocatoriaId: null,
            resolvedBy: null,
        });
    }
    const ausSnap = await db.collection('ausencias').where('shiftId', '==', titularId).limit(10).get();
    for (const d of ausSnap.docs) {
        batch.update(d.ref, {
            coberturaEstado: 'PENDIENTE',
            status: 'Pendiente',
            coveredByEmployeeId: null,
            coveredByEmployeeName: null,
            coverageType: null,
            coberturaResolvedAt: null,
            coberturaResolvedBy: null,
        });
    }
    await batch.commit();
    return true;
}
async function cancelPendingConvocatoriasForTitular(db, titularShiftId) {
    const tid = String(titularShiftId || '').trim();
    if (!tid)
        return 0;
    const snap = await db
        .collection('convocatorias_cobertura')
        .where('shiftId', '==', tid)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(20)
        .get();
    let n = 0;
    for (const d of snap.docs) {
        await d.ref.update({
            status: 'CANCELLED',
            resolvedAt: firestore_1.Timestamp.now(),
            rejectionReason: 'CONVOCADO_NO_LLEGO_REVERT',
        });
        n += 1;
    }
    return n;
}
//# sourceMappingURL=convocadoTitularRevert.js.map