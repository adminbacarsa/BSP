"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarPresencia = registrarPresencia;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const pushGreeting_1 = require("../common/pushGreeting");
const lateAbsenceWindow_1 = require("../attendance/lateAbsenceWindow");
const revertirAusencia_1 = require("../attendance/revertirAusencia");
const checkInWindow_1 = require("./checkInWindow");
const checkInPay_1 = require("./checkInPay");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const cancelLlegadaTardeConvocatorias_1 = require("../attendance/cancelLlegadaTardeConvocatorias");
const relevoNotifications_1 = require("./relevoNotifications");
const relevoOutgoingMatch_1 = require("./relevoOutgoingMatch");
const reliefEligibility_1 = require("../common/reliefEligibility");
const shiftClose_1 = require("../scheduling/shiftClose");
function normPos(n) {
    return String(n ?? '')
        .trim()
        .toLowerCase();
}
function formatHmAr(ms) {
    return new Date(ms).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'America/Argentina/Buenos_Aires',
    });
}
async function registrarPresencia(db, input) {
    const { shiftId, source, coords, recordedAt, operatorUid, actorName, overrideRelieveShiftId, skipAutoRelevo, } = input;
    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists)
        throw new Error('TURNO_NOT_FOUND');
    const shiftData = shiftDoc.data();
    if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
        if (!(0, lateAbsenceWindow_1.isReversibleLateAbsence)(shiftData, Date.now())) {
            throw new Error('SHIFT_ABSENT');
        }
        const rev = await (0, revertirAusencia_1.revertirAusenciaShift)(db, {
            shiftId,
            operatorUid: operatorUid || 'FICHADA',
        });
        if (!rev.success)
            throw new Error('SHIFT_ABSENT');
        return { success: true, alreadyPresent: false, relieved: null };
    }
    const covTypeGate = String(shiftData.coverageType || '').toUpperCase();
    const originGate = String(shiftData.origin || '').toUpperCase();
    if (originGate === 'OPERATIONS_COVERAGE' && covTypeGate === 'EXTEND') {
        throw new Error('EXT_NO_CHECKIN');
    }
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shiftData) && covTypeGate !== 'ADVANCE') {
        throw new Error('TRACE_REGISTRATION_SHIFT');
    }
    if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
        return { success: true, alreadyPresent: true, relieved: null };
    }
    const empId = String(input.empId || shiftData.employeeId || '').trim();
    const nowTs = firestore_1.Timestamp.now();
    const recordedMs = recordedAt ? new Date(recordedAt).getTime() : nowTs.toMillis();
    const nowMs = recordedMs;
    const now = firestore_1.FieldValue.serverTimestamp();
    const windowEval = (0, checkInWindow_1.evaluateServerCheckInWindow)(shiftData, nowMs, {
        source,
    });
    if (!windowEval.allowed) {
        throw new Error(windowEval.rejectCode || 'CHECKIN_WINDOW');
    }
    const scheduledStartTs = shiftData.startTime ?? null;
    const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
    const originUp = String(shiftData.origin || '').toUpperCase();
    const covTypeUp = String(shiftData.coverageType || '').toUpperCase();
    const convocadoPunch = originUp === 'OPERATIONS_COVERAGE' && covTypeUp !== 'EXTEND';
    const adjustedStartMs = shiftData.adjustedStartTime?.toMillis?.() ?? 0;
    const payAnchorMs = windowEval.useAdjustedStart && adjustedStartMs > 0
        ? adjustedStartMs
        : scheduledStartMs;
    const pay = (0, checkInPay_1.resolveCheckInPayClock)({
        nowMs,
        plannedStartMs: payAnchorMs,
        windowLateMinutes: windowEval.lateMinutes ?? 0,
    });
    let isLate = convocadoPunch ? false : pay.isLate;
    let lateMinutes = convocadoPunch ? 0 : pay.lateMinutes;
    let realStartTime;
    if (convocadoPunch) {
        realStartTime = firestore_1.Timestamp.fromMillis(nowMs);
    }
    else if (!pay.isLate && windowEval.useAdjustedStart && shiftData.adjustedStartTime) {
        realStartTime = shiftData.adjustedStartTime;
    }
    else if (!pay.isLate && scheduledStartTs) {
        realStartTime = scheduledStartTs;
    }
    else {
        realStartTime = firestore_1.Timestamp.fromMillis(pay.realStartMs);
    }
    const incomingPatch = {
        isPresent: true,
        status: 'PRESENT',
        checkInTime: now,
        checkInAt: firestore_1.Timestamp.fromMillis(pay.checkInAtMs),
        realStartTime,
        checkInMethod: source,
        checkInCoords: coords || null,
        checkInRecordedAt: recordedAt || null,
        isLate,
        lateMinutes,
        isAbsent: false,
        absenceType: null,
        absenceDetectedAt: null,
        lateArrivalAt: shiftData.lateArrivalAt ?? null,
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
    if (convocadoPunch) {
        const convId = String(shiftData.coverageConvocatoriaId || shiftData.assignedByConvocatoria || '').trim();
        if (convId) {
            const { logConvocatoriaEvento } = await Promise.resolve().then(() => require('../coverage/convocatoriaEventos'));
            const { convocadoFollowUpClosePatch } = await Promise.resolve().then(() => require('../attendance/convocadoFollowUp'));
            const punchTs = firestore_1.Timestamp.fromMillis(nowMs);
            await db.collection('convocatorias_cobertura').doc(convId)
                .update({ ...convocadoFollowUpClosePatch('FICHO', punchTs), checkedInAt: punchTs })
                .catch(() => undefined);
            await logConvocatoriaEvento(db, convId, { type: 'FICHO', at: punchTs }).catch(() => undefined);
        }
        if (covTypeUp === 'ADVANCE') {
            const titularId = String(shiftData.absenceShiftId || shiftData.coveredShiftId || '').trim();
            if (titularId) {
                const extConvs = await db.collection('convocatorias_cobertura')
                    .where('shiftId', '==', titularId)
                    .limit(8)
                    .get();
                for (const c of extConvs.docs) {
                    if (String(c.data().type || '') !== 'EXTEND')
                        continue;
                    const extId = String(c.data().extendShiftId || '').trim();
                    if (!extId)
                        continue;
                    const ext = await db.collection('turnos').doc(extId).get();
                    const ed = ext.data();
                    if (!ed || ed.isCompleted === true || ed.isExtended !== true)
                        continue;
                    await ext.ref.update({
                        isExtended: false,
                        isCompleted: true,
                        isPresent: false,
                        isRetention: false,
                        status: 'COMPLETED',
                        completionReason: 'RELEVO_ADVANCE',
                        realEndTime: firestore_1.Timestamp.fromMillis(nowMs),
                    });
                }
            }
        }
    }
    await (0, cancelLlegadaTardeConvocatorias_1.cancelLlegadaTardeConvocatorias)(db, shiftId, 'CHECKED_IN').catch((e) => console.warn('[registrarPresencia] cancelar ¿Venís?:', e.message));
    void (async () => {
        try {
            const isPortal = source === 'PORTAL_GPS';
            const inName = (0, pushGreeting_1.guardFirstName)({ employeeName: shiftData.employeeName });
            const whereIn = shiftData.objectiveName || 'el puesto';
            const title = isPortal ? 'Ingreso registrado' : 'Operaciones registró tu ingreso';
            const body = isPortal
                ? (inName ? `Listo, ${inName}. Quedó tu ingreso en ${whereIn}.` : `Quedó tu ingreso en ${whereIn}.`)
                : (inName
                    ? `${inName}, ${actorName || 'Operaciones'} registró tu ingreso en ${whereIn}.`
                    : `${actorName || 'Operaciones'} registró tu ingreso en ${whereIn}.`);
            const notifType = 'CHECKIN_CONFIRMADO';
            const notifRef = await db.collection('user_notifications').add({
                type: notifType,
                title,
                body,
                employeeId: empId || null,
                userId: empId || null,
                shiftId,
                objectiveId: shiftData.objectiveId || null,
                objectiveName: shiftData.objectiveName || null,
                empresaId: shiftData.empresaId || null,
                read: false,
                readAt: null,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            const [byEmp, byUid] = await Promise.all([
                empId ? db.collection('device_tokens').where('employeeId', '==', empId).get() : Promise.resolve({ docs: [] }),
                (async () => {
                    if (!empId)
                        return { docs: [] };
                    const empDoc = await db.collection('empleados').doc(empId).get();
                    const uid = empDoc.data()?.uid;
                    if (!uid)
                        return { docs: [] };
                    return db.collection('device_tokens').where('uid', '==', uid).get();
                })(),
            ]);
            const tokenSet = new Set();
            [...byEmp.docs, ...byUid.docs].forEach((d) => {
                const t = d.data()?.token;
                if (typeof t === 'string' && t.length > 10)
                    tokenSet.add(t);
            });
            const tokens = Array.from(tokenSet);
            if (tokens.length > 0) {
                const link = `/app/?notif=${encodeURIComponent(notifRef.id)}`;
                await admin.messaging().sendEachForMulticast({
                    data: { type: notifType, title, body, shiftId, notificationId: notifRef.id, link },
                    webpush: { headers: { Urgency: 'normal' }, fcmOptions: { link } },
                    tokens,
                });
            }
        }
        catch (e) {
            console.warn('[registrarPresencia] notifyPresenceConfirmed:', e?.message);
        }
    })();
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
    let relievedScheduleMs = 0;
    const wantSkip = skipAutoRelevo === true ||
        overrideRelieveShiftId === null ||
        !(0, reliefEligibility_1.isReliefEligibleShift)(shiftData);
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
                            (0, reliefEligibility_1.isReliefEligibleShift)(od) &&
                            String(od.objectiveId || '') === objectiveId &&
                            normPos(od.positionName) === normPos(positionName) &&
                            ov.id !== shiftId) {
                            outDoc = ov;
                        }
                    }
                }
                else if (incomingStartMs > 0) {
                    const pick = await (0, relevoOutgoingMatch_1.findPresentOutgoingAlignedToGapStart)(db, {
                        objectiveId,
                        positionName,
                        gapStartMs: incomingStartMs,
                        excludeShiftIds: [shiftId],
                        excludeEmployeeId: empId || undefined,
                        incoming: shiftData,
                    });
                    if (pick) {
                        const pickSnap = await db.collection('turnos').doc(pick.id).get();
                        if (pickSnap.exists)
                            outDoc = pickSnap;
                    }
                }
                if (outDoc) {
                    const outData = outDoc.data();
                    const outEmpId = String(outData.employeeId || '');
                    const outName = outData.employeeName || 'Guardia';
                    const outPosName = outData.positionName || '';
                    const outEndMs = outData.endTime?.toMillis?.() ?? 0;
                    const handoffMs = Math.max(incomingStartMs, outEndMs || incomingStartMs);
                    const scheduleHandoff = !wantOverride && nowMs < handoffMs;
                    await shiftRef.update({ relievedOutgoingShiftId: outDoc.id }).catch(() => undefined);
                    if (scheduleHandoff) {
                        relievedScheduleMs = handoffMs;
                        await outDoc.ref.update({
                            relievedBy: empId || null,
                            relievedByName: incomingName,
                            relievedAt: firestore_1.FieldValue.serverTimestamp(),
                            relieveScheduledAt: firestore_1.Timestamp.fromMillis(handoffMs),
                            autoRelevo: true,
                            relievedEarly: true,
                            relievedSource: source,
                        });
                    }
                    else {
                        const realEndMs = wantOverride ? nowMs : Math.max(handoffMs, nowMs);
                        const outClose = (0, shiftClose_1.buildAutoClosePatch)(outData, {
                            realEndMs,
                            reason: 'RELEVO_PRESENTE',
                            now: firestore_1.Timestamp.fromMillis(nowMs),
                            by: 'RELEVO',
                        });
                        await outDoc.ref.update({
                            ...outClose,
                            ...(outData.isRetention === true ? { isRetention: false } : {}),
                            relievedBy: empId || null,
                            relievedByName: incomingName,
                            relievedAt: firestore_1.FieldValue.serverTimestamp(),
                            relieveScheduledAt: firestore_1.Timestamp.fromMillis(handoffMs),
                            autoRelevo: !wantOverride,
                            relievedEarly: false,
                            relievedSource: source,
                        });
                        if (outEmpId) {
                            void (0, relevoNotifications_1.notifyTurnoFinalizadoRelevo)(db, {
                                outEmpId,
                                outDocId: outDoc.id,
                                incomingName,
                                objectiveName,
                                empresaId,
                            });
                        }
                    }
                    relieved = {
                        shiftId: outDoc.id,
                        employeeId: outEmpId,
                        employeeName: outName,
                        scheduled: scheduleHandoff,
                    };
                    const when = formatHmAr(handoffMs);
                    void db
                        .collection('novedades')
                        .add({
                        type: scheduleHandoff ? 'RELEVO_PROGRAMADO' : 'RELEVO_AUTOMATICO',
                        status: 'ATENDIDA',
                        empresaId,
                        objectiveId,
                        objectiveName,
                        positionName: outPosName,
                        employeeId: empId,
                        employeeName: incomingName,
                        relievedEmployeeId: outEmpId,
                        relievedEmployeeName: outName,
                        description: scheduleHandoff
                            ? `Relevo de ${outName} programado a las ${when} (${source})`
                            : `${incomingName} relevó a ${outName} en ${objectiveName}${outPosName ? ` — ${outPosName}` : ''} (${source})`,
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                        autoProcessed: !wantOverride,
                        source: wantOverride ? source : 'AUTO_RELEVO',
                    })
                        .catch(() => { });
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
            ? relievedScheduleMs > 0
                ? `${shiftData.employeeName || empId} ingresó (${source}). Relevo de ${relieved.employeeName} programado a las ${formatHmAr(relievedScheduleMs)}.`
                : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}). Relevó a ${relieved.employeeName}.`
            : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}).`,
    })
        .catch(() => { });
    if (isLate && !shiftData.absenceType) {
        void (async () => {
            try {
                const startMs2 = scheduledStartTs?.toMillis?.() ?? 0;
                const arDate = new Date(startMs2 - 3 * 60 * 60 * 1000);
                const dateStr = `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
                const existing = await db.collection('ausencias').where('shiftId', '==', shiftId).limit(1).get();
                if (existing.empty) {
                    await db.collection('ausencias').add({
                        employeeId: empId || null,
                        employeeName: shiftData.employeeName || '',
                        startDate: dateStr,
                        endDate: dateStr,
                        type: 'Llegada Tarde',
                        absenceType: 'LT',
                        origin: 'LATE_ARRIVAL',
                        shiftId,
                        objectiveId: shiftData.objectiveId || null,
                        objectiveName: shiftData.objectiveName || null,
                        positionName: shiftData.positionName || null,
                        reason: `Llegada tarde — ${shiftData.objectiveName || ''} (${shiftData.positionName || ''})`,
                        arrivedAt: firestore_1.FieldValue.serverTimestamp(),
                        status: 'Confirmada',
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                        empresaId: shiftData.empresaId || null,
                        reportedBy: source,
                    });
                }
            }
            catch {
            }
        })();
    }
    if (windowEval.lateNoNotice === true) {
        const mins = windowEval.lateMinutes ?? 0;
        try {
            const existingNov = await db.collection('novedades').where('shiftId', '==', shiftId).limit(25).get();
            const already = existingNov.docs.some((d) => d.data()?.type === 'LLEGADA_TARDE');
            if (!already) {
                await db.collection('novedades').add({
                    type: 'LLEGADA_TARDE',
                    title: 'Llegada Tarde',
                    shiftId,
                    employeeId: empId,
                    employeeName: shiftData.employeeName || '',
                    objectiveId: shiftData.objectiveId || '',
                    objectiveName: shiftData.objectiveName || '',
                    clientName: shiftData.clientName || '',
                    positionName: shiftData.positionName || null,
                    empresaId: shiftData.empresaId || null,
                    lateMinutes: mins,
                    description: `${shiftData.employeeName || 'El guardia'} llegó ${mins} min tarde — ${shiftData.objectiveName || ''}`.trim(),
                    createdAt: now,
                    status: 'unread',
                    viewed: false,
                    source,
                });
            }
        }
        catch (e) {
            console.warn('[registrarPresencia] novedad LLEGADA_TARDE:', e?.message);
        }
    }
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