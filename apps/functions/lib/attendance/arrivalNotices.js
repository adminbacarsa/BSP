"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runShiftArrivalNotices = runShiftArrivalNotices;
const firestore_1 = require("firebase-admin/firestore");
const simulableShift_1 = require("../common/simulableShift");
const reliefEligibility_1 = require("../common/reliefEligibility");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const convocatoriasCobertura_1 = require("../coverage/convocatoriasCobertura");
const pushGreeting_1 = require("../common/pushGreeting");
const arrivalNoticeWindow_1 = require("./arrivalNoticeWindow");
const SKIP_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'A', 'E', 'AA', 'ART', 'PG', 'SGS', 'SUS']);
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const TZ = 'America/Argentina/Buenos_Aires';
function horaAr(ms) {
    return new Date(ms).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: TZ,
    });
}
function eligibleShift(shift) {
    if (shift.draft === true || shift.isPresent === true || shift.isCompleted === true || shift.isAbsent === true) {
        return false;
    }
    if ((0, coverageTraceShift_1.skipAbsencePipelineForShift)(shift))
        return false;
    if (shift.isFranco === true)
        return false;
    if (shift.isUnassigned === true)
        return false;
    const emp = String(shift.employeeId || '').trim();
    if (!emp || emp === 'VACANTE')
        return false;
    if (SKIP_CODES.has(String(shift.code || '').toUpperCase()))
        return false;
    if (SKIP_STATUSES.has(String(shift.status || '').toUpperCase()))
        return false;
    if (shift.lateArrivalAt || shift.lateArrivalConfirmed)
        return false;
    return true;
}
async function claimFlag(db, ref, field, now) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            return false;
        const data = snap.data() || {};
        if (data[field])
            return false;
        if (data.isPresent === true || data.isAbsent === true || data.isCompleted === true)
            return false;
        tx.update(ref, { [field]: now });
        return true;
    });
}
async function releaseFlag(ref, field) {
    await ref.update({ [field]: firestore_1.FieldValue.delete() }).catch(() => { });
}
async function writeHeadsUp(db, shiftId, shift, startMs) {
    const lugar = (0, arrivalNoticeWindow_1.lugarAviso)(shift);
    const hora = horaAr(startMs);
    const empSnap = await db.collection('empleados').doc(String(shift.employeeId)).get();
    const emp = empSnap.exists ? empSnap.data() || {} : {};
    const uid = String(emp.uid || '');
    const name = (0, pushGreeting_1.guardFirstName)({ firstName: emp.firstName, employeeName: shift.employeeName || emp.nombre });
    await db.collection('user_notifications').add({
        uid: uid || null,
        employeeId: shift.employeeId,
        type: 'AVISO_TURNO_PROXIMO',
        title: '¿Ya estás llegando?',
        body: (0, arrivalNoticeWindow_1.headsUpBody)(hora, lugar, name),
        empresaId: shift.empresaId || null,
        shiftId,
        objectiveId: shift.objectiveId || null,
        objectiveName: shift.objectiveName || null,
        positionName: shift.positionName || null,
        clientName: shift.clientName || null,
        shiftCode: shift.code || null,
        startTime: shift.startTime || null,
        read: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function alertOutgoing(db, incoming) {
    if ((0, reliefEligibility_1.isExtraNonReliefShift)(incoming))
        return;
    const empresaId = String(incoming.empresaId || '').trim();
    const objectiveId = String(incoming.objectiveId || '').trim();
    const posName = String(incoming.positionName || '').trim().toLowerCase();
    if (!empresaId || !objectiveId || !posName)
        return;
    const presentSnap = await db.collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('objectiveId', '==', objectiveId)
        .where('isPresent', '==', true)
        .get();
    const lugar = (0, arrivalNoticeWindow_1.lugarAviso)(incoming) || String(incoming.objectiveName || 'el puesto');
    for (const retDoc of presentSnap.docs) {
        const dat = retDoc.data();
        if (dat.isCompleted === true)
            continue;
        if ((0, reliefEligibility_1.isExtraNonReliefShift)(dat))
            continue;
        if (String(dat.positionName || '').trim().toLowerCase() !== posName)
            continue;
        if (dat.employeeId === incoming.employeeId)
            continue;
        if (dat.incomingLateAlertShiftId === incoming.id)
            continue;
        const empSnap = await db.collection('empleados').doc(String(dat.employeeId || '')).get();
        const emp = empSnap.exists ? empSnap.data() || {} : {};
        const uid = String(emp.uid || '');
        const name = (0, pushGreeting_1.guardFirstName)({ firstName: emp.firstName, employeeName: dat.employeeName || emp.nombre });
        const who = name ? `${name}, ` : '';
        await db.collection('user_notifications').add({
            uid: uid || null,
            employeeId: dat.employeeId || null,
            type: 'AVISO_ENTRANTE_SIN_FICHAR',
            title: 'Tu relevo todavía no llegó',
            body: `${who}el que entra todavía no fichó en ${lugar}. No te retires hasta que Operaciones te avise.`,
            empresaId,
            shiftId: retDoc.id,
            relatedShiftId: incoming.id || null,
            objectiveId,
            objectiveName: incoming.objectiveName || null,
            positionName: incoming.positionName || null,
            read: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await retDoc.ref.update({ incomingLateAlertShiftId: incoming.id || true }).catch(() => { });
    }
}
async function runShiftArrivalNotices(db, now, cc) {
    if (!cc.anyEnabled)
        return 0;
    const nowMs = now.toMillis();
    const cache = new simulableShift_1.ObjectiveOperationCache();
    let sent = 0;
    const headsUpSnap = await db.collection('turnos')
        .where('startTime', '>', firestore_1.Timestamp.fromMillis(nowMs))
        .where('startTime', '<=', firestore_1.Timestamp.fromMillis(nowMs + arrivalNoticeWindow_1.HEADS_UP_BEFORE_MS))
        .get();
    const venisSnap = await db.collection('turnos')
        .where('startTime', '>=', firestore_1.Timestamp.fromMillis(nowMs - arrivalNoticeWindow_1.VENIS_GRACE_MS))
        .where('startTime', '<=', now)
        .get();
    const pass = async (docs, kind) => {
        for (const docSnap of docs) {
            const shift = docSnap.data();
            const empresaId = String(shift.empresaId || '').trim();
            if (!cc.isEnabled(empresaId))
                continue;
            if (cc.isDemo(empresaId))
                continue;
            if (!eligibleShift(shift))
                continue;
            const startMs = shift.startTime?.toMillis?.() ?? 0;
            if ((0, arrivalNoticeWindow_1.classifyArrivalNotice)(startMs, nowMs) !== kind)
                continue;
            const flag = kind === 'HEADS_UP' ? 'preStartArrivalNoticeAt' : 'earlyRetentionAlertAt';
            if (shift[flag])
                continue;
            if (!(await cache.isShiftInOperation(db, shift)))
                continue;
            const claimed = await claimFlag(db, docSnap.ref, flag, now);
            if (!claimed)
                continue;
            try {
                if (kind === 'HEADS_UP') {
                    await writeHeadsUp(db, docSnap.id, shift, startMs);
                }
                else {
                    const empSnap = await db.collection('empleados').doc(String(shift.employeeId)).get();
                    const empUid = empSnap.exists ? String(empSnap.data()?.uid || '') : '';
                    await (0, convocatoriasCobertura_1.crearConvocatoriaLlegadaTarde)(db, {
                        id: docSnap.id,
                        empresaId,
                        objectiveId: String(shift.objectiveId || ''),
                        objectiveName: String(shift.objectiveName || ''),
                        positionName: String(shift.positionName || ''),
                        clientId: String(shift.clientId || ''),
                        clientName: String(shift.clientName || ''),
                        shiftCode: String(shift.code || '').toUpperCase(),
                        startTime: shift.startTime,
                        endTime: shift.endTime,
                        employeeId: String(shift.employeeId),
                        employeeName: String(shift.employeeName || ''),
                        employeeUid: empUid || undefined,
                    });
                    await alertOutgoing(db, { ...shift, id: docSnap.id });
                }
                sent++;
            }
            catch (e) {
                console.warn(`[runShiftArrivalNotices] ${kind} ${docSnap.id}:`, e?.message);
                await releaseFlag(docSnap.ref, flag);
            }
        }
    };
    await pass(headsUpSnap.docs, 'HEADS_UP');
    await pass(venisSnap.docs, 'VENIS');
    return sent;
}
//# sourceMappingURL=arrivalNotices.js.map