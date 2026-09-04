"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarPresencia = registrarPresencia;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
function normPos(n) {
    return String(n ?? '')
        .trim()
        .toLowerCase();
}
function arrivalMs(dat) {
    return (dat.checkInTime?.toMillis?.() ??
        dat.realStartTime?.toMillis?.() ??
        dat.presentAt?.toMillis?.() ??
        dat.startTime?.toMillis?.() ??
        0);
}
function isCambioCandidate(dat, nowMs, incomingStartMs) {
    if (dat.isRetention === true) {
        const scheduledEnd = dat.endTime?.toMillis?.() ?? 0;
        return scheduledEnd >= incomingStartMs - 45 * 60 * 1000;
    }
    const outEndMs = dat.endTime?.toMillis?.() ?? 0;
    if (outEndMs <= 0)
        return false;
    return outEndMs - nowMs <= 15 * 60 * 1000;
}
async function resolvePositionCapacity(db, objectiveId, positionName, empresaId) {
    try {
        let q = db
            .collection('servicios_sla')
            .where('objectiveId', '==', objectiveId)
            .limit(15);
        if (empresaId) {
            q = db
                .collection('servicios_sla')
                .where('empresaId', '==', empresaId)
                .where('objectiveId', '==', objectiveId)
                .limit(15);
        }
        const snap = await q.get();
        const posNorm = normPos(positionName);
        for (const d of snap.docs) {
            const data = d.data();
            const status = String(data.status || data.estado || 'ACTIVE').toUpperCase();
            if (status === 'INACTIVE' || status === 'DELETED')
                continue;
            const positions = Array.isArray(data.positions) ? data.positions : [];
            const pos = positions.find((p) => normPos(p?.name) === posNorm);
            if (pos) {
                const qty = Number(pos.quantity);
                if (Number.isFinite(qty) && qty >= 1)
                    return Math.floor(qty);
            }
        }
    }
    catch (e) {
        console.warn('[registrarPresencia] capacity lookup:', e?.message);
    }
    return 1;
}
async function notifyRelieved(db, params) {
    const { outEmpId, outDocId, incomingName, objectiveName, empresaId } = params;
    try {
        const outEmpDoc = await db.collection('empleados').doc(outEmpId).get();
        const outEmpUid = outEmpDoc.exists ? outEmpDoc.data()?.uid : undefined;
        const notifTitle = 'Turno finalizado — relevado';
        const notifBody = `Fuiste relevado por ${incomingName} en ${objectiveName}. Tu turno ha finalizado.`;
        let notifDocId = null;
        try {
            const notifRef = await db.collection('user_notifications').add({
                uid: outEmpUid || null,
                employeeId: outEmpId,
                userId: outEmpId,
                title: notifTitle,
                body: notifBody,
                type: 'RELEVO_AUTOMATICO',
                target: 'employee',
                turnoId: outDocId,
                empresaId: empresaId || null,
                read: false,
                readAt: null,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            notifDocId = notifRef.id;
        }
        catch (e) {
            console.warn('[registrarPresencia] notif doc:', e?.message);
        }
        const [byEmpId, byUid] = await Promise.all([
            db.collection('device_tokens').where('employeeId', '==', outEmpId).get(),
            outEmpUid
                ? db.collection('device_tokens').where('uid', '==', outEmpUid).get()
                : Promise.resolve({ docs: [] }),
        ]);
        const tokenSet = new Set();
        [...byEmpId.docs, ...byUid.docs].forEach((d) => {
            const t = d.data()?.token;
            if (typeof t === 'string' && t.length > 10)
                tokenSet.add(t);
        });
        const tokens = Array.from(tokenSet);
        if (tokens.length === 0)
            return;
        const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
        await admin.messaging().sendEachForMulticast({
            data: {
                type: 'RELEVO_AUTOMATICO',
                title: notifTitle,
                body: notifBody,
                turnoId: outDocId,
                employeeId: outEmpId,
                notificationId: notifDocId || '',
                link,
            },
            webpush: {
                headers: { Urgency: 'high' },
                fcmOptions: { link },
            },
            tokens,
        });
    }
    catch (e) {
        console.warn('[registrarPresencia] notifyRelieved:', e?.message);
    }
}
async function registrarPresencia(db, input) {
    const { shiftId, source, coords, recordedAt, operatorUid, actorName, overrideRelieveShiftId, skipAutoRelevo, } = input;
    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists)
        throw new Error('TURNO_NOT_FOUND');
    const shiftData = shiftDoc.data();
    if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
        throw new Error('SHIFT_ABSENT');
    }
    if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
        return { success: true, alreadyPresent: true, relieved: null };
    }
    const empId = String(input.empId || shiftData.employeeId || '').trim();
    const nowTs = firestore_1.Timestamp.now();
    const nowMs = nowTs.toMillis();
    const now = firestore_1.FieldValue.serverTimestamp();
    const scheduledStartTs = shiftData.startTime ?? null;
    const isEarlyStart = shiftData.isEarlyStart === true;
    const realStartTime = isEarlyStart
        ? shiftData.adjustedStartTime || scheduledStartTs || now
        : scheduledStartTs || now;
    const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
    const isLate = scheduledStartMs > 0 && nowMs > scheduledStartMs + 5 * 60 * 1000;
    const incomingPatch = {
        isPresent: true,
        status: 'PRESENT',
        checkInTime: now,
        realStartTime,
        checkInMethod: source,
        checkInCoords: coords || null,
        checkInRecordedAt: recordedAt || null,
        isLate,
        isAbsent: false,
        absenceType: null,
        absenceDetectedAt: null,
        lateArrivalAt: isLate ? now : null,
        presenciaSource: source,
        presenciaAt: now,
    };
    if (operatorUid)
        incomingPatch.checkInOperator = operatorUid;
    if (source === 'VIGI' || source === 'DEMO') {
        incomingPatch.modifiedByAgent = true;
        incomingPatch.modifiedByAgentAt = nowTs;
    }
    if (isLate || shiftData.absenceType === 'AA') {
        incomingPatch.absenceReversedAt = now;
        incomingPatch.absenceReversedBy = source === 'OPERATIONS' ? 'OPERACIONES' : source;
    }
    await shiftRef.update(incomingPatch);
    void db
        .collection('novedades')
        .add({
        type: 'INGRESO_AUTOREGISTRO',
        shiftId,
        employeeId: empId,
        employeeName: shiftData.employeeName || '',
        objectiveId: shiftData.objectiveId || '',
        objectiveName: shiftData.objectiveName || '',
        clientName: shiftData.clientName || '',
        empresaId: shiftData.empresaId || null,
        coords: coords || null,
        source,
        description: `Ingreso (${source}): ${shiftData.employeeName || empId}`,
        createdAt: now,
        status: 'unread',
        viewed: false,
    })
        .catch((e) => console.warn('[registrarPresencia] novedad ingreso:', e?.message));
    let relieved = null;
    const wantSkip = skipAutoRelevo === true ||
        overrideRelieveShiftId === null;
    const wantOverride = typeof overrideRelieveShiftId === 'string' && overrideRelieveShiftId.trim().length > 0;
    if (!wantSkip) {
        try {
            const objectiveId = String(shiftData.objectiveId || '').trim();
            const positionName = String(shiftData.positionName || '').trim();
            const empresaId = shiftData.empresaId ? String(shiftData.empresaId) : null;
            const incomingName = shiftData.employeeName || 'Un guardia';
            const objectiveName = shiftData.objectiveName || '';
            const incomingStartMs = shiftData.startTime?.toMillis?.() ?? nowMs;
            if (objectiveId && positionName) {
                let outDoc = null;
                if (wantOverride) {
                    const ov = await db.collection('turnos').doc(overrideRelieveShiftId.trim()).get();
                    if (ov.exists) {
                        const od = ov.data();
                        if (od.isPresent &&
                            !od.isCompleted &&
                            String(od.objectiveId || '') === objectiveId &&
                            normPos(od.positionName) === normPos(positionName) &&
                            ov.id !== shiftId) {
                            outDoc = ov;
                        }
                    }
                }
                else {
                    let activeSnap;
                    if (empresaId) {
                        activeSnap = await db
                            .collection('turnos')
                            .where('empresaId', '==', empresaId)
                            .where('objectiveId', '==', objectiveId)
                            .where('isPresent', '==', true)
                            .where('isCompleted', '==', false)
                            .get();
                    }
                    else {
                        activeSnap = await db
                            .collection('turnos')
                            .where('objectiveId', '==', objectiveId)
                            .where('isPresent', '==', true)
                            .where('isCompleted', '==', false)
                            .get();
                    }
                    const samePost = activeSnap.docs.filter((d) => {
                        const dat = d.data();
                        if (normPos(dat.positionName) !== normPos(positionName))
                            return false;
                        if (d.id === shiftId)
                            return false;
                        if (empId && dat.employeeId === empId)
                            return false;
                        return true;
                    });
                    const fifo = (a, b) => {
                        const da = a.data();
                        const db2 = b.data();
                        if (da.isRetention && !db2.isRetention)
                            return -1;
                        if (!da.isRetention && db2.isRetention)
                            return 1;
                        return arrivalMs(da) - arrivalMs(db2);
                    };
                    const cambio = samePost
                        .filter((d) => isCambioCandidate(d.data(), nowMs, incomingStartMs))
                        .sort(fifo);
                    let pool = cambio;
                    if (pool.length === 0) {
                        const capacity = await resolvePositionCapacity(db, objectiveId, positionName, empresaId);
                        if (samePost.length >= capacity) {
                            pool = [...samePost].sort(fifo);
                        }
                    }
                    outDoc = pool[0] ?? null;
                }
                if (outDoc) {
                    const outData = outDoc.data();
                    const outEmpId = String(outData.employeeId || '');
                    const outName = outData.employeeName || 'Guardia';
                    const outPosName = outData.positionName || '';
                    const outScheduledEndMs = outData.endTime?.toMillis?.() ?? 0;
                    const isEarlyRelevo = outScheduledEndMs > 0 && nowMs < outScheduledEndMs;
                    const outgoingRealEnd = isEarlyRelevo ? outData.endTime : firestore_1.FieldValue.serverTimestamp();
                    await outDoc.ref.update({
                        isCompleted: true,
                        isPresent: false,
                        status: 'COMPLETED',
                        realEndTime: outgoingRealEnd,
                        relievedBy: empId || null,
                        relievedByName: incomingName,
                        relievedAt: firestore_1.FieldValue.serverTimestamp(),
                        autoRelevo: !wantOverride,
                        relievedEarly: isEarlyRelevo,
                        relievedSource: source,
                    });
                    relieved = {
                        shiftId: outDoc.id,
                        employeeId: outEmpId,
                        employeeName: outName,
                    };
                    void db
                        .collection('novedades')
                        .add({
                        type: 'RELEVO_AUTOMATICO',
                        status: 'ATENDIDA',
                        empresaId,
                        objectiveId,
                        objectiveName,
                        positionName: outPosName,
                        employeeId: empId,
                        employeeName: incomingName,
                        relievedEmployeeId: outEmpId,
                        relievedEmployeeName: outName,
                        description: `${incomingName} relevó a ${outName} en ${objectiveName}${outPosName ? ` — ${outPosName}` : ''} (${source})`,
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                        autoProcessed: !wantOverride,
                        source: wantOverride ? source : 'AUTO_RELEVO',
                    })
                        .catch(() => { });
                    if (outEmpId) {
                        void notifyRelieved(db, {
                            outEmpId,
                            outDocId: outDoc.id,
                            incomingName,
                            objectiveName,
                            empresaId,
                        });
                    }
                }
            }
        }
        catch (e) {
            console.warn('[registrarPresencia] auto-relevo:', e?.message);
        }
    }
    void db
        .collection('audit_logs')
        .add({
        action: isLate ? 'LLEGADA_TARDE' : 'PRESENTE',
        module: source === 'VIGI' ? 'ASISTENTE_IA' : source === 'OPERATIONS' ? 'OPERACIONES' : 'PORTAL',
        actorName: actorName || source,
        actorUid: operatorUid || null,
        timestamp: firestore_1.FieldValue.serverTimestamp(),
        employeeId: empId,
        employeeName: shiftData.employeeName || '',
        objectiveId: shiftData.objectiveId || '',
        objectiveName: shiftData.objectiveName || '',
        shiftId,
        empresaId: shiftData.empresaId || null,
        details: relieved
            ? `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}). Relevó a ${relieved.employeeName}.`
            : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}).`,
    })
        .catch(() => { });
    if (shiftData.absenceType === 'AA') {
        void (async () => {
            try {
                const absSnap = await db
                    .collection('ausencias')
                    .where('shiftId', '==', shiftId)
                    .limit(5)
                    .get();
                const aaDoc = absSnap.docs.find((d) => d.data().absenceType === 'AA');
                if (!aaDoc)
                    return;
                await aaDoc.ref.update({
                    type: 'Llegada Tarde',
                    absenceType: 'LT',
                    status: 'Confirmada',
                    reason: `Llegada tarde — ${shiftData.objectiveName || ''} (${shiftData.positionName || ''})`,
                    arrivedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            catch {
            }
        })();
    }
    return { success: true, relieved };
}
//# sourceMappingURL=registrarPresencia.js.map