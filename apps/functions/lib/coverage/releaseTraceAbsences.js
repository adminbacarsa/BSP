"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseTraceAbsencesRun = releaseTraceAbsencesRun;
const firestore_1 = require("firebase-admin/firestore");
const coverageTraceShift_1 = require("./coverageTraceShift");
const coverageRetention_1 = require("./coverageRetention");
async function releaseTraceAbsencesRun(db, opts) {
    const dryRun = opts.dryRun !== false;
    const empresaFilter = String(opts.empresaId || '').trim();
    const snap = await db
        .collection('turnos')
        .where('origin', '==', 'OPERATIONS_COVERAGE')
        .where('isAbsent', '==', true)
        .limit(200)
        .get();
    const rows = [];
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if (!(0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift))
            continue;
        if (empresaFilter && String(shift.empresaId || '') !== empresaFilter)
            continue;
        rows.push({
            shiftId: docSnap.id,
            employeeName: String(shift.employeeName || ''),
            action: dryRun ? 'would_revert' : 'reverted',
        });
        if (dryRun)
            continue;
        await docSnap.ref.update({
            status: 'PENDING',
            isAbsent: false,
            absenceType: firestore_1.FieldValue.delete(),
            absenceDetectedAt: firestore_1.FieldValue.delete(),
            absenceDetectedBy: firestore_1.FieldValue.delete(),
        });
        const ausSnap = await db.collection('ausencias').where('shiftId', '==', docSnap.id).limit(5).get();
        for (const a of ausSnap.docs) {
            await a.ref.update({ status: 'Anulada', anuladaAt: firestore_1.FieldValue.serverTimestamp(), anuladaBy: 'RELEASE_TRACE_ABSENCES' });
        }
        const convSnap = await db
            .collection('convocatorias_cobertura')
            .where('shiftId', '==', docSnap.id)
            .where('status', 'in', ['PENDING', 'ESCALATED'])
            .limit(20)
            .get();
        for (const c of convSnap.docs) {
            await c.ref.update({
                status: 'CANCELLED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                cancelledBy: 'RELEASE_TRACE_ABSENCES',
            });
        }
        const novSnap = await db
            .collection('novedades')
            .where('shiftId', '==', docSnap.id)
            .where('type', '==', 'AUSENCIA_AUTO')
            .limit(5)
            .get();
        for (const n of novSnap.docs) {
            await n.ref.update({ status: 'CANCELLED', resolved: true });
        }
        await (0, coverageRetention_1.releaseRetentionForAbsenceShift)(db, docSnap.id, 'RELEASE_TRACE_ABSENCES');
    }
    return { rows };
}
//# sourceMappingURL=releaseTraceAbsences.js.map