"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTurnoWrite = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const planificacionEstadoKeys_1 = require("../assistant/planificacionEstadoKeys");
const llegadaTardeUtils_1 = require("../ausencias/llegadaTardeUtils");
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
    const turn = after || before;
    const planningOrigins = new Set(['', 'PLANIFICADOR', 'SLA_VIRTUAL', undefined]);
    if (turn && planningOrigins.has(turn.origin) && turn.objectiveId) {
        const startMs = turn.startTime?.toMillis?.() ?? (turn.startTime?.seconds ? turn.startTime.seconds * 1000 : 0);
        if (startMs) {
            const { year, month } = (0, planificacionEstadoKeys_1.ymCordobaParts)(new Date(startMs));
            const empId = String(turn.empresaId ?? '').trim();
            const docIds = (0, planificacionEstadoKeys_1.planificacionEstadoLookupDocIds)(empId, turn.objectiveId, year, month);
            const planDocs = await Promise.all(docIds.map(id => db.doc(`planificacion_estados/${id}`).get()));
            if (!planDocs.some(s => s.exists))
                return;
        }
    }
    if (before && after && before.isAbsent === true && after.isPresent === true && !after.isAbsent) {
        const turnoId = change.after.id;
        try {
            const ausSnap = await db.collection('ausencias')
                .where('shiftId', '==', turnoId)
                .limit(5).get();
            const aaDoc = ausSnap.docs.find(d => d.data().absenceType === 'AA');
            if (aaDoc) {
                const ausData = aaDoc.data();
                const fmtT = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
                const st = after.startTime?.toDate ? after.startTime.toDate() : null;
                const et = after.endTime?.toDate ? after.endTime.toDate() : null;
                const horario = st ? (et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st)) : '';
                const checkInTs = after.checkInTime?.toDate ? after.checkInTime.toDate() : null;
                const checkInStr = checkInTs ? fmtT(checkInTs) : null;
                await aaDoc.ref.update({
                    type: 'Llegada Tarde',
                    absenceType: 'LT',
                    status: 'Confirmada',
                    reason: `Llegada tarde al turno${horario ? ' ' + horario : ''} - ${after.objectiveName || ''} (${after.positionName || ''})`,
                    arrivedAt: admin.firestore.FieldValue.serverTimestamp(),
                    checkInTime: after.checkInTime || null,
                    checkInTimeStr: checkInStr,
                });
                console.log('[onTurnoWrite] Ausencia → Llegada Tarde para turno:', turnoId, 'ingresó:', checkInStr);
                await (0, llegadaTardeUtils_1.checkLlegadaTardeReiterada)(db, ausData.employeeId || after.employeeId || '', ausData.employeeName || after.employeeName || '', ausData.empresaId || after.empresaId || null, ausData.startDate || '');
            }
        }
        catch (e) {
            console.warn('[onTurnoWrite] Error actualizando ausencia a Llegada Tarde:', e);
        }
        return;
    }
    if (after && before && !before.isRetention && after.isRetention === true) {
        const employeeId = after.employeeId;
        if (!employeeId)
            return;
        const objective = after.objectiveName || after.clientName || 'el puesto';
        const position = after.positionName || '';
        const retMsg = { title: '⏰ Quedaste retenido', body: `Permanecé en ${objective}${position ? ' · ' + position : ''} hasta nuevo aviso de Operaciones.` };
        const empDoc = await db.collection('empleados').doc(employeeId).get();
        const empUid = empDoc.exists ? empDoc.data()?.uid : undefined;
        const [byEmpId, byUid] = await Promise.all([
            db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
            empUid ? db.collection('device_tokens').where('uid', '==', empUid).get() : Promise.resolve({ docs: [] }),
        ]);
        const tokenSet = new Set();
        [...byEmpId.docs, ...byUid.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10)
            tokenSet.add(t); });
        const tokens = Array.from(tokenSet);
        const turnoId = change.after.id;
        await db.collection('user_notifications').add({ uid: empUid || null, employeeId, title: retMsg.title, body: retMsg.body, type: 'RETENCION_AUTO', turnoId, read: false, readAt: null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        if (tokens.length) {
            await admin.messaging().sendEachForMulticast({ tokens, notification: { title: retMsg.title, body: retMsg.body }, webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } } }).catch(e => console.warn('[onTurnoWrite] Retención push error:', e));
        }
        return;
    }
    let eventType;
    const employeeId = (after || before)?.employeeId;
    if (!employeeId)
        return;
    if (!after) {
        eventType = 'TURNO_ELIMINADO';
    }
    else if (!before) {
        if (after.draft === true)
            return;
        const isFranco = after.code === 'F' || after.isFranco;
        eventType = isFranco ? 'FRANCO_ASIGNADO' : 'TURNO_NUEVO';
    }
    else {
        const relevantFields = ['startTime', 'endTime', 'code', 'objectiveName', 'clientName', 'positionName', 'isFranco'];
        const changed = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
        if (before.draft === true && after.draft === false && !changed)
            return;
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