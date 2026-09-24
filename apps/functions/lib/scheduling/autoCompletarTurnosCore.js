"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPositionHasContinuity = void 0;
exports.isValidReliefForOutgoing = isValidReliefForOutgoing;
exports.isReliefPresent = isReliefPresent;
exports.runAutoCompletarTurnosPass = runAutoCompletarTurnosPass;
const firestore_1 = require("firebase-admin/firestore");
const positionHasContinuity_1 = require("../coverage/positionHasContinuity");
Object.defineProperty(exports, "loadPositionHasContinuity", { enumerable: true, get: function () { return positionHasContinuity_1.loadPositionHasContinuity; } });
const coverageRetention_1 = require("../coverage/coverageRetention");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const RELEVO_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;
const RELEVO_ALIGN_MS = 30 * 60 * 1000;
function shiftEndMs(data) {
    return data.endTime?.toMillis?.() ?? 0;
}
function shiftStartMs(data) {
    return data.startTime?.toMillis?.() ?? 0;
}
function checkInMs(data) {
    const real = data.realStartTime?.toMillis?.();
    if (real)
        return real;
    const ci = data.checkInTime?.toMillis?.();
    if (ci)
        return ci;
    const pres = data.presenciaAt?.toMillis?.();
    if (pres)
        return pres;
    return shiftStartMs(data);
}
function isValidReliefForOutgoing(incoming, outgoingEndMs) {
    const st = shiftStartMs(incoming);
    if (!st)
        return false;
    if (st < outgoingEndMs - RELEVO_ALIGN_MS)
        return false;
    if (st > outgoingEndMs + RELEVO_WINDOW_AFTER_MS)
        return false;
    return true;
}
function isReliefPresent(incoming) {
    if (incoming.isCompleted === true)
        return false;
    const st = String(incoming.status || '').toUpperCase();
    return st === 'PRESENT' && incoming.isPresent !== false;
}
function isReliefPending(incoming) {
    if (!incoming.employeeId || incoming.employeeId === 'VACANTE')
        return false;
    if (incoming.isUnassigned === true)
        return false;
    const st = String(incoming.status || '').toUpperCase();
    return st === 'PENDING' || st === 'PLAN' || st === '' || !st;
}
function isReliefAbsent(incoming) {
    return incoming.isAbsent === true || String(incoming.status || '').toUpperCase() === 'ABSENT';
}
function shiftEndDate(data) {
    const ms = shiftEndMs(data);
    return ms ? new Date(ms) : null;
}
async function runAutoCompletarTurnosPass(db, ctx, now = firestore_1.Timestamp.now()) {
    const nowMs = now.toMillis();
    const cutoff = firestore_1.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);
    const snap = await db
        .collection('turnos')
        .where('status', '==', 'PRESENT')
        .where('endTime', '<=', cutoff)
        .get();
    if (snap.empty)
        return { completed: 0, alertedNoRelief: 0 };
    const completeBatch = db.batch();
    let completed = 0;
    let alertedNoRelief = 0;
    const slaCache = new Map();
    const reliefIncomingClaimed = new Set();
    async function hasContinuity(shift) {
        const oid = String(shift.objectiveId || '');
        const end = shiftEndDate(shift);
        if (!oid || !end)
            return false;
        if (!slaCache.has(oid)) {
            const slaSnap = await db
                .collection('servicios_sla')
                .where('objectiveId', '==', oid)
                .where('status', '==', 'active')
                .limit(1)
                .get();
            slaCache.set(oid, slaSnap.empty ? null : slaSnap.docs[0].data());
        }
        const sla = slaCache.get(oid);
        return (0, positionHasContinuity_1.positionHasContinuityFromSlaDoc)(sla || undefined, shift.positionName || '', end);
    }
    const outgoingDocs = [...snap.docs].sort((a, b) => checkInMs(a.data()) - checkInMs(b.data()));
    for (const docSnap of outgoingDocs) {
        const shift = docSnap.data();
        if (!ctx.isEnabled(shift.empresaId))
            continue;
        if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift))
            continue;
        if ((shift.status || '') === 'INTERRUPTED')
            continue;
        const endTimeMs = shiftEndMs(shift);
        if (!endTimeMs)
            continue;
        const continuous = await hasContinuity(shift);
        if (shift.isRetention === true) {
            const manualExtended = shift.manualRetentionType === 'extended' && Number(shift.manualRetentionHours || 0) > 0;
            if (manualExtended) {
                const extH = Number(shift.manualRetentionHours);
                const baseMs = shift.manualRetentionStartedAt?.toMillis?.() ?? endTimeMs;
                if (nowMs < baseMs + extH * 3600000)
                    continue;
                completeBatch.update(docSnap.ref, {
                    status: 'COMPLETED',
                    isCompleted: true,
                    isPresent: false,
                    completedAt: now,
                    completedBy: 'Sistema',
                    completionReason: 'MANUAL_EXTENSION_ELAPSED',
                });
                completed++;
                continue;
            }
            const totalMs = (0, coverageRetention_1.totalShiftMs)(shift, nowMs);
            if (totalMs >= coverageRetention_1.RETENTION_MAX_TOTAL_MS) {
                if (!continuous) {
                    completeBatch.update(docSnap.ref, {
                        status: 'COMPLETED',
                        isCompleted: true,
                        isPresent: false,
                        completedAt: now,
                        completedBy: 'Sistema',
                        completionReason: 'RETENCION_TOPE_12H',
                    });
                    completed++;
                }
                else {
                    const existing = await db
                        .collection('novedades')
                        .where('shiftId', '==', docSnap.id)
                        .where('type', '==', 'RETENCION_TOPE_12H')
                        .limit(1)
                        .get();
                    if (existing.empty) {
                        await db.collection('novedades').add({
                            type: 'RETENCION_TOPE_12H',
                            status: 'PENDIENTE',
                            shiftId: docSnap.id,
                            objectiveId: shift.objectiveId || null,
                            objectiveName: shift.objectiveName || '',
                            empresaId: ctx.shiftEmpresaId(shift) || null,
                            employeeName: shift.employeeName || '',
                            positionName: shift.positionName || '',
                            description: `${shift.employeeName || 'Guardia'} superó 12 h en puesto con continuidad SLA — sigue retenido hasta relevo.`,
                            createdAt: now,
                            source: 'SYSTEM_SCHEDULER',
                        });
                    }
                }
            }
            continue;
        }
        const windowStart = firestore_1.Timestamp.fromMillis(endTimeMs - RELEVO_WINDOW_AFTER_MS);
        const windowEnd = firestore_1.Timestamp.fromMillis(endTimeMs + RELEVO_WINDOW_AFTER_MS);
        const relieveSnap = shift.objectiveId && shift.positionName
            ? await db
                .collection('turnos')
                .where('objectiveId', '==', shift.objectiveId)
                .where('positionName', '==', shift.positionName)
                .where('startTime', '>=', windowStart)
                .where('startTime', '<=', windowEnd)
                .get()
            : { docs: [] };
        const relieveDocs = relieveSnap.docs.filter((d) => d.id !== docSnap.id
            && ctx.sameTenantShift(shift, d.data())
            && !(0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(d.data()));
        const relievePresent = relieveDocs.find((d) => {
            if (reliefIncomingClaimed.has(d.id))
                return false;
            const data = d.data();
            return isReliefPresent(data) && isValidReliefForOutgoing(data, endTimeMs);
        });
        const relievePending = relieveDocs.find((d) => {
            const data = d.data();
            return isReliefPending(data) && isValidReliefForOutgoing(data, endTimeMs);
        });
        const relieveAbsent = relieveDocs.find((d) => {
            const data = d.data();
            return isReliefAbsent(data) && isValidReliefForOutgoing(data, endTimeMs);
        });
        if (relievePresent) {
            reliefIncomingClaimed.add(relievePresent.id);
            const relData = relievePresent.data();
            const relCheckMs = relData.realStartTime?.toMillis?.() ??
                relData.checkInTime?.toMillis?.() ??
                nowMs;
            const closeMs = relCheckMs <= endTimeMs ? endTimeMs : relCheckMs;
            completeBatch.update(docSnap.ref, {
                status: 'COMPLETED',
                isCompleted: true,
                realEndTime: firestore_1.Timestamp.fromMillis(closeMs),
                autoCompletedAt: now,
                autoCompletedBy: 'SYSTEM_SCHEDULER',
                autoCloseReason: 'RELEVO_PRESENTE',
                completionReason: 'RELEVO_PRESENTE',
            });
            completed++;
        }
        else if (relievePending || relieveAbsent) {
            if (!continuous) {
                completeBatch.update(docSnap.ref, {
                    status: 'COMPLETED',
                    isCompleted: true,
                    realEndTime: now,
                    autoCompletedAt: now,
                    autoCompletedBy: 'SYSTEM_SCHEDULER',
                    autoCloseReason: 'SIN_CONTINUIDAD_SLA',
                    completionReason: 'SIN_CONTINUIDAD_SLA',
                });
                completed++;
                continue;
            }
            if (relieveAbsent) {
                await (0, coverageRetention_1.retainOutgoingForGap)(db, {
                    ...relieveAbsent.data(),
                    id: relieveAbsent.id,
                }, { sendPush: true, reportedBy: 'AUTO' });
            }
            else if (relievePending) {
                const pendingId = relievePending.id;
                const pendingData = relievePending.data();
                if (!shift.isRetention) {
                    completeBatch.update(docSnap.ref, {
                        isRetention: true,
                        retentionReason: `RELEVO_NO_PRESENTADO: ${pendingData.employeeName || 'relevo'} no se presentó`,
                        retentionAbsenceShiftId: pendingId,
                        autoRetentionAt: firestore_1.Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
                    });
                }
                else if (!shift.retentionAbsenceShiftId) {
                    completeBatch.update(docSnap.ref, {
                        retentionAbsenceShiftId: pendingId,
                    });
                }
            }
            alertedNoRelief++;
        }
        else if (!continuous) {
            completeBatch.update(docSnap.ref, {
                status: 'COMPLETED',
                isCompleted: true,
                realEndTime: now,
                autoCompletedAt: now,
                autoCompletedBy: 'SYSTEM_SCHEDULER',
                autoCloseReason: 'SIN_CONTINUIDAD_SLA',
                completionReason: 'SIN_CONTINUIDAD_SLA',
            });
            completed++;
        }
        else {
            if (!shift.isRetention) {
                completeBatch.update(docSnap.ref, {
                    isRetention: true,
                    retentionReason: 'SIN_RELEVO_CONTINUIDAD',
                    autoRetentionAt: firestore_1.Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
                });
            }
            alertedNoRelief++;
        }
    }
    await completeBatch.commit();
    return { completed, alertedNoRelief };
}
//# sourceMappingURL=autoCompletarTurnosCore.js.map