"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuardDeviceBindError = void 0;
exports.guardDeviceBindErrorToHttps = guardDeviceBindErrorToHttps;
exports.rethrowBindGuardDeviceError = rethrowBindGuardDeviceError;
exports.assertCanRequestGuardDeviceRegistration = assertCanRequestGuardDeviceRegistration;
exports.bindGuardDevice = bindGuardDevice;
exports.unbindGuardDeviceForUid = unbindGuardDeviceForUid;
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
class GuardDeviceBindError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.GuardDeviceBindError = GuardDeviceBindError;
function guardDeviceBindErrorToHttps(err) {
    return new functions.https.HttpsError('failed-precondition', err.message, { code: err.code });
}
function rethrowBindGuardDeviceError(err) {
    if (err instanceof GuardDeviceBindError) {
        throw guardDeviceBindErrorToHttps(err);
    }
    throw err;
}
const DEVICE_OWNED_MSG = 'Este dispositivo está vinculado a otro colaborador. Pedile a RRHH que lo desvincule.';
const RETIRED_MSG = 'Para volver a este dispositivo usá el mail de acceso.';
function normalizeRetiredIds(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((x) => String(x).trim()).filter((x) => x.length >= 8);
}
function assertDeviceId(deviceId) {
    const trimmed = String(deviceId ?? '').trim();
    if (trimmed.length < 8) {
        throw new GuardDeviceBindError('DEVICE_ID_REQUIRED', 'deviceId inválido.');
    }
    return trimmed;
}
async function assertCanRequestGuardDeviceRegistration(db, uid, deviceId) {
    const did = assertDeviceId(deviceId);
    await assertDeviceNotOwnedByOther(db, uid, did);
    await assertNotRetiredForApproval(db, uid, did);
}
async function assertDeviceNotOwnedByOther(db, uid, deviceId) {
    const bindSnap = await db.collection('device_bindings').doc(deviceId).get();
    if (!bindSnap.exists)
        return;
    const ownerUid = String(bindSnap.data()?.uid ?? '').trim();
    if (ownerUid && ownerUid !== uid) {
        throw new GuardDeviceBindError('DEVICE_OWNED_BY_OTHER', DEVICE_OWNED_MSG);
    }
}
async function assertNotRetiredForApproval(db, uid, deviceId) {
    const tokenSnap = await db.collection('device_tokens').doc(uid).get();
    const retired = normalizeRetiredIds(tokenSnap.data()?.retiredDeviceIds);
    if (retired.includes(deviceId)) {
        throw new GuardDeviceBindError('RETIRED_DEVICE_NEEDS_EMAIL', RETIRED_MSG);
    }
}
async function bindGuardDevice(db, params) {
    const deviceId = assertDeviceId(params.deviceId);
    const uid = String(params.uid).trim();
    const employeeId = String(params.employeeId).trim();
    if (!uid || !employeeId) {
        throw new GuardDeviceBindError('DEVICE_ID_REQUIRED', 'uid y employeeId requeridos.');
    }
    if (params.source === 'approval') {
        await assertNotRetiredForApproval(db, uid, deviceId);
    }
    const tokenRef = db.collection('device_tokens').doc(uid);
    const bindingRef = db.collection('device_bindings').doc(deviceId);
    await db.runTransaction(async (tx) => {
        const bindSnap = await tx.get(bindingRef);
        if (bindSnap.exists) {
            const ownerUid = String(bindSnap.data()?.uid ?? '').trim();
            if (ownerUid && ownerUid !== uid) {
                throw new GuardDeviceBindError('DEVICE_OWNED_BY_OTHER', DEVICE_OWNED_MSG);
            }
        }
        const userSnap = await tx.get(tokenRef);
        const userData = userSnap.data() || {};
        let retired = normalizeRetiredIds(userData.retiredDeviceIds);
        if (params.source === 'approval' && retired.includes(deviceId)) {
            throw new GuardDeviceBindError('RETIRED_DEVICE_NEEDS_EMAIL', RETIRED_MSG);
        }
        retired = retired.filter((id) => id !== deviceId);
        const currentDeviceId = String(userData.deviceId ?? '').trim();
        if (currentDeviceId && currentDeviceId !== deviceId) {
            const prevBindRef = db.collection('device_bindings').doc(currentDeviceId);
            const prevBindSnap = await tx.get(prevBindRef);
            if (prevBindSnap.exists && String(prevBindSnap.data()?.uid ?? '').trim() === uid) {
                tx.delete(prevBindRef);
            }
            if (!retired.includes(currentDeviceId)) {
                retired = [...retired, currentDeviceId];
            }
        }
        const tokenSource = params.source === 'email_link'
            ? 'email_link'
            : 'supervisor_approval';
        tx.set(bindingRef, {
            uid,
            employeeId,
            empresaId: params.empresaId ?? null,
            boundAt: firestore_1.FieldValue.serverTimestamp(),
            source: params.source,
        }, { merge: true });
        tx.set(tokenRef, {
            uid,
            employeeId,
            verified: true,
            deviceId,
            retiredDeviceIds: retired,
            source: tokenSource,
            deviceInfo: params.deviceInfo || {},
            platform: params.platform || 'web',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(params.tokenExtras || {}),
        }, { merge: true });
    });
}
async function unbindGuardDeviceForUid(db, targetUid, unboundBy) {
    const uid = String(targetUid).trim();
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'targetUid requerido.');
    }
    let released = null;
    await db.runTransaction(async (tx) => {
        const tokenRef = db.collection('device_tokens').doc(uid);
        const tokenSnap = await tx.get(tokenRef);
        const deviceId = String(tokenSnap.data()?.deviceId ?? '').trim();
        released = deviceId || null;
        if (deviceId) {
            const bindRef = db.collection('device_bindings').doc(deviceId);
            const bindSnap = await tx.get(bindRef);
            if (bindSnap.exists && String(bindSnap.data()?.uid ?? '').trim() === uid) {
                tx.delete(bindRef);
            }
        }
        tx.set(tokenRef, {
            deviceId: firestore_1.FieldValue.delete(),
            verified: false,
            unboundAt: firestore_1.FieldValue.serverTimestamp(),
            unboundBy: unboundBy || 'admin',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    return { hadDeviceId: released };
}
//# sourceMappingURL=bindGuardDevice.js.map