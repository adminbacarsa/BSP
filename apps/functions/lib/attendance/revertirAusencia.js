"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revertirAusenciaShift = revertirAusenciaShift;
const firestore_1 = require("firebase-admin/firestore");
const coverageRetention_1 = require("../coverage/coverageRetention");
async function revertirAusenciaShift(db, input) {
    const shiftId = String(input.shiftId || '').trim();
    if (!shiftId)
        return { success: false, reason: 'INVALID_SHIFT' };
    const ref = db.collection('turnos').doc(shiftId);
    const snap = await ref.get();
    if (!snap.exists)
        return { success: false, reason: 'NOT_FOUND' };
    const shift = snap.data();
    const startMs = shift.startTime?.toMillis?.() ?? 0;
    const nowMs = Date.now();
    if (startMs && nowMs > startMs + 60 * 60 * 1000) {
        return { success: false, reason: 'PAST_T60' };
    }
    const activeCovSnap = await db
        .collection('turnos')
        .where('absenceShiftId', '==', shiftId)
        .where('origin', '==', 'OPERATIONS_COVERAGE')
        .limit(5)
        .get();
    const activeCov = activeCovSnap.docs.filter((d) => d.data().coverageSuperseded !== true && String(d.data().status || '').toUpperCase() !== 'CANCELLED');
    if (activeCov.length > 0 && input.cancelCoverage !== true) {
        return { success: false, reason: 'COVERAGE_IN_PROGRESS' };
    }
    const now = firestore_1.Timestamp.now();
    await ref.update({
        isAbsent: false,
        absenceType: firestore_1.FieldValue.delete(),
        absenceDetectedAt: firestore_1.FieldValue.delete(),
        absenceDetectedBy: firestore_1.FieldValue.delete(),
        status: 'PRESENT',
        isPresent: true,
        realStartTime: now,
        checkInTime: now,
        isLate: true,
        lateMinutes: startMs ? Math.max(0, Math.round((nowMs - startMs) / 60000)) : 0,
        absenceRevertedAt: now,
        absenceRevertedBy: input.operatorUid || 'OPERACIONES',
        presenciaSource: 'OPERATIONS',
    });
    const ausSnap = await db.collection('ausencias').where('shiftId', '==', shiftId).limit(5).get();
    for (const a of ausSnap.docs) {
        await a.ref.update({ status: 'Anulada', anuladaAt: firestore_1.FieldValue.serverTimestamp() });
    }
    const convSnap = await db
        .collection('convocatorias_cobertura')
        .where('shiftId', '==', shiftId)
        .limit(30)
        .get();
    for (const c of convSnap.docs) {
        const st = String(c.data().status || '');
        if (st === 'PENDING' || st === 'ESCALATED') {
            await c.ref.update({
                status: 'CANCELLED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                cancelledBy: input.operatorUid || 'REVERTIR_AUSENCIA',
            });
        }
    }
    await (0, coverageRetention_1.releaseRetentionForAbsenceShift)(db, shiftId, 'REVERTIR_AUSENCIA');
    if (input.cancelCoverage === true && activeCov.length) {
        for (const cov of activeCov) {
            await cov.ref.update({
                coverageSuperseded: true,
                status: 'CANCELLED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            });
            const srcId = String(cov.data().sourceShiftId || cov.data().coveredShiftId || '').trim();
            if (srcId) {
                await db.collection('turnos').doc(srcId).update({
                    coverageUsed: firestore_1.FieldValue.delete(),
                    operacionallyCovered: false,
                    coverageStatus: firestore_1.FieldValue.delete(),
                }).catch(() => undefined);
            }
        }
        await ref.update({
            operacionallyCovered: false,
            coverageStatus: firestore_1.FieldValue.delete(),
            coverageUsed: firestore_1.FieldValue.delete(),
        });
    }
    return { success: true };
}
//# sourceMappingURL=revertirAusencia.js.map