"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revertConvocadoFalseAbsencesRun = revertConvocadoFalseAbsencesRun;
const firestore_1 = require("firebase-admin/firestore");
const convocadoTitularRevert_1 = require("./convocadoTitularRevert");
async function revertConvocadoFalseAbsencesRun(db, opts) {
    const empresaId = String(opts.empresaId || '').trim();
    const dryRun = opts.dryRun !== false;
    const rows = [];
    const snap = await db
        .collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('origin', '==', 'OPERATIONS_COVERAGE')
        .where('absenceDetectedBy', '==', 'CONVOCADO_NO_LLEGO')
        .limit(200)
        .get();
    let reverted = 0;
    for (const d of snap.docs) {
        const data = d.data();
        const titularId = String(data.absenceShiftId || data.coveredShiftId || '').trim();
        rows.push({ opsCovId: d.id, titularId, action: dryRun ? 'would_revert' : 'reverted' });
        if (dryRun)
            continue;
        await d.ref.update({
            isAbsent: false,
            status: 'CANCELLED',
            absenceType: null,
            absenceDetectedAt: null,
            absenceDetectedBy: null,
            coverageSuperseded: true,
            coverageSupersededAt: firestore_1.FieldValue.serverTimestamp(),
            coverageSupersededBy: 'REVERT_CONVOCADO_FALSE',
        });
        const ausSnap = await db.collection('ausencias').where('shiftId', '==', d.id).limit(5).get();
        for (const a of ausSnap.docs) {
            const origin = String(a.data().origin || '');
            if (origin === 'CONVOCADO_NO_LLEGO' || a.data().absenceType === 'AA') {
                await a.ref.update({ status: 'Anulada', anuladaAt: firestore_1.FieldValue.serverTimestamp() });
            }
        }
        if (titularId) {
            await (0, convocadoTitularRevert_1.revertTitularAfterConvocadoNoLlego)(db, { ...data, id: d.id });
            await (0, convocadoTitularRevert_1.cancelPendingConvocatoriasForTitular)(db, titularId);
        }
        reverted += 1;
    }
    return { dryRun, scanned: snap.size, reverted, rows };
}
//# sourceMappingURL=revertConvocadoFalseAbsences.js.map