"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sesionOperadorCallable = void 0;
exports.handleSesionOperador = handleSesionOperador;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
const staffPermissions_1 = require("./staffPermissions");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
function normalizeWriteOrigin(raw) {
    const v = String(raw || 'WEB').toUpperCase();
    return v === 'MOBILE' ? 'MOBILE' : 'WEB';
}
function auditFields(action, origin, uid) {
    return {
        writeOrigin: origin,
        lastAuditAction: action,
        lastAuditBy: uid,
        lastAuditAt: firestore_1.FieldValue.serverTimestamp(),
    };
}
function pickCanonicalPilotSession(sessions) {
    if (!sessions.length)
        return null;
    const sorted = [...sessions].sort((a, b) => {
        const dt = a.startTime.getTime() - b.startTime.getTime();
        if (dt !== 0)
            return dt;
        return String(a.id).localeCompare(String(b.id));
    });
    return sorted[0] ?? null;
}
async function loadActiveSessions(db, empresaId) {
    const snap = await db
        .collection('sesiones_operador')
        .where('empresaId', '==', empresaId)
        .where('status', '==', 'ACTIVO')
        .get();
    const now = Date.now();
    return snap.docs
        .map((d) => {
        const data = d.data();
        const roleRaw = String(data.role || '').toUpperCase();
        const req = String(data.pilotRequestStatus || 'NONE').toUpperCase();
        return {
            id: d.id,
            operatorId: String(data.operatorId || ''),
            startTime: data.startTime?.toDate?.() || new Date(),
            expiresAt: data.expiresAt?.toDate?.() || null,
            role: roleRaw === 'COPILOTO' ? 'COPILOTO' : 'PILOTO',
            pilotRequestStatus: req === 'PENDING' ? 'PENDING' : req === 'REJECTED' ? 'REJECTED' : 'NONE',
        };
    })
        .filter((s) => !s.expiresAt || s.expiresAt.getTime() > now);
}
async function closeSessionsByIds(db, ids, audit) {
    if (!ids.length)
        return;
    const batch = db.batch();
    for (const id of ids) {
        batch.update(db.collection('sesiones_operador').doc(id), {
            endTime: firestore_1.FieldValue.serverTimestamp(),
            status: 'CERRADO',
            pilotRequestStatus: 'NONE',
            pilotRequestedAt: null,
            ...audit,
        });
    }
    await batch.commit();
}
async function handleSesionOperador(db, uid, data, tokenRole) {
    const action = String(data?.action || '').trim();
    const empresaId = String(data?.empresaId || '').trim();
    const writeOrigin = normalizeWriteOrigin(data?.writeOrigin);
    const validActions = [
        'start', 'end', 'requestPilot', 'cancelPilotRequest', 'acceptPilot', 'rejectPilot', 'passToAuto',
    ];
    if (!validActions.includes(action)) {
        throw new functions.https.HttpsError('invalid-argument', 'action inválida.');
    }
    const panel = await (0, staffPermissions_1.assertOperationsUpdatePermission)(db, uid, empresaId, tokenRole);
    const audit = auditFields(action, writeOrigin, uid);
    if (action === 'start') {
        const existingMine = await db
            .collection('sesiones_operador')
            .where('empresaId', '==', empresaId)
            .where('operatorId', '==', uid)
            .where('status', '==', 'ACTIVO')
            .get();
        if (!existingMine.empty) {
            return { success: true, action };
        }
        const room = await loadActiveSessions(db, empresaId);
        const role = room.length ? 'COPILOTO' : 'PILOTO';
        await db.collection('sesiones_operador').add({
            operatorId: uid,
            operatorName: panel.operatorName,
            empresaId,
            startTime: firestore_1.FieldValue.serverTimestamp(),
            endTime: null,
            expiresAt: firestore_1.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
            status: 'ACTIVO',
            accionesCount: 0,
            role,
            pilotRequestStatus: 'NONE',
            pilotRequestedAt: null,
            ...audit,
        });
        return { success: true, action };
    }
    if (action === 'end') {
        const mineSnap = await db
            .collection('sesiones_operador')
            .where('empresaId', '==', empresaId)
            .where('operatorId', '==', uid)
            .where('status', '==', 'ACTIVO')
            .get();
        const ids = mineSnap.docs.map((d) => d.id);
        if (!ids.length) {
            throw new functions.https.HttpsError('failed-precondition', 'No hay guardia activa');
        }
        await closeSessionsByIds(db, ids, audit);
        return { success: true, action };
    }
    if (action === 'passToAuto') {
        let ids = (await loadActiveSessions(db, empresaId)).map((s) => s.id);
        if (!ids.length) {
            const snap = await db
                .collection('sesiones_operador')
                .where('empresaId', '==', empresaId)
                .where('status', '==', 'ACTIVO')
                .get();
            ids = snap.docs.map((d) => d.id);
        }
        await closeSessionsByIds(db, ids, audit);
        return { success: true, action };
    }
    const active = await loadActiveSessions(db, empresaId);
    const mySession = active.find((s) => s.operatorId === uid);
    if (!mySession) {
        throw new functions.https.HttpsError('failed-precondition', 'Sin sesión activa en la sala.');
    }
    const pilotSession = active.find((s) => s.role === 'PILOTO') || pickCanonicalPilotSession(active);
    const isPilot = !!pilotSession && pilotSession.operatorId === uid;
    if (action === 'requestPilot') {
        if (isPilot)
            return { success: true, action };
        await db.collection('sesiones_operador').doc(mySession.id).update({
            pilotRequestStatus: 'PENDING',
            pilotRequestedAt: firestore_1.FieldValue.serverTimestamp(),
            ...audit,
        });
        return { success: true, action };
    }
    if (action === 'cancelPilotRequest') {
        await db.collection('sesiones_operador').doc(mySession.id).update({
            pilotRequestStatus: 'NONE',
            pilotRequestedAt: null,
            ...audit,
        });
        return { success: true, action };
    }
    const pending = active.find((s) => s.pilotRequestStatus === 'PENDING' && s.role === 'COPILOTO');
    if (action === 'acceptPilot') {
        if (!isPilot || !pending || !pilotSession) {
            throw new functions.https.HttpsError('failed-precondition', 'No hay solicitud de mando pendiente.');
        }
        const batch = db.batch();
        batch.update(db.collection('sesiones_operador').doc(pending.id), {
            role: 'PILOTO',
            pilotRequestStatus: 'NONE',
            pilotRequestedAt: null,
            startTime: firestore_1.Timestamp.fromMillis(Math.min(pilotSession.startTime.getTime() - 1000, Date.now() - 1000)),
            ...audit,
        });
        batch.update(db.collection('sesiones_operador').doc(mySession.id), {
            role: 'COPILOTO',
            pilotRequestStatus: 'NONE',
            ...audit,
        });
        await batch.commit();
        return { success: true, action };
    }
    if (action === 'rejectPilot') {
        if (!isPilot || !pending) {
            throw new functions.https.HttpsError('failed-precondition', 'No hay solicitud de mando pendiente.');
        }
        await db.collection('sesiones_operador').doc(pending.id).update({
            pilotRequestStatus: 'REJECTED',
            pilotRequestedAt: null,
            ...audit,
        });
        return { success: true, action };
    }
    throw new functions.https.HttpsError('internal', 'Acción no implementada.');
}
exports.sesionOperadorCallable = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    return handleSesionOperador(admin.firestore(), context.auth.uid, data, context.auth.token?.role);
});
//# sourceMappingURL=sesionOperadorHandler.js.map