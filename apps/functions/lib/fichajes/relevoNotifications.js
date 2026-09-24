"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatHmArgentina = formatHmArgentina;
exports.notifyTurnoFinalizadoRelevo = notifyTurnoFinalizadoRelevo;
exports.notifyRetencionAvisoRelevoTarde = notifyRetencionAvisoRelevoTarde;
exports.applyLateReliefNoticeToOutgoing = applyLateReliefNoticeToOutgoing;
const firestore_1 = require("firebase-admin/firestore");
const relevoOutgoingMatch_1 = require("./relevoOutgoingMatch");
function formatHmArgentina(ms) {
    return new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date(ms));
}
async function employeeUid(db, employeeId) {
    if (!employeeId)
        return undefined;
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    return empDoc.exists ? empDoc.data()?.uid : undefined;
}
async function notifyTurnoFinalizadoRelevo(db, params) {
    const { outEmpId, outDocId, incomingName, objectiveName, empresaId } = params;
    const title = 'Turno finalizado';
    const body = `Turno finalizado — tu relevo ${incomingName} ya está en el puesto${objectiveName ? ` (${objectiveName})` : ''}.`;
    try {
        const outEmpUid = await employeeUid(db, outEmpId);
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
    const title = 'Retención — relevo en camino';
    const body = `Tu relevo ${incomingName} llega aprox. a las ${etaLabel}. Quedás retenido en ${objLabel} hasta que llegue.`;
    try {
        const outEmpUid = await employeeUid(db, outEmpId);
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