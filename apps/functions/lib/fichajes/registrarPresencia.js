"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarPresencia = registrarPresencia;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const checkInWindow_1 = require("./checkInWindow");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const cancelLlegadaTardeConvocatorias_1 = require("../attendance/cancelLlegadaTardeConvocatorias");
const relevoNotifications_1 = require("./relevoNotifications");
const relevoOutgoingMatch_1 = require("./relevoOutgoingMatch");
function normPos(n) {
    return String(n ?? '')
        .trim()
        .toLowerCase();
}
/** Llegada real al puesto: check-in GPS/ops antes que horario planificado. */
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
    if (nowMs >= outEndMs)
        return false;
    const handoffAligned = incomingStartMs > 0 && Math.abs(outEndMs - incomingStartMs) <= 30 * 60 * 1000;
    if (handoffAligned)
        return true;
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
/**
 * Motor único de presencia + auto-relevo FIFO 1:1.
 * Usado por portal, Operaciones, VIGI y (futuro) demo.
 */
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
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shiftData)) {
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
    const isLate = (windowEval.lateMinutes ?? 0) > 0
        || (scheduledStartMs > 0 && nowMs > scheduledStartMs + 5 * 60 * 1000);
    let realStartTime;
    if (source === 'OPERATIONS' || source === 'VIGI' || source === 'DEMO' || source === 'MANUAL_RADIO' || source === 'MANUAL_PHONE') {
        realStartTime = nowTs;
    }
    else if (windowEval.useAdjustedStart && shiftData.adjustedStartTime) {
        realStartTime =
            windowEval.usePlannedStart
                ? shiftData.adjustedStartTime
                : firestore_1.Timestamp.fromMillis(nowMs);
    }
    else if (windowEval.usePlannedStart && scheduledStartTs) {
        realStartTime = scheduledStartTs;
    }
    else {
        realStartTime = firestore_1.Timestamp.fromMillis(nowMs);
    }
    const incomingPatch = {
        isPresent: true,
        status: 'PRESENT',
        checkInTime: now,
        realStartTime,
        checkInMethod: source,
        checkInCoords: coords || null,
        checkInRecordedAt: recordedAt || null,
        isLate,
        lateMinutes: windowEval.lateMinutes ?? (isLate && scheduledStartMs ? Math.round((nowMs - scheduledStartMs) / 60000) : 0),
        isAbsent: false,
        absenceType: null,
        absenceDetectedAt: null,
        lateArrivalAt: isLate && !shiftData.lateArrivalAt ? now : shiftData.lateArrivalAt ?? null,
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
    await (0, cancelLlegadaTardeConvocatorias_1.cancelLlegadaTardeConvocatorias)(db, shiftId, 'CHECKED_IN').catch((e) => console.warn('[registrarPresencia] cancelar ¿Venís?:', e.message));
    // Notificación de confirmación al guardia (no bloqueante)
    void (async () => {
        try {
            const isPortal = source === 'PORTAL_GPS';
            const title = isPortal ? 'Presente registrado' : 'Operador registró tu ingreso';
            const body = isPortal
                ? `Tu ingreso en ${shiftData.objectiveName || 'el puesto'} fue confirmado.`
                : `${actorName || 'El operador'} registró tu ingreso en ${shiftData.objectiveName || 'el puesto'}.`;
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
            // FCM push (solo si la app no está abierta)
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
    // Novedad ingreso (no bloqueante)
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
                        // Tras marcar entrante, los presentes previos: si ya estaban al tope, liberar 1.
                        if (samePost.length >= capacity) {
                            pool = [...samePost].sort(fifo);
                        }
                    }
                    outDoc = pool[0] ?? null;
                    if (!outDoc && !wantOverride && incomingStartMs > 0) {
                        const pick = await (0, relevoOutgoingMatch_1.findPresentOutgoingAlignedToGapStart)(db, {
                            objectiveId,
                            positionName,
                            gapStartMs: incomingStartMs,
                            excludeShiftIds: [shiftId],
                            excludeEmployeeId: empId || undefined,
                        });
                        if (pick) {
                            const pickSnap = await db.collection('turnos').doc(pick.id).get();
                            if (pickSnap.exists)
                                outDoc = pickSnap;
                        }
                    }
                }
                if (outDoc) {
                    const outData = outDoc.data();
                    const outEmpId = String(outData.employeeId || '');
                    const outName = outData.employeeName || 'Guardia';
                    const outPosName = outData.positionName || '';
                    const outScheduledEndMs = outData.endTime?.toMillis?.() ?? 0;
                    const isEarlyRelevo = outScheduledEndMs > 0 && nowMs < outScheduledEndMs;
                    if (isEarlyRelevo) {
                        await outDoc.ref.update({
                            relievedBy: empId || null,
                            relievedByName: incomingName,
                            relievedAt: firestore_1.FieldValue.serverTimestamp(),
                            relieveScheduledAt: outData.endTime ?? null,
                            autoRelevo: !wantOverride,
                            relievedEarly: true,
                            relievedSource: source,
                        });
                    }
                    else {
                        await outDoc.ref.update({
                            isCompleted: true,
                            isPresent: false,
                            status: 'COMPLETED',
                            realEndTime: firestore_1.Timestamp.fromMillis(nowMs),
                            relievedBy: empId || null,
                            relievedByName: incomingName,
                            relievedAt: firestore_1.FieldValue.serverTimestamp(),
                            relieveScheduledAt: outData.endTime ?? null,
                            autoRelevo: !wantOverride,
                            relievedEarly: false,
                            relievedSource: source,
                            completionReason: 'RELEVO_PRESENTE',
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
                    };
                    void db
                        .collection('novedades')
                        .add({
                        type: isEarlyRelevo ? 'RELEVO_PROGRAMADO' : 'RELEVO_AUTOMATICO',
                        status: 'ATENDIDA',
                        empresaId,
                        objectiveId,
                        objectiveName,
                        positionName: outPosName,
                        employeeId: empId,
                        employeeName: incomingName,
                        relievedEmployeeId: outEmpId,
                        relievedEmployeeName: outName,
                        description: isEarlyRelevo
                            ? `${incomingName} fichó antes del fin de ${outName}; retiro programado a hora de fin (${source})`
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
    // Bitácora (background)
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
    // Llegada tarde (sin AA previa) → crear registro LT en ausencias para RRHH
    if (isLate && !shiftData.absenceType) {
        void (async () => {
            try {
                const startMs2 = scheduledStartTs?.toMillis?.() ?? 0;
                const arDate = new Date(startMs2 - 3 * 60 * 60 * 1000); // UTC-3
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
                /* ignore */
            }
        })();
    }
    // AA → LT en background
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
                /* ignore */
            }
        })();
    }
    return { success: true, relieved };
}
