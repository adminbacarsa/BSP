"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onNovedadCreated = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const ALERT_TYPES = [
    'INGRESO_AUTOREGISTRO',
    'AUSENCIA_DETECTADA',
    'RETENCION_DETECTADA',
    'VACANTE_AUTO_REPORTADA',
    'VACANTE_NO_CUBIERTA',
    'AUSENCIA_CORTO_PLAZO',
    'AVISO_AUSENCIA_ANTICIPADA',
];
const TYPE_LABELS = {
    INGRESO_AUTOREGISTRO: '⚡ Ingreso por Portal',
    AUSENCIA_DETECTADA: '⚠️ Ausencia Detectada',
    RETENCION_DETECTADA: '⏰ Guardia en Recargo',
    VACANTE_AUTO_REPORTADA: '🔴 Vacante Reportada',
    VACANTE_NO_CUBIERTA: '🔴 Vacante Devuelta',
    AUSENCIA_CORTO_PLAZO: '🚨 Ausencia Urgente — menos de 4hs',
    AVISO_AUSENCIA_ANTICIPADA: '⚠️ Aviso Anticipado de Ausencia',
};
exports.onNovedadCreated = functions
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .firestore.document('novedades/{novedadId}')
    .onCreate(async (snap) => {
    const data = snap.data();
    if (!ALERT_TYPES.includes(data?.type))
        return;
    const db = admin.firestore();
    const empresaId = data?.empresaId || null;
    let tokenDocs = [];
    if (empresaId) {
        const sessionSnap = await db.collection('sesiones_operador')
            .where('empresaId', '==', empresaId)
            .where('status', '==', 'ACTIVO')
            .limit(1)
            .get();
        if (!sessionSnap.empty) {
            const operatorId = sessionSnap.docs[0].data()?.operatorId;
            const opTokensSnap = await db.collection('device_tokens')
                .where('uid', '==', operatorId)
                .get();
            tokenDocs = opTokensSnap.docs.filter(d => d.data().role === 'admin');
        }
        if (tokenDocs.length === 0) {
            const allSnap = await db.collection('device_tokens')
                .where('empresaId', '==', empresaId)
                .get();
            tokenDocs = allSnap.docs.filter(d => d.data().role === 'admin');
        }
    }
    const tokens = tokenDocs
        .map(d => d.data()?.token)
        .filter((t) => typeof t === 'string' && t.length > 10);
    const title = TYPE_LABELS[data.type] || 'Alerta Operativa';
    const body = data.description || data.title || 'Nueva novedad';
    const now = admin.firestore.FieldValue.serverTimestamp();
    const adminUids = [...new Set(tokenDocs.map(d => d.data().uid).filter(Boolean))];
    await Promise.all(adminUids.map(uid => db.collection('user_notifications').add({
        uid,
        title,
        body,
        type: data.type,
        novedadId: snap.id,
        empresaId: empresaId || null,
        read: false,
        readAt: null,
        createdAt: now,
    })));
    if (!tokens.length) {
        console.warn('[onNovedadCreated] No admin tokens for empresa:', empresaId);
        return;
    }
    const message = {
        notification: { title, body },
        data: {
            novedadId: snap.id,
            type: data.type,
            objectiveName: data.objectiveName || '',
            click_action: 'OPERACIONES_ALERT',
            link: '/admin/operaciones',
        },
        webpush: {
            notification: {
                title,
                body,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                requireInteraction: true,
            },
            fcmOptions: { link: '/admin/operaciones' },
        },
        tokens,
    };
    try {
        const result = await admin.messaging().sendEachForMulticast(message);
        await snap.ref.update({
            fcmSent: result.successCount > 0,
            fcmSuccessCount: result.successCount,
            fcmFailureCount: result.failureCount,
        });
        const invalidTokens = [];
        result.responses.forEach((r, i) => {
            if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' ||
                r.error?.code === 'messaging/invalid-registration-token')) {
                invalidTokens.push(tokens[i]);
            }
        });
        if (invalidTokens.length > 0) {
            const cleanSnap = await db.collection('device_tokens')
                .where('token', 'in', invalidTokens).get();
            const batch = db.batch();
            cleanSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    }
    catch (e) {
        console.error('[onNovedadCreated] FCM error:', e?.message);
    }
});
//# sourceMappingURL=onNovedadCreated.js.map