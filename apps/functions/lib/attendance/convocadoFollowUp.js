"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConvocadoFollowUp = runConvocadoFollowUp;
const firestore_1 = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const convocadoEta_1 = require("../common/convocadoEta");
const convocatoriaEventos_1 = require("../coverage/convocatoriaEventos");
const syncAusenciaCobertura_1 = require("../coverage/syncAusenciaCobertura");
const pushGreeting_1 = require("../common/pushGreeting");
const shiftAlertFcm_1 = require("../notifications/shiftAlertFcm");
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
async function punched(db, conv) {
    const covId = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
    if (!covId || covId.endsWith('_'))
        return false;
    const cov = await db.collection('turnos').doc(covId).get();
    const d = cov.data();
    return d?.isPresent === true || String(d?.status || '').toUpperCase() === 'PRESENT';
}
async function runConvocadoFollowUp(db, now = firestore_1.Timestamp.now()) {
    const nowMs = now.toMillis();
    const snap = await db.collection('convocatorias_cobertura').where('status', '==', 'ACCEPTED').limit(40).get();
    let n = 0;
    for (const doc of snap.docs) {
        const conv = doc.data();
        if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE')
            continue;
        if (await punched(db, conv))
            continue;
        const reminderMs = conv.reminderAt?.toMillis?.() ?? 0;
        if (reminderMs > 0 && nowMs >= reminderMs && !conv.reminderSentAt) {
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
            await doc.ref.update({ reminderSentAt: now });
            const covId = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
            await db.collection('turnos').doc(covId).update({ convocadoReminderSentAt: now }).catch(() => undefined);
            await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, doc.id, { type: 'RECORDATORIO', etaMinutes: eta, at: now });
            n += 1;
        }
        const expectedMs = conv.expectedArrivalAt?.toMillis?.() ?? 0;
        const alertedFor = conv.delayAlertedForArrivalAt?.toMillis?.() ?? 0;
        const due = expectedMs > 0 && nowMs >= expectedMs + convocadoEta_1.CONVOCADO_DELAY_GRACE_MIN * 60 * 1000;
        if (due && alertedFor !== expectedMs) {
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
            await doc.ref.update({ delayAlertedForArrivalAt: firestore_1.Timestamp.fromMillis(expectedMs), convocadoDemorado: true });
            const covId = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
            await db.collection('turnos').doc(covId).update({ convocadoDemorado: true }).catch(() => undefined);
            await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, doc.id, { type: 'DEMORADO', at: now });
            n += 1;
        }
    }
    return n;
}
//# sourceMappingURL=convocadoFollowUp.js.map