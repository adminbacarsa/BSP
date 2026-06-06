"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCronogramaPublished = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
exports.onCronogramaPublished = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('planificacion_estados/{docId}')
    .onCreate(async (snap) => {
    const data = snap.data();
    const objectiveId = String(data.objectiveId ?? data.objetivoId ?? '').trim();
    const year = Number(data.year ?? data.año);
    const month = Number(data.month ?? data.mes);
    const empresaId = String(data.empresaId ?? '').trim();
    if (!objectiveId || !year || !month) {
        console.warn('[onCronogramaPublished] Documento incompleto:', snap.id, data);
        return;
    }
    const db = admin.firestore();
    await new Promise(resolve => setTimeout(resolve, 4000));
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    const turnosSnap = await db.collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(firstDay))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(lastDay))
        .get();
    if (turnosSnap.empty) {
        console.log('[onCronogramaPublished] Sin turnos para', objectiveId, month, year);
        return;
    }
    const empMap = new Map();
    turnosSnap.docs.forEach(d => {
        const t = d.data();
        if (!t.employeeId || t.employeeId === 'VACANTE')
            return;
        if (empresaId && t.empresaId && t.empresaId !== empresaId)
            return;
        if (!empMap.has(t.employeeId)) {
            empMap.set(t.employeeId, {
                name: t.employeeName || '',
                work: 0,
                franco: 0,
                objectiveName: t.objectiveName || '',
            });
        }
        const entry = empMap.get(t.employeeId);
        const code = (t.code || '').toUpperCase();
        if (code === 'F' || t.isFranco)
            entry.franco++;
        else
            entry.work++;
    });
    if (empMap.size === 0) {
        console.log('[onCronogramaPublished] Sin empleados válidos para notificar');
        return;
    }
    const monthName = new Date(year, month - 1, 1)
        .toLocaleString('es-AR', { month: 'long', year: 'numeric', timeZone: 'America/Argentina/Cordoba' });
    console.log(`[onCronogramaPublished] Notificando ${empMap.size} empleado(s) — ${objectiveId} ${month}/${year}`);
    for (const [employeeId, info] of empMap.entries()) {
        const title = `📅 Cronograma de ${monthName} disponible`;
        const body = `${info.objectiveName} — ${info.work} turno${info.work !== 1 ? 's' : ''}${info.franco > 0 ? ` · ${info.franco} franco${info.franco !== 1 ? 's' : ''}` : ''}`;
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
        let notifDocId = null;
        try {
            const ref = await db.collection('user_notifications').add({
                uid: empUid || null,
                employeeId,
                title,
                body,
                type: 'CRONOGRAMA_PUBLICADO',
                objectiveId,
                year,
                month,
                read: false,
                readAt: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            notifDocId = ref.id;
        }
        catch (e) {
            console.warn('[onCronogramaPublished] Error guardando notificación:', e?.message);
        }
        if (tokens.length === 0) {
            console.warn(`[onCronogramaPublished] Sin tokens para ${info.name} (${employeeId})`);
            continue;
        }
        try {
            const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
            const result = await admin.messaging().sendEachForMulticast({
                data: {
                    type: 'CRONOGRAMA_PUBLICADO',
                    title,
                    body,
                    objectiveId,
                    month: String(month),
                    year: String(year),
                    notificationId: notifDocId || '',
                    link,
                },
                webpush: {
                    headers: { Urgency: 'normal' },
                    fcmOptions: { link },
                },
                tokens,
            });
            console.log(`[onCronogramaPublished] ${info.name}: success=${result.successCount} fail=${result.failureCount}`);
            const invalid = [];
            result.responses.forEach((r, i) => {
                if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' ||
                    r.error?.code === 'messaging/invalid-registration-token'))
                    invalid.push(tokens[i]);
            });
            if (invalid.length > 0) {
                const cleanSnap = await db.collection('device_tokens').where('token', 'in', invalid).get();
                const batch = db.batch();
                cleanSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }
        catch (e) {
            console.warn(`[onCronogramaPublished] FCM error para ${info.name}:`, e?.message);
        }
    }
    console.log(`[onCronogramaPublished] Completado — ${empMap.size} empleado(s) notificado(s)`);
});
//# sourceMappingURL=onCronogramaPublished.js.map