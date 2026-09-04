"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEmployeeNotificationCreated = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const INBOX_NEEDS_FCM = new Set([
    'CONVOCATORIA_EVENTO',
    'EVENTO_CONFIRMADO',
    'SWAP_REQUEST',
    'TURNO_FINALIZADO',
    'SOLICITUD_ESTADO_LLEGADA',
    'SOLICITUD_ESTADO_RELEVO',
    'RELEVO',
    'VACANTE_PLANIFICACION',
    'VACANTE_OPERACIONES',
]);
async function collectTokens(db, uid, employeeId) {
    const tokenSet = new Set();
    const queries = [];
    if (employeeId) {
        queries.push(db.collection('device_tokens').where('employeeId', '==', employeeId).get());
    }
    if (uid) {
        queries.push(db.collection('device_tokens').where('uid', '==', uid).get());
    }
    if (queries.length === 0)
        return [];
    const snaps = await Promise.all(queries);
    for (const snap of snaps) {
        for (const d of snap.docs) {
            const t = d.data()?.token;
            if (typeof t === 'string' && t.length > 10)
                tokenSet.add(t);
        }
    }
    return [...tokenSet];
}
exports.onEmployeeNotificationCreated = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .firestore.document('user_notifications/{notifId}')
    .onCreate(async (snap) => {
    const data = snap.data() || {};
    const type = String(data.type || '')
        .trim()
        .toUpperCase();
    if (!INBOX_NEEDS_FCM.has(type))
        return;
    if (data.fcmSent === true || data.skipFcm === true)
        return;
    const title = String(data.title || 'COSP Guardia').trim() || 'COSP Guardia';
    const body = String(data.body || '').trim() || 'Tenés una nueva alerta.';
    const uid = typeof data.uid === 'string' && data.uid ? data.uid : null;
    const employeeId = typeof data.employeeId === 'string' && data.employeeId ? data.employeeId : null;
    const db = admin.firestore();
    let tokens = await collectTokens(db, uid, employeeId);
    if (tokens.length === 0 && employeeId) {
        const empSnap = await db.collection('empleados').doc(employeeId).get();
        const empUid = empSnap.exists ? empSnap.data()?.uid : undefined;
        if (empUid) {
            tokens = await collectTokens(db, empUid, employeeId);
        }
    }
    if (tokens.length === 0) {
        console.warn(`[onEmployeeNotificationCreated] Sin tokens FCM type=${type} emp=${employeeId} uid=${uid}`);
        await snap.ref.set({ fcmSent: false, fcmSkipReason: 'no_tokens', fcmCheckedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return;
    }
    const link = type === 'CONVOCATORIA_EVENTO' || type === 'EVENTO_CONFIRMADO'
        ? '/eventos'
        : type === 'SWAP_REQUEST'
            ? '/permutas'
            : type === 'VACANTE_PLANIFICACION'
                ? '/admin/planificacion'
                : type === 'VACANTE_OPERACIONES'
                    ? '/admin/operaciones'
                    : '/empleado/dashboard';
    try {
        const result = await admin.messaging().sendEachForMulticast({
            notification: { title, body },
            data: {
                type,
                title,
                body,
                link,
                notificationId: snap.id,
                eventoId: data.eventoId ? String(data.eventoId) : '',
                solicitudId: data.solicitudId ? String(data.solicitudId) : '',
                servicioId: data.servicioId ? String(data.servicioId) : '',
            },
            android: {
                priority: 'high',
                notification: { channelId: 'default' },
            },
            webpush: {
                notification: { title, body, icon: '/icons/icon-192x192.png', requireInteraction: true },
                fcmOptions: { link },
            },
            tokens,
        });
        console.log(`[onEmployeeNotificationCreated] ${type} success=${result.successCount} fail=${result.failureCount}`);
        const invalid = [];
        result.responses.forEach((r, i) => {
            if (!r.success &&
                (r.error?.code === 'messaging/registration-token-not-registered' ||
                    r.error?.code === 'messaging/invalid-registration-token')) {
                invalid.push(tokens[i]);
            }
        });
        if (invalid.length > 0) {
            const cleanSnap = await db.collection('device_tokens').where('token', 'in', invalid.slice(0, 10)).get();
            const batch = db.batch();
            cleanSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
        await snap.ref.set({
            fcmSent: result.successCount > 0,
            fcmSuccessCount: result.successCount,
            fcmFailureCount: result.failureCount,
            fcmSentAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (e) {
        console.warn('[onEmployeeNotificationCreated] FCM error:', e?.message);
        await snap.ref.set({
            fcmSent: false,
            fcmSkipReason: e?.message || 'fcm_error',
            fcmCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
});
//# sourceMappingURL=onEmployeeNotificationCreated.js.map