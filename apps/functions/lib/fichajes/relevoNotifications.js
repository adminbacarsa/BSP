"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatHmArgentina = formatHmArgentina;
exports.notifyTurnoFinalizadoRelevo = notifyTurnoFinalizadoRelevo;
exports.notifyRetencionAvisoRelevoTarde = notifyRetencionAvisoRelevoTarde;
exports.applyLateReliefNoticeToOutgoing = applyLateReliefNoticeToOutgoing;
const firestore_1 = require("firebase-admin/firestore");
const pushGreeting_1 = require("../common/pushGreeting");
const relevoOutgoingMatch_1 = require("./relevoOutgoingMatch");
const reliefEligibility_1 = require("../common/reliefEligibility");
function formatHmArgentina(ms) {
    return new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date(ms));
}
async function employeePushIdentity(db, employeeId, employeeName) {
    if (!employeeId)
        return { name: (0, pushGreeting_1.guardFirstName)({ employeeName }) };
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const emp = empDoc.exists ? empDoc.data() || {} : {};
    return {
        uid: emp.uid,
        name: (0, pushGreeting_1.guardFirstName)({ firstName: emp.firstName, employeeName: employeeName || emp.nombre }),
    };
}
async function notifyTurnoFinalizadoRelevo(db, params) {
    const { outEmpId, outDocId, objectiveName, empresaId } = params;
    const who = await employeePushIdentity(db, outEmpId);
    const title = 'Turno finalizado';
    const body = who.name
        ? `¡Gracias, ${who.name}! Terminaste tu turno en ${objectiveName || 'el puesto'}. Buen descanso.`
        : `¡Gracias! Terminaste tu turno en ${objectiveName || 'el puesto'}. Buen descanso.`;
    try {
        const outEmpUid = who.uid;
        await db.collection('user_notifications').add({
            uid: outEmpUid || null,
            employeeId: outEmpId,
            userId: outEmpId,
            title,
            body,
            type: 'TURNO_FINALIZADO',
            target: 'employee',
            turnoId: outDocId,
            empresaId: empresaId || null,
            read: false,
            readAt: null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.warn('[relevoNotifications] TURNO_FINALIZADO doc:', e?.message);
    }
}
async function notifyRetencionAvisoRelevoTarde(db, params) {
    const { outEmpId, outDocId, incomingName, objectiveName, etaAtMs, empresaId } = params;
    const etaLabel = formatHmArgentina(etaAtMs);
    const objLabel = objectiveName || 'el puesto';
    const who = await employeePushIdentity(db, outEmpId);
    const title = '⛔ Quedás retenido';
    const lead = who.name ? `${who.name}, quedás retenido` : 'Quedás retenido';
    const body = `${lead} en ${objLabel}. ${incomingName} llega cerca de las ${etaLabel}. No abandones el puesto hasta que llegue tu relevo o Operaciones te libere.`;
    try {
        const outEmpUid = who.uid;
        await db.collection('user_notifications').add({
            uid: outEmpUid || null,
            employeeId: outEmpId,
            userId: outEmpId,
            title,
            body,
            type: 'RETENCION_AVISO',
            target: 'employee',
            turnoId: outDocId,
            empresaId: empresaId || null,
            lateReliefEtaAtMs: etaAtMs,
            read: false,
            readAt: null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.warn('[relevoNotifications] RETENCION_AVISO doc:', e?.message);
    }
}
async function applyLateReliefNoticeToOutgoing(db, incomingShiftId, shiftData, etaAt) {
    if (!(0, reliefEligibility_1.isReliefEligibleShift)(shiftData))
        return false;
    const gapStartMs = shiftData.startTime?.toMillis?.() ?? 0;
    const objectiveId = String(shiftData.objectiveId || '').trim();
    const positionName = shiftData.positionName;
    if (!objectiveId || !positionName || !gapStartMs)
        return false;
    const outgoing = await (0, relevoOutgoingMatch_1.findPresentOutgoingAlignedToGapStart)(db, {
        objectiveId,
        positionName,
        gapStartMs,
        excludeShiftIds: [incomingShiftId],
        excludeEmployeeId: String(shiftData.employeeId || ''),
    });
    if (!outgoing)
        return false;
    const outEmpId = String(outgoing.data.employeeId || '').trim();
    const incomingName = String(shiftData.employeeName || 'Tu relevo').trim();
    const objectiveName = String(shiftData.objectiveName || '');
    const empresaId = shiftData.empresaId ? String(shiftData.empresaId) : null;
    await db.collection('turnos').doc(outgoing.id).set({
        lateReliefIncomingShiftId: incomingShiftId,
        lateReliefIncomingName: incomingName,
        lateReliefEtaAt: etaAt,
        retentionExpectedUntil: etaAt,
    }, { merge: true });
    if (outEmpId) {
        const dupSnap = await db
            .collection('user_notifications')
            .where('employeeId', '==', outEmpId)
            .where('type', '==', 'RETENCION_AVISO')
            .where('turnoId', '==', outgoing.id)
            .limit(1)
            .get();
        if (!dupSnap.empty)
            return true;
        await notifyRetencionAvisoRelevoTarde(db, {
            outEmpId,
            outDocId: outgoing.id,
            incomingName,
            objectiveName,
            etaAtMs: etaAt.toMillis(),
            empresaId,
        });
    }
    return true;
}
//# sourceMappingURL=relevoNotifications.js.map