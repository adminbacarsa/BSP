"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarPresencia = void 0;
exports.processPortalCheckIn = processPortalCheckIn;
const firestore_1 = require("firebase-admin/firestore");
const sanitizeId_1 = require("./sanitizeId");
const registrarPresencia_1 = require("./registrarPresencia");
Object.defineProperty(exports, "registrarPresencia", { enumerable: true, get: function () { return registrarPresencia_1.registrarPresencia; } });
async function processPortalCheckIn(db, input) {
    const { shiftId, empId, coords, recordedAt, idempotencyKey, source = 'PORTAL_GPS' } = input;
    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists) {
        throw new Error('TURNO_NOT_FOUND');
    }
    const shiftData = shiftDoc.data();
    if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
        throw new Error('SHIFT_ABSENT');
    }
    if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
        return { success: true, fichajeId: '', alreadyApplied: true };
    }
    const key = idempotencyKey?.trim() || `ci_${shiftId}_${recordedAt || Date.now()}`;
    const fichajeRef = db.collection('fichajes').doc((0, sanitizeId_1.fichajeDocIdFromKey)(key));
    const now = firestore_1.FieldValue.serverTimestamp();
    const existing = await fichajeRef.get();
    if (existing.exists) {
        const st = existing.data()?.status;
        if (st === 'APPLIED') {
            return { success: true, fichajeId: fichajeRef.id, alreadyApplied: true };
        }
        if (st === 'REJECTED') {
            throw new Error('FICHAJE_REJECTED');
        }
    }
    await fichajeRef.set({
        tipo: 'CHECK_IN',
        status: 'PENDING',
        shiftId,
        employeeId: empId,
        empresaId: shiftData.empresaId || null,
        coords: coords || null,
        recordedAt: recordedAt || null,
        idempotencyKey: key,
        source,
        createdAt: now,
        updatedAt: now,
    }, { merge: true });
    try {
        const result = await (0, registrarPresencia_1.registrarPresencia)(db, {
            shiftId,
            empId,
            coords: coords || null,
            recordedAt: recordedAt || null,
            source: source === 'OPERATIONS' ? 'OPERATIONS' : 'PORTAL_GPS',
        });
        await fichajeRef.update({
            status: 'APPLIED',
            appliedAt: now,
            updatedAt: now,
            relievedShiftId: result.relieved?.shiftId || null,
        });
        return { success: true, fichajeId: fichajeRef.id, alreadyApplied: result.alreadyPresent === true };
    }
    catch (e) {
        await fichajeRef
            .update({
            status: 'REJECTED',
            errorMessage: e?.message || 'unknown',
            updatedAt: now,
        })
            .catch(() => { });
        throw e;
    }
}
//# sourceMappingURL=applyPortalCheckIn.js.map