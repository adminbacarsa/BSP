"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTurnoWrite = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
function formatDate(ts) {
    if (!ts)
        return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function buildMessage(type, after, before, turnoId) {
    const dateStr = formatDate(after?.startTime || before?.startTime);
    const objective = (after || before)?.objectiveName || (after || before)?.clientName || '';
    const code = (after || before)?.code || '';
    const isFranco = code === 'F' || (after || before)?.isFranco;
    switch (type) {
        case 'TURNO_ELIMINADO':
            return {
                title: '❌ Turno eliminado',
                body: dateStr ? `${dateStr}${code && code !== 'F' ? ` · ${code}` : ''} — ${objective || 'tu cronograma'}` : 'Un turno fue eliminado de tu cronograma',
            };
        case 'FRANCO_ASIGNADO':
            return {
                title: '🟢 Franco asignado',
                body: dateStr ? `${dateStr} — día libre confirmado` : 'Se te asignó un día franco',
            };
        case 'TURNO_NUEVO':
            return {
                title: '📅 Nuevo turno asignado',
                body: dateStr ? `${dateStr}${code ? ` · ${code}` : ''} — ${objective}` : objective || 'Nuevo turno en tu cronograma',
            };
        case 'TURNO_MODIFICADO': {
            const changes = [];
            if (before && after) {
                if (JSON.stringify(before.startTime) !== JSON.stringify(after.startTime) ||
                    JSON.stringify(before.endTime) !== JSON.stringify(after.endTime)) {
                    changes.push('horario cambiado');
                }
                if (before.code !== after.code)
                    changes.push(`turno: ${before.code} → ${after.code}`);
                if (before.objectiveName !== after.objectiveName)
                    changes.push(`objetivo: ${after.objectiveName}`);
                if (before.positionName !== after.positionName)
                    changes.push(`puesto: ${after.positionName}`);
            }
            const detail = changes.length ? changes.join(', ') : (dateStr ? `${dateStr}${code ? ` · ${code}` : ''}` : '');
            return {
                title: '🔄 Cambio en tu cronograma',
                body: detail || objective || 'Tu cronograma fue modificado',
            };
        }
        default:
            return null;
    }
}
exports.onTurnoWrite = functions
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .firestore.document('turnos/{turnoId}')
    .onWrite(async (change) => {
    const db = admin.firestore();
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    if (after?.draft === true)
        return;
    let eventType;
    const employeeId = (after || before)?.employeeId;
    if (!employeeId)
        return;
    if (!after) {
        eventType = 'TURNO_ELIMINADO';
    }
    else if (!before) {
        const isFranco = after.code === 'F' || after.isFranco;
        eventType = isFranco ? 'FRANCO_ASIGNADO' : 'TURNO_NUEVO';
    }
    else {
        const relevantFields = ['startTime', 'endTime', 'code', 'objectiveName', 'clientName', 'positionName', 'isFranco'];
        const changed = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
        if (!changed)
            return;
        const nowFranco = after.code === 'F' || after.isFranco;
        const wasFranco = before.code === 'F' || before.isFranco;
        eventType = (nowFranco && !wasFranco) ? 'FRANCO_ASIGNADO' : 'TURNO_MODIFICADO';
    }
    const msg = buildMessage(eventType, after, before, change.after.id || change.before.id);
    if (!msg)
        return;
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const empUid = empDoc.exists ? empDoc.data()?.uid : undefined;
    const [byEmpId, byUid] = await Promise.all([
        db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
        empUid
            ? db.collection('device_tokens').where('uid', '==', empUid).get()
            : Promise.resolve({ docs: [] }),
    ]);
    const tokenSet = new Set();
    [...byEmpId.docs, ...byUid.docs].forEach(d => {
        const t = d.data()?.token;
        if (typeof t === 'string' && t.length > 10)
            tokenSet.add(t);
    });
    const tokens = Array.from(tokenSet);
    const turnoId = change.after.id || change.before.id;
    let notifDocId = null;
    try {
        const notifRef = await db.collection('user_notifications').add({
            uid: empUid || null,
            employeeId,
            title: msg.title,
            body: msg.body,
            type: eventType,
            turnoId,
            read: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        notifDocId = notifRef.id;
    }
    catch (e) {
        console.error('[onTurnoWrite] Error saving notification:', e?.message);
    }
    if (!tokens.length) {
        console.warn('[onTurnoWrite] No tokens found for employee:', employeeId, 'uid:', empUid);
        return;
    }
    console.log('[onTurnoWrite] Sending push to', tokens.length, 'token(s) for employee:', employeeId);
    try {
        const result = await admin.messaging().sendEachForMulticast({
            data: {
                turnoId,
                employeeId,
                type: eventType,
                title: msg.title,
                body: msg.body,
                notificationId: notifDocId || '',
                link: `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`,
            },
            webpush: {
                headers: { Urgency: 'high' },
                fcmOptions: { link: `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}` },
            },
            tokens,
        });
        console.log('[onTurnoWrite] FCM result: success=', result.successCount, 'fail=', result.failureCount);
        const invalidTokens = [];
        result.responses.forEach((r, i) => {
            if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' || r.error?.code === 'messaging/invalid-registration-token')) {
                invalidTokens.push(tokens[i]);
            }
        });
        if (invalidTokens.length > 0) {
            const cleanSnap = await db.collection('device_tokens').where('token', 'in', invalidTokens).get();
            const batch = db.batch();
            cleanSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log('[onTurnoWrite] Cleaned', invalidTokens.length, 'invalid token(s)');
        }
    }
    catch (e) {
        console.error('[onTurnoWrite] FCM error:', e?.message);
    }
});
//# sourceMappingURL=onTurnoWrite.js.map