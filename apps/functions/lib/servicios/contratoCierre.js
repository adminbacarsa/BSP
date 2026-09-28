"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cerrarContratoSla = exports.reabrirContratoSla = exports.scheduledCerrarContratosVencidos = void 0;
exports.cerrarContratosVencidos = cerrarContratosVencidos;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const staffPermissions_1 = require("../ops/staffPermissions");
const TZ = 'America/Argentina/Buenos_Aires';
function todayAr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function ymd(v) {
    if (!v)
        return '';
    const t = v;
    if (typeof t.toDate === 'function')
        return t.toDate().toLocaleDateString('en-CA', { timeZone: TZ });
    return String(v).slice(0, 10);
}
function isCancelled(status) {
    const st = String(status ?? '').trim().toLowerCase();
    return st === 'inactive' || st === 'inactivo' || st === 'cancelled' || st === 'cancelado';
}
async function cerrarContratosVencidos(db, opts = {}) {
    const today = todayAr();
    const snap = await db.collection('servicios_sla').get();
    const toClose = snap.docs.filter((d) => {
        const x = d.data();
        if (x.closed === true || x.reopenedManually === true || isCancelled(x.status))
            return false;
        if (opts.empresaId && String(x.empresaId || '') !== opts.empresaId)
            return false;
        const end = ymd(x.endDate);
        return !!end && end < today;
    });
    if (!opts.dryRun) {
        for (let i = 0; i < toClose.length; i += 400) {
            const batch = db.batch();
            for (const d of toClose.slice(i, i + 400)) {
                batch.update(d.ref, {
                    closed: true,
                    closedAt: firestore_1.FieldValue.serverTimestamp(),
                    closedBy: 'SYSTEM_SCHEDULER',
                    closedReason: 'VENCIDO',
                });
            }
            await batch.commit();
        }
    }
    return { closed: toClose.length, ids: toClose.map((d) => d.id) };
}
exports.scheduledCerrarContratosVencidos = (0, scheduler_1.onSchedule)({ schedule: '20 0 * * *', timeZone: TZ, timeoutSeconds: 300, memory: '256MiB' }, async () => {
    const r = await cerrarContratosVencidos(admin.firestore());
    console.log(`[cerrarContratosVencidos] cerrados=${r.closed}`);
});
exports.reabrirContratoSla = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const db = admin.firestore();
    const panel = await (0, staffPermissions_1.resolvePanelUserForUid)(db, context.auth.uid, context.auth.token?.role);
    if (!panel?.isSuperAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Solo un SuperAdmin puede reabrir un contrato cerrado.');
    }
    const slaId = String(data?.slaId || '').trim();
    const motivo = String(data?.motivo || '').trim();
    if (!slaId)
        throw new functions.https.HttpsError('invalid-argument', 'slaId requerido.');
    if (motivo.length < 5)
        throw new functions.https.HttpsError('invalid-argument', 'Indicá el motivo de la reapertura.');
    const ref = db.collection('servicios_sla').doc(slaId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new functions.https.HttpsError('not-found', 'Contrato inexistente.');
    if (snap.data()?.closed !== true)
        return { success: true, alreadyOpen: true };
    const actor = String(context.auth.token?.email || panel.operatorName || context.auth.uid);
    await ref.update({
        closed: false,
        reopenedManually: true,
        reopenedAt: firestore_1.FieldValue.serverTimestamp(),
        reopenedBy: actor,
        reopenedByUid: context.auth.uid,
        reopenReason: motivo,
        closeHistory: firestore_1.FieldValue.arrayUnion({
            action: 'REABIERTO',
            by: actor,
            at: new Date().toISOString(),
            motivo,
        }),
    });
    return { success: true };
});
exports.cerrarContratoSla = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const db = admin.firestore();
    const panel = await (0, staffPermissions_1.resolvePanelUserForUid)(db, context.auth.uid, context.auth.token?.role);
    if (!panel?.isSuperAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Solo un SuperAdmin puede cerrar un contrato.');
    }
    const slaId = String(data?.slaId || '').trim();
    if (!slaId)
        throw new functions.https.HttpsError('invalid-argument', 'slaId requerido.');
    const actor = String(context.auth.token?.email || panel.operatorName || context.auth.uid);
    await db.collection('servicios_sla').doc(slaId).update({
        closed: true,
        reopenedManually: false,
        closedAt: firestore_1.FieldValue.serverTimestamp(),
        closedBy: actor,
        closedReason: 'MANUAL',
        closeHistory: firestore_1.FieldValue.arrayUnion({ action: 'CERRADO', by: actor, at: new Date().toISOString() }),
    });
    return { success: true };
});
//# sourceMappingURL=contratoCierre.js.map