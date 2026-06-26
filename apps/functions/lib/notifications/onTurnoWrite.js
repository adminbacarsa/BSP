"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTurnoWrite = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const planificacionEstadoKeys_1 = require("../assistant/planificacionEstadoKeys");
const llegadaTardeUtils_1 = require("../ausencias/llegadaTardeUtils");
const updateLiquidacionOnTurnoComplete_1 = require("../liquidacion/updateLiquidacionOnTurnoComplete");
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
async function sendEmployeeTurnoPush(db, employeeId, msg, type, turnoId) {
    if (!employeeId || employeeId === 'VACANTE')
        return;
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const empUid = empDoc.exists ? empDoc.data()?.uid : undefined;
    const [byEmpId, byUid] = await Promise.all([
        db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
        empUid ? db.collection('device_tokens').where('uid', '==', empUid).get() : Promise.resolve({ docs: [] }),
    ]);
    const tokenSet = new Set();
    [...byEmpId.docs, ...byUid.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10)
        tokenSet.add(t); });
    await db.collection('user_notifications').add({
        uid: empUid || null, employeeId, title: msg.title, body: msg.body,
        type, target: 'employee', turnoId, read: false, readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const tokens = Array.from(tokenSet);
    if (tokens.length) {
        await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title: msg.title, body: msg.body },
            webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } },
        }).catch(e => console.warn('[onTurnoWrite] push error:', e));
    }
}
exports.onTurnoWrite = functions
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .firestore.document('turnos/{turnoId}')
    .onWrite(async (change) => {
    const db = admin.firestore();
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    try {
        await (0, updateLiquidacionOnTurnoComplete_1.updateLiquidacionOnTurnoComplete)(db, change.after.id, after, before);
    }
    catch (e) {
        console.warn('[onTurnoWrite] liquidacion incremental:', e?.message);
    }
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
        await db.collection('user_notifications').add({ uid: empUid || null, employeeId, title: retMsg.title, body: retMsg.body, type: 'RETENCION_AUTO', target: 'employee', turnoId, read: false, readAt: null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        if (tokens.length) {
            await admin.messaging().sendEachForMulticast({ tokens, notification: { title: retMsg.title, body: retMsg.body }, webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } } }).catch(e => console.warn('[onTurnoWrite] Retención push error:', e));
        }
        return;
    }
    if (after && before && !before.isCompleted && after.isCompleted === true) {
        const solicitudId = after.solicitudRefuerzoId;
        if (solicitudId) {
            try {
                const solDoc = await db.collection('solicitudes_refuerzo').doc(solicitudId).get();
                if (solDoc.exists) {
                    const data = solDoc.data() || {};
                    const turnoIds = Array.isArray(data.turnoIds) ? data.turnoIds : [];
                    const idsToCheck = turnoIds.length > 0 ? turnoIds : [change.after.id];
                    const snaps = await Promise.all(idsToCheck.map((id) => db.collection('turnos').doc(id).get()));
                    const allDone = snaps.every((d) => d.exists && d.data()?.isCompleted === true);
                    if (allDone && data.estado !== 'COMPLETADA') {
                        await db.collection('solicitudes_refuerzo').doc(solicitudId).update({
                            estado: 'COMPLETADA',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                    }
                }
            }
            catch (e) {
                console.warn('[onTurnoWrite] solicitud COMPLETADA error:', e);
            }
        }
    }
    if (after && before && !before.isCompleted && after.isCompleted === true &&
        (after.completionReason === 'AUTO_SHIFT_END' || after.completionReason === 'AUTO_SHIFT_END_CUSTOM' || after.completionReason === 'AUTO_END_CF_RETENTION_TIMEOUT' || after.completionReason === 'AUTO_COVERAGE_COMPLETE')) {
        const completedEmployeeId = after.employeeId;
        if (!completedEmployeeId)
            return;
        const objective = after.objectiveName || after.clientName || 'tu puesto';
        const fmtT = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
        const endDate = after.endTime?.toDate ? after.endTime.toDate() : null;
        const endStr = endDate ? fmtT(endDate) : '';
        const completedMsg = {
            title: '✅ Turno finalizado',
            body: endStr
                ? `Tu turno en ${objective} finalizó a las ${endStr}. ¡Hasta luego!`
                : `Tu turno en ${objective} ha concluido. ¡Hasta luego!`,
        };
        const empDocC = await db.collection('empleados').doc(completedEmployeeId).get();
        const empUidC = empDocC.exists ? empDocC.data()?.uid : undefined;
        const [byEmpIdC, byUidC] = await Promise.all([
            db.collection('device_tokens').where('employeeId', '==', completedEmployeeId).get(),
            empUidC ? db.collection('device_tokens').where('uid', '==', empUidC).get() : Promise.resolve({ docs: [] }),
        ]);
        const tokenSetC = new Set();
        [...byEmpIdC.docs, ...byUidC.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10)
            tokenSetC.add(t); });
        const tokensC = Array.from(tokenSetC);
        const turnoIdC = change.after.id;
        await db.collection('user_notifications').add({
            uid: empUidC || null, employeeId: completedEmployeeId,
            title: completedMsg.title, body: completedMsg.body,
            type: 'TURNO_COMPLETADO', target: 'employee', turnoId: turnoIdC,
            read: false, readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (tokensC.length) {
            await admin.messaging().sendEachForMulticast({
                tokens: tokensC,
                notification: { title: completedMsg.title, body: completedMsg.body },
                webpush: { notification: { icon: '/icons/icon-192x192.png' }, fcmOptions: { link: '/empleado/dashboard' } },
            }).catch(e => console.warn('[onTurnoWrite] Completado push error:', e));
        }
        return;
    }
    const rfzTuraCodes = new Set(['RFZ', 'TURA']);
    if (after && before && rfzTuraCodes.has(String(after.code || '').toUpperCase())) {
        const wasVacante = !before.employeeId || before.employeeId === 'VACANTE';
        const nowHasEmployee = after.employeeId && after.employeeId !== 'VACANTE';
        if (wasVacante && nowHasEmployee) {
            const assignedEmployeeId = after.employeeId;
            const objective = after.objectiveName || after.clientName || 'el objetivo';
            const position = after.positionName || '';
            const code = String(after.code || 'RFZ').toUpperCase();
            const dateStr = formatDate(after.startTime);
            const rfzMsg = {
                title: code === 'TURA' ? '📅 Turno Agregado asignado' : '📅 Refuerzo de cliente asignado',
                body: `${dateStr}${position ? ' · ' + position : ''} — ${objective}`,
            };
            const empDocR = await db.collection('empleados').doc(assignedEmployeeId).get();
            const empUidR = empDocR.exists ? empDocR.data()?.uid : undefined;
            const [byEmpIdR, byUidR] = await Promise.all([
                db.collection('device_tokens').where('employeeId', '==', assignedEmployeeId).get(),
                empUidR ? db.collection('device_tokens').where('uid', '==', empUidR).get() : Promise.resolve({ docs: [] }),
            ]);
            const tokenSetR = new Set();
            [...byEmpIdR.docs, ...byUidR.docs].forEach(d => { const t = d.data()?.token; if (typeof t === 'string' && t.length > 10)
                tokenSetR.add(t); });
            const tokensR = Array.from(tokenSetR);
            const turnoIdR = change.after.id;
            await db.collection('user_notifications').add({
                uid: empUidR || null,
                employeeId: assignedEmployeeId,
                title: rfzMsg.title,
                body: rfzMsg.body,
                type: 'TURNO_NUEVO',
                target: 'employee',
                turnoId: turnoIdR,
                read: false,
                readAt: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            if (tokensR.length) {
                await admin.messaging().sendEachForMulticast({
                    tokens: tokensR,
                    notification: { title: rfzMsg.title, body: rfzMsg.body },
                    webpush: { notification: { icon: '/icons/icon-192x192.png', requireInteraction: true }, fcmOptions: { link: '/empleado/dashboard' } },
                }).catch(e => console.warn('[onTurnoWrite] RFZ/TURA push error:', e));
            }
            const solicitudId = after.solicitudRefuerzoId;
            if (solicitudId) {
                try {
                    await db.collection('solicitudes_refuerzo').doc(solicitudId).update({
                        estado: 'ASIGNADA',
                        turnoIds: admin.firestore.FieldValue.arrayUnion(turnoIdR),
                        empleadoIds: admin.firestore.FieldValue.arrayUnion(assignedEmployeeId),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    const novSnap = await db.collection('novedades')
                        .where('solicitudRefuerzoId', '==', solicitudId)
                        .where('type', '==', 'REFUERZO_CLIENTE_PENDIENTE')
                        .where('status', '==', 'pending')
                        .limit(5).get();
                    if (!novSnap.empty) {
                        const batch = db.batch();
                        novSnap.docs.forEach(d => batch.update(d.ref, { status: 'read', viewed: true }));
                        await batch.commit();
                    }
                }
                catch (e) {
                    console.warn('[onTurnoWrite] RFZ solicitud/novedad update error:', e);
                }
            }
            return;
        }
    }
    if (after && before && rfzTuraCodes.has(String(after.code || '').toUpperCase())
        && before.draft === true && after.draft === false
        && after.employeeId && after.employeeId !== 'VACANTE') {
        const code = String(after.code || 'RFZ').toUpperCase();
        const objective = after.objectiveName || after.clientName || 'el objetivo';
        const position = after.positionName || '';
        const dateStr = formatDate(after.startTime);
        await sendEmployeeTurnoPush(db, after.employeeId, {
            title: code === 'TURA' ? '📅 Turno Agregado asignado' : '📅 Refuerzo de cliente asignado',
            body: `${dateStr}${position ? ' · ' + position : ''} — ${objective}`,
        }, 'TURNO_NUEVO', change.after.id);
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
            target: 'employee',
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