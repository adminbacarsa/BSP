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
    const empresaId = data?.empresaId;
    let operatorId = null;
    if (empresaId) {
        const sessionSnap = await db.collection('sesiones_operador')
            .where('empresaId', '==', empresaId)
            .where('status', '==', 'ACTIVO')
            .limit(1)
            .get();
        if (!sessionSnap.empty) {
            operatorId = sessionSnap.docs[0].data()?.operatorId || null;
        }
    }
    let tokensQuery;
    if (operatorId) {
        tokensQuery = db.collection('device_tokens').where('uid', '==', operatorId);
    }
    else {
        tokensQuery = db.collection('device_tokens');
    }
    const tokensSnap = await tokensQuery.get();
    const tokens = tokensSnap.docs
        .map(d => d.data()?.token)
        .filter((t) => typeof t === 'string' && t.length > 10);
    if (!tokens.length)
        return;
    const title = TYPE_LABELS[data.type] || 'Alerta Operativa';
    const body = data.description || data.title || 'Nueva novedad';
    const message = {
        notification: { title, body },
        data: {
            novedadId: snap.id,
            type: data.type,
            objectiveName: data.objectiveName || '',
            click_action: 'OPERACIONES_ALERT',
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
    }
    catch (e) {
        console.error('[onNovedadCreated] FCM error:', e?.message);
    }
});
//# sourceMappingURL=onNovedadCreated.js.map