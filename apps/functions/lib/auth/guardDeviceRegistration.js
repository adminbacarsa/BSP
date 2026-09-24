"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGuardDeviceRegistrationStatus = exports.listPendingGuardDeviceRegistrations = exports.rejectGuardDeviceRegistration = exports.approveGuardDeviceRegistration = exports.requestGuardDeviceRegistration = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
async function resolveEmployeeIdForUid(db, uid, email) {
    const byUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    if (!byUid.empty) {
        const d = byUid.docs[0];
        return {
            employeeId: d.id,
            empresaId: d.data()?.empresaId || null,
        };
    }
    const mail = String(email || '').trim();
    if (!mail)
        return null;
    const byEmail = await db.collection('empleados').where('email', '==', mail).limit(2).get();
    if (byEmail.size !== 1)
        return null;
    const d = byEmail.docs[0];
    const existingUid = String(d.data()?.uid || '').trim();
    if (existingUid && existingUid !== uid)
        return null;
    if (!existingUid)
        await d.ref.update({ uid, uidLinkedAt: firestore_1.FieldValue.serverTimestamp(), uidLinkedBy: 'DEVICE_REGISTRATION' });
    return {
        employeeId: d.id,
        empresaId: d.data()?.empresaId || null,
    };
}
async function notifySupervisorsDeviceRequest(db, params) {
    const empSnap = await db.collection('empleados').doc(params.employeeId).get();
    const objectiveIds = [];
    const pref = empSnap.data()?.preferredObjectiveId;
    if (typeof pref === 'string' && pref.trim())
        objectiveIds.push(pref.trim());
    let notified = 0;
    const seen = new Set();
    for (const oid of objectiveIds) {
        const supSnap = await db
            .collection('system_users')
            .where('objetivosAsignados', 'array-contains', oid)
            .limit(15)
            .get();
        for (const d of supSnap.docs) {
            const supUid = d.id;
            if (seen.has(supUid))
                continue;
            seen.add(supUid);
            await db.collection('user_notifications').add({
                uid: supUid,
                employeeId: params.employeeId,
                title: 'Nuevo dispositivo — guardia',
                body: `${params.employeeName} solicita vincular un dispositivo (${params.platform}). Revisá RRHH / portal.`,
                type: 'DEVICE_REGISTRATION_REQUEST',
                target: 'supervisor',
                empresaId: params.empresaId,
                read: false,
                readAt: null,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            notified += 1;
        }
    }
    return notified;
}
exports.requestGuardDeviceRegistration = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
    }
    const uid = context.auth.uid;
    const { deviceId, deviceInfo, platform } = data;
    const trimmedDeviceId = String(deviceId ?? '').trim();
    if (trimmedDeviceId.length < 8) {
        throw new functions.https.HttpsError('invalid-argument', 'deviceId inválido.');
    }
    const db = admin.firestore();
    const legajo = await resolveEmployeeIdForUid(db, uid, context.auth.token.email);
    if (!legajo) {
        throw new functions.https.HttpsError('failed-precondition', 'No hay legajo vinculado a tu usuario.');
    }
    const empSnap = await db.collection('empleados').doc(legajo.employeeId).get();
    if (empSnap.data()?.bypassDeviceCheck === true) {
        await db.collection('device_tokens').doc(uid).set({
            uid,
            employeeId: legajo.employeeId,
            verified: true,
            deviceId: trimmedDeviceId,
            deviceInfo: deviceInfo || {},
            platform: platform || 'web',
            source: 'bypass_device_check',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { status: 'approved', bypass: true };
    }
    const bindingRef = db.collection('device_tokens').doc(uid);
    const binding = await bindingRef.get();
    if (!binding.exists || binding.data()?.verified !== true) {
        throw new functions.https.HttpsError('failed-precondition', 'Activá tu cuenta con el mail de acceso antes de registrar un dispositivo nuevo.');
    }
    const currentDeviceId = String(binding.data()?.deviceId ?? '').trim();
    if (currentDeviceId && currentDeviceId === trimmedDeviceId) {
        return { status: 'already_bound' };
    }
    const resolvedPlatform = platform === 'ios' || platform === 'android' || platform === 'web' ? platform : 'web';
    const reqRef = db.collection('device_registration_requests').doc(uid);
    await reqRef.set({
        uid,
        employeeId: legajo.employeeId,
        empresaId: legajo.empresaId,
        status: 'PENDING',
        requestedDeviceId: trimmedDeviceId,
        previousDeviceId: currentDeviceId || null,
        deviceInfo: deviceInfo || {},
        platform: resolvedPlatform,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const name = [empSnap.data()?.firstName, empSnap.data()?.lastName].filter(Boolean).join(' ') ||
        String(empSnap.data()?.nombre || 'Guardia');
    const supervisorsNotified = await notifySupervisorsDeviceRequest(db, {
        employeeId: legajo.employeeId,
        empresaId: legajo.empresaId,
        employeeName: name,
        platform: resolvedPlatform,
    });
    return { status: 'pending', supervisorsNotified };
});
exports.approveGuardDeviceRegistration = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
    }
    const callerUid = context.auth.uid;
    const db = admin.firestore();
    await assertAdminCaller(db, context);
    const { targetUid: targetUidArg, employeeId: employeeIdArg } = data;
    let targetUid = String(targetUidArg ?? '').trim();
    let employeeId = String(employeeIdArg ?? '').trim();
    if (!targetUid && employeeId) {
        const emp = await db.collection('empleados').doc(employeeId).get();
        targetUid = String(emp.data()?.uid ?? '').trim();
    }
    if (!targetUid) {
        throw new functions.https.HttpsError('invalid-argument', 'targetUid o employeeId requerido.');
    }
    const reqRef = db.collection('device_registration_requests').doc(targetUid);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists || reqSnap.data()?.status !== 'PENDING') {
        throw new functions.https.HttpsError('not-found', 'No hay solicitud pendiente para este usuario.');
    }
    const req = reqSnap.data();
    employeeId = employeeId || String(req.employeeId || '').trim();
    const requestedDeviceId = String(req.requestedDeviceId || '').trim();
    if (!requestedDeviceId) {
        throw new functions.https.HttpsError('failed-precondition', 'Solicitud sin deviceId.');
    }
    await db.collection('device_tokens').doc(targetUid).set({
        uid: targetUid,
        employeeId: employeeId || null,
        verified: true,
        deviceId: requestedDeviceId,
        deviceInfo: req.deviceInfo || {},
        platform: req.platform || 'web',
        source: 'supervisor_approval',
        approvedBy: callerUid,
        approvedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await reqRef.update({
        status: 'APPROVED',
        approvedBy: callerUid,
        approvedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const employeeIdResolved = employeeId || String(req.employeeId || '').trim();
    await notifyGuardDeviceDecision(db, {
        targetUid,
        employeeId: employeeIdResolved,
        title: 'Dispositivo aprobado',
        body: 'RRHH aprobó tu nuevo dispositivo. Abrí la app y tocá «Reintentar verificación».',
        type: 'DEVICE_REGISTRATION_APPROVED',
    });
    return { success: true, targetUid, employeeId: employeeIdResolved, deviceId: requestedDeviceId };
});
exports.rejectGuardDeviceRegistration = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
    }
    const callerUid = context.auth.uid;
    const db = admin.firestore();
    await assertAdminCaller(db, context);
    const { targetUid: targetUidArg, employeeId: employeeIdArg, motivo } = data;
    let targetUid = String(targetUidArg ?? '').trim();
    let employeeId = String(employeeIdArg ?? '').trim();
    const rejectMotivo = String(motivo ?? '').trim();
    if (!targetUid && employeeId) {
        const emp = await db.collection('empleados').doc(employeeId).get();
        targetUid = String(emp.data()?.uid ?? '').trim();
    }
    if (!targetUid) {
        throw new functions.https.HttpsError('invalid-argument', 'targetUid o employeeId requerido.');
    }
    if (rejectMotivo.length < 3) {
        throw new functions.https.HttpsError('invalid-argument', 'Indicá un motivo de rechazo (mín. 3 caracteres).');
    }
    const reqRef = db.collection('device_registration_requests').doc(targetUid);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists || reqSnap.data()?.status !== 'PENDING') {
        throw new functions.https.HttpsError('not-found', 'No hay solicitud pendiente para este usuario.');
    }
    const req = reqSnap.data();
    employeeId = employeeId || String(req.employeeId || '').trim();
    await reqRef.update({
        status: 'REJECTED',
        rejectMotivo,
        rejectedBy: callerUid,
        rejectedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const body = `RRHH rechazó el registro de dispositivo: ${rejectMotivo}`;
    await notifyGuardDeviceDecision(db, {
        targetUid,
        employeeId,
        title: 'Dispositivo no aprobado',
        body,
        type: 'DEVICE_REGISTRATION_REJECTED',
    });
    return { success: true, targetUid, employeeId, status: 'REJECTED' };
});
async function notifyGuardDeviceDecision(db, params) {
    const { targetUid, employeeId, title, body, type } = params;
    if (!targetUid && !employeeId)
        return;
    let empresaId = null;
    if (employeeId) {
        const emp = await db.collection('empleados').doc(employeeId).get();
        empresaId = emp.data()?.empresaId || null;
    }
    await db.collection('user_notifications').add({
        uid: targetUid || null,
        employeeId: employeeId || null,
        title,
        body,
        type,
        target: 'employee',
        empresaId,
        read: false,
        readAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function assertAdminCaller(db, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
    }
    const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
    const callerRole = String(callerSnap.data()?.role ?? context.auth.token?.role ?? '').toLowerCase();
    const isSuperAdmin = callerRole === 'superadmin';
    const isAdmin = isSuperAdmin ||
        ['admin', 'manager', 'hrmanager', 'supervisor', 'operator'].includes(callerRole.replace(/_/g, ''));
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Solo personal autorizado.');
    }
}
exports.listPendingGuardDeviceRegistrations = functions.https.onCall(async (data, context) => {
    const db = admin.firestore();
    await assertAdminCaller(db, context);
    const { empresaId, limit: limitArg } = data;
    const max = Math.min(Math.max(Number(limitArg) || 40, 1), 100);
    const snap = await db.collection('device_registration_requests').where('status', '==', 'PENDING').limit(max).get();
    const rows = [];
    for (const d of snap.docs) {
        const row = d.data();
        const eid = String(row.empresaId ?? '').trim();
        if (empresaId && eid && eid !== empresaId)
            continue;
        const empId = String(row.employeeId ?? '').trim();
        let employeeName = '';
        let fileNumber = '';
        if (empId) {
            const emp = await db.collection('empleados').doc(empId).get();
            if (emp.exists) {
                const ed = emp.data();
                employeeName = [ed.lastName, ed.firstName].filter(Boolean).join(', ') || String(ed.nombre ?? '');
                fileNumber = String(ed.fileNumber ?? ed.legajo ?? '');
            }
        }
        rows.push({
            uid: d.id,
            employeeId: empId || null,
            employeeName,
            fileNumber,
            empresaId: eid || null,
            platform: row.platform ?? null,
            requestedDeviceId: row.requestedDeviceId ?? null,
            previousDeviceId: row.previousDeviceId ?? null,
            deviceInfo: row.deviceInfo ?? {},
            createdAt: row.createdAt ?? null,
        });
    }
    rows.sort((a, b) => {
        const as = a.createdAt?.seconds ?? 0;
        const bs = b.createdAt?.seconds ?? 0;
        return bs - as;
    });
    return { requests: rows };
});
exports.getGuardDeviceRegistrationStatus = functions.https.onCall(async (_data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
    }
    const uid = context.auth.uid;
    const db = admin.firestore();
    const reqSnap = await db.collection('device_registration_requests').doc(uid).get();
    if (!reqSnap.exists) {
        const bind = await db.collection('device_tokens').doc(uid).get();
        return {
            status: bind.exists && bind.data()?.verified ? 'bound' : 'none',
            deviceId: bind.data()?.deviceId ?? null,
        };
    }
    const d = reqSnap.data();
    const rawStatus = String(d.status || '').toUpperCase();
    if (rawStatus === 'PENDING') {
        return {
            status: 'pending',
            requestedDeviceId: d.requestedDeviceId ?? null,
            platform: d.platform ?? null,
        };
    }
    if (rawStatus === 'REJECTED') {
        const rejectMotivo = String(d.rejectMotivo ?? d.motivo ?? '').trim();
        return {
            status: 'rejected',
            requestedDeviceId: d.requestedDeviceId ?? null,
            platform: d.platform ?? null,
            message: rejectMotivo
                ? `Rechazado: ${rejectMotivo}`
                : 'Tu solicitud de dispositivo fue rechazada. Podés pedir registro de nuevo o contactar a RRHH.',
            rejectMotivo: rejectMotivo || null,
        };
    }
    if (rawStatus === 'APPROVED') {
        return {
            status: 'approved',
            requestedDeviceId: d.requestedDeviceId ?? null,
            platform: d.platform ?? null,
            message: 'Tu solicitud fue aprobada. Tocá «Reintentar verificación» para continuar.',
        };
    }
    return {
        status: String(d.status || 'unknown').toLowerCase(),
        requestedDeviceId: d.requestedDeviceId ?? null,
        platform: d.platform ?? null,
    };
});
//# sourceMappingURL=guardDeviceRegistration.js.map