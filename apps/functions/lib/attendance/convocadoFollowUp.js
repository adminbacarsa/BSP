"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convocadoFollowUpClosePatch = convocadoFollowUpClosePatch;
exports.runConvocadoFollowUp = runConvocadoFollowUp;
const firestore_1 = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const convocadoEta_1 = require("../common/convocadoEta");
const convocatoriaEventos_1 = require("../coverage/convocatoriaEventos");
const syncAusenciaCobertura_1 = require("../coverage/syncAusenciaCobertura");
const pushGreeting_1 = require("../common/pushGreeting");
const shiftAlertFcm_1 = require("../notifications/shiftAlertFcm");
const PAGE = 50;
const MAX_PAGES = 20;
function ms(v) {
    return v?.toMillis?.() ?? 0;
}
async function tokensOf(db, employeeId) {
    if (!employeeId)
        return [];
    const emp = await db.collection('empleados').doc(employeeId).get();
    const uid = String(emp.data()?.uid || '').trim();
    if (!uid)
        return [];
    const snap = await db.collection('device_tokens').where('uid', '==', uid).get();
    return snap.docs.map((d) => d.data()?.token).filter((t) => typeof t === 'string' && t.length > 10);
}
function covIdOf(conv) {
    const id = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
    return !id || id.endsWith('_') ? '' : id;
}
async function covDoc(db, conv) {
    const covId = covIdOf(conv);
    if (!covId)
        return null;
    const snap = await db.collection('turnos').doc(covId).get();
    return snap.exists ? snap.data() : null;
}
function punched(cov) {
    return cov?.isPresent === true || String(cov?.status || '').toUpperCase() === 'PRESENT';
}
async function gapEndMs(db, conv, cov) {
    const own = ms(conv.gapEndAt);
    if (own > 0)
        return own;
    const fromCov = ms(cov?.endTime);
    if (fromCov > 0)
        return fromCov;
    const titId = String(conv.shiftId || '').trim();
    if (!titId)
        return 0;
    const tit = await db.collection('turnos').doc(titId).get();
    return ms(tit.data()?.endTime);
}
function convocadoFollowUpClosePatch(reason, now) {
    return {
        reminderPending: false,
        delayAlertPending: false,
        followUpClosedAt: now,
        followUpClosedReason: reason,
    };
}
async function closeIfDone(db, doc, conv, nowMs, now) {
    const cov = await covDoc(db, conv);
    if (punched(cov)) {
        await doc.ref.update(convocadoFollowUpClosePatch('FICHO', now));
        return 'FICHO';
    }
    const end = await gapEndMs(db, conv, cov);
    if (end > 0 && end <= nowMs) {
        await doc.ref.update(convocadoFollowUpClosePatch('HUECO_TERMINADO', now));
        return 'HUECO_TERMINADO';
    }
    return null;
}
async function* paginate(base, orderField) {
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        let q = base.orderBy(orderField).limit(PAGE);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty)
            return;
        for (const d of snap.docs)
            yield d;
        if (snap.size < PAGE)
            return;
        cursor = snap.docs[snap.docs.length - 1];
    }
}
async function sendReminder(db, doc, conv, now) {
    const eta = Number(conv.etaMinutes) || 0;
    const name = (0, pushGreeting_1.guardFirstName)({ employeeName: conv.candidateEmployeeName });
    const body = (0, pushGreeting_1.guardLead)(name, '¿Seguís en camino? Si te demorás, avisanos en cuánto llegás.');
    const tokens = await tokensOf(db, String(conv.candidateEmployeeId || ''));
    if (tokens.length) {
        const platform = (0, shiftAlertFcm_1.shiftAlertPlatformConfig)();
        await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title: '¿Venís en camino?', body },
            data: {
                type: 'CONVOCADO_RECORDATORIO',
                convocatoriaId: doc.id,
                etaMinutes: String(eta),
            },
            android: platform.android,
            apns: platform.apns,
        }).catch(() => undefined);
    }
    await doc.ref.update({ reminderSentAt: now, reminderPending: false });
    const covId = covIdOf(conv);
    if (covId)
        await db.collection('turnos').doc(covId).update({ convocadoReminderSentAt: now }).catch(() => undefined);
    await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, doc.id, { type: 'RECORDATORIO', etaMinutes: eta, at: now });
}
async function raiseDelay(db, doc, conv, now) {
    const expectedMs = ms(conv.expectedArrivalAt);
    await db.collection('novedades').add({
        type: 'CONVOCADO_DEMORADO',
        status: 'pending',
        priority: 'high',
        convocatoriaId: doc.id,
        shiftId: conv.shiftId || null,
        employeeId: conv.candidateEmployeeId || null,
        employeeName: conv.candidateEmployeeName || '',
        objectiveId: conv.objectiveId || null,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId || null,
        title: 'Convocado demorado',
        description: `${conv.candidateEmployeeName || 'Convocado'} no fichó a la hora estimada. Esperar, llamar o cancelar y reconvocar.`,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        source: 'SYSTEM_SCHEDULER',
    });
    await doc.ref.update({
        delayAlertPending: false,
        delayAlertedForArrivalAt: expectedMs > 0 ? firestore_1.Timestamp.fromMillis(expectedMs) : now,
        convocadoDemorado: true,
    });
    const covId = covIdOf(conv);
    if (covId)
        await db.collection('turnos').doc(covId).update({ convocadoDemorado: true }).catch(() => undefined);
    await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, doc.id, { type: 'DEMORADO', at: now });
}
async function runConvocadoFollowUp(db, now = firestore_1.Timestamp.now()) {
    const nowMs = now.toMillis();
    let n = 0;
    const seen = new Set();
    const remBase = db.collection('convocatorias_cobertura')
        .where('status', '==', 'ACCEPTED')
        .where('reminderPending', '==', true)
        .where('reminderAt', '<=', now);
    for await (const doc of paginate(remBase, 'reminderAt')) {
        if (seen.has(doc.id))
            continue;
        seen.add(doc.id);
        const conv = doc.data();
        if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE') {
            await doc.ref.update({ reminderPending: false, delayAlertPending: false });
            continue;
        }
        if (await closeIfDone(db, doc, conv, nowMs, now))
            continue;
        if (conv.reminderSentAt) {
            await doc.ref.update({ reminderPending: false });
            continue;
        }
        await sendReminder(db, doc, conv, now);
        n += 1;
    }
    const delayCut = firestore_1.Timestamp.fromMillis(nowMs - convocadoEta_1.CONVOCADO_DELAY_GRACE_MIN * 60 * 1000);
    const delayBase = db.collection('convocatorias_cobertura')
        .where('status', '==', 'ACCEPTED')
        .where('delayAlertPending', '==', true)
        .where('expectedArrivalAt', '<=', delayCut);
    for await (const doc of paginate(delayBase, 'expectedArrivalAt')) {
        const conv = doc.data();
        if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE') {
            await doc.ref.update({ reminderPending: false, delayAlertPending: false });
            continue;
        }
        if (await closeIfDone(db, doc, conv, nowMs, now))
            continue;
        if (ms(conv.delayAlertedForArrivalAt) === ms(conv.expectedArrivalAt)) {
            await doc.ref.update({ delayAlertPending: false });
            continue;
        }
        await raiseDelay(db, doc, conv, now);
        n += 1;
    }
    return n;
}
//# sourceMappingURL=convocadoFollowUp.js.map