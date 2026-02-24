"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAlertCreated = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
exports.onAlertCreated = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('alerts/{alertId}')
    .onCreate(async (snap, context) => {
    ensureAdmin();
    const alertId = context.params.alertId;
    const data = snap.data();
    const objectiveId = typeof data?.objective_id === 'string' ? data.objective_id : null;
    const db = admin.firestore();
    let tokens = [];
    if (objectiveId) {
        const assignments = await db
            .collection('active_assignments')
            .where('objective_id', '==', objectiveId)
            .where('is_on_duty', '==', true)
            .get();
        const guardIds = assignments.docs.map((d) => d.data()?.guard_id).filter(Boolean);
        if (guardIds.length > 0) {
            const tokensSnap = await db.collection('guard_tokens').get();
            for (const doc of tokensSnap.docs) {
                const uid = doc.id;
                const token = doc.data()?.fcm_token;
                if (token && guardIds.includes(uid))
                    tokens.push(token);
            }
        }
    }
    if (tokens.length === 0) {
        const tokensSnap = await db.collection('guard_tokens').get();
        tokens = tokensSnap.docs
            .map((d) => d.data()?.fcm_token)
            .filter((t) => typeof t === 'string' && t.length > 0);
    }
    if (tokens.length === 0) {
        await snap.ref.update({
            notification: { sent: false, reason: 'no_tokens', token_count: 0 },
        });
        return;
    }
    const message = {
        notification: {
            title: 'Alerta IVS',
            body: data?.camera_name ? `Alerta en ${data.camera_name}` : 'Nueva alerta de cámara',
        },
        data: {
            alertId,
            type: 'nvr_alert',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
            priority: 'high',
            notification: { channelId: 'critical_alerts', sound: 'alarm' },
        },
        apns: {
            payload: { aps: { sound: 'alarm', contentAvailable: true } },
            fcmOptions: {},
        },
        tokens,
    };
    try {
        const result = await admin.messaging().sendEachForMulticast(message);
        await snap.ref.update({
            notification: {
                sent: result.successCount > 0,
                success_count: result.successCount,
                failure_count: result.failureCount,
                token_count: tokens.length,
            },
        });
    }
    catch (e) {
        console.error('[onAlertCreated] FCM error', e?.message);
        await snap.ref.update({
            notification: { sent: false, reason: e?.message || 'send_error', token_count: tokens.length },
        });
    }
});
//# sourceMappingURL=onAlertCreated.js.map