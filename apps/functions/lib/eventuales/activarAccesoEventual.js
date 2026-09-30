"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esActivacionEventual = esActivacionEventual;
exports.activarAccesoEventual = activarAccesoEventual;
exports.activateAndSetPasswordHandler = activateAndSetPasswordHandler;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
const bindGuardDevice_1 = require("../auth/bindGuardDevice");
function esActivacionEventual(td) {
    if (String(td.tipo || '') === 'EVENTUAL')
        return true;
    return !String(td.employeeId || '').trim() && !!String(td.bolsaCuil || '').trim();
}
async function activarAccesoEventual(db, input) {
    const cuil = String(input.td.bolsaCuil || '').trim();
    const uid = String(input.td.uid || '').trim();
    if (!cuil || !uid) {
        throw new functions.https.HttpsError('failed-precondition', 'El enlace de eventual no tiene CUIL.');
    }
    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;
    if (!email)
        throw new functions.https.HttpsError('internal', 'El usuario no tiene email configurado.');
    const bolsaRef = db.collection('eventuales_bolsa').doc(cuil);
    if (!(await bolsaRef.get()).exists) {
        throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
    }
    const legajos = await db.collection('empleados').where('bolsaCuil', '==', cuil).get();
    const primer = legajos.docs[0];
    const employeeId = primer?.id || cuil;
    const resolvedPlatform = input.platform === 'ios' || input.platform === 'android' || input.platform === 'web'
        ? input.platform
        : input.deviceInfo?.platform === 'ios' || input.deviceInfo?.platform === 'android'
            ? input.deviceInfo.platform
            : 'web';
    try {
        await (0, bindGuardDevice_1.bindGuardDevice)(db, {
            uid,
            employeeId,
            empresaId: primer?.data()?.empresaId || null,
            deviceId: input.deviceId,
            source: 'email_link',
            deviceInfo: input.deviceInfo || {},
            platform: resolvedPlatform,
            tokenExtras: {
                activatedAt: firestore_1.FieldValue.serverTimestamp(),
                tipo: 'EVENTUAL',
                bolsaCuil: cuil,
            },
        });
    }
    catch (err) {
        (0, bindGuardDevice_1.rethrowBindGuardDeviceError)(err);
    }
    await admin.auth().updateUser(uid, { password: input.password });
    await admin.auth().setCustomUserClaims(uid, {
        role: 'EVENTUAL',
        type: 'eventual',
        bolsaCuil: cuil,
    });
    await bolsaRef.set({ uid }, { merge: true });
    if (!legajos.empty) {
        const batch = db.batch();
        legajos.docs.forEach((d) => batch.set(d.ref, { uid }, { merge: true }));
        await batch.commit();
    }
    await input.tokenRef.update({ used: true, usedAt: firestore_1.FieldValue.serverTimestamp() });
    return { email, employeeId, bolsaCuil: cuil };
}
async function activateAndSetPasswordHandler(data) {
    const { token, password, deviceId, deviceInfo, platform } = data;
    if (!token)
        throw new functions.https.HttpsError('invalid-argument', 'Token requerido.');
    if (!password || password.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
    }
    const trimmedDeviceId = String(deviceId ?? '').trim();
    if (trimmedDeviceId.length < 8) {
        throw new functions.https.HttpsError('invalid-argument', 'deviceId inválido.');
    }
    const db = admin.firestore();
    const tokenRef = db.collection('device_activations').doc(token);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Enlace inválido o ya utilizado.');
    }
    const td = tokenDoc.data();
    if (td.used) {
        throw new functions.https.HttpsError('already-exists', 'Este enlace ya fue utilizado. Tu dispositivo puede estar activo.');
    }
    if (td.expiresAt.toDate() < new Date()) {
        throw new functions.https.HttpsError('deadline-exceeded', 'El enlace expiró. Pedile al administrador que te reenvíe el mail de acceso.');
    }
    if (esActivacionEventual(td)) {
        return activarAccesoEventual(db, {
            td,
            tokenRef,
            password,
            deviceId: trimmedDeviceId,
            deviceInfo: deviceInfo || {},
            platform,
        });
    }
    const { uid, employeeId } = td;
    if (!uid || !employeeId) {
        throw new functions.https.HttpsError('failed-precondition', 'El enlace no tiene legajo.');
    }
    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;
    if (!email)
        throw new functions.https.HttpsError('internal', 'El usuario no tiene email configurado.');
    const resolvedPlatform = platform === 'ios' || platform === 'android' || platform === 'web'
        ? platform
        : deviceInfo?.platform === 'ios' || deviceInfo?.platform === 'android'
            ? deviceInfo.platform
            : 'web';
    const empSnapForBind = await db.collection('empleados').doc(employeeId).get();
    const empresaIdForBind = empSnapForBind.data()?.empresaId || null;
    try {
        await (0, bindGuardDevice_1.bindGuardDevice)(db, {
            uid,
            employeeId,
            empresaId: empresaIdForBind,
            deviceId: trimmedDeviceId,
            source: 'email_link',
            deviceInfo: deviceInfo || {},
            platform: resolvedPlatform,
            tokenExtras: {
                activatedAt: firestore_1.FieldValue.serverTimestamp(),
            },
        });
    }
    catch (err) {
        (0, bindGuardDevice_1.rethrowBindGuardDeviceError)(err);
    }
    await admin.auth().updateUser(uid, { password });
    try {
        const empEmpresaId = (empSnapForBind.data()?.empresaId || '').toString();
        await admin.auth().setCustomUserClaims(uid, {
            role: 'employee',
            type: 'employee',
            ...(empEmpresaId ? { empresaId: empEmpresaId } : {}),
        });
    }
    catch (e) {
        console.warn('[activateAndSetPassword] no se pudo setear claim empresaId', e);
    }
    await tokenRef.update({ used: true, usedAt: firestore_1.FieldValue.serverTimestamp() });
    return { email, employeeId };
}
//# sourceMappingURL=activarAccesoEventual.js.map