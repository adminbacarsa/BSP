"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPositionHasContinuity = void 0;
exports.isValidReliefForOutgoing = isValidReliefForOutgoing;
exports.isReliefPresent = isReliefPresent;
exports.runAutoCompletarTurnosPass = runAutoCompletarTurnosPass;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const positionHasContinuity_1 = require("../coverage/positionHasContinuity");
Object.defineProperty(exports, "loadPositionHasContinuity", { enumerable: true, get: function () { return positionHasContinuity_1.loadPositionHasContinuity; } });
const coverageRetention_1 = require("../coverage/coverageRetention");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const simulableShift_1 = require("../common/simulableShift");
const reliefEligibility_1 = require("../common/reliefEligibility");
const shiftSeries_1 = require("../common/shiftSeries");
const escalarVacanteSinCobertura_1 = require("../coverage/escalarVacanteSinCobertura");
const pushGreeting_1 = require("../common/pushGreeting");
const relevoNotifications_1 = require("../fichajes/relevoNotifications");
const shiftClose_1 = require("./shiftClose");
const RELEVO_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;
const RELEVO_ALIGN_MS = 30 * 60 * 1000;
function shiftEndMs(data) {
    return data.endTime?.toMillis?.() ?? 0;
}
function shiftStartMs(data) {
    return data.startTime?.toMillis?.() ?? 0;
}
function isValidReliefForOutgoing(incoming, outgoingEndMs, outgoing) {
    if (!(0, reliefEligibility_1.isReliefEligibleShift)(incoming))
        return false;
    const st = shiftStartMs(incoming);
    if (!st)
        return false;
    if (st < outgoingEndMs - RELEVO_ALIGN_MS)
        return false;
    if (st > outgoingEndMs + RELEVO_WINDOW_AFTER_MS)
        return false;
    if (outgoing && (0, shiftSeries_1.seriesHandoffKind)((0, shiftSeries_1.seriesCodeOf)(outgoing), (0, shiftSeries_1.seriesCodeOf)(incoming)) === 'REJECT')
        return false;
    return true;
}
function pickSeriesRelief(outgoingId, outgoing, endTimeMs, docs, pred) {
    const hits = docs.filter((d) => pred(d) && isValidReliefForOutgoing(d.data(), endTimeMs, outgoing));
    if (!hits.length)
        return undefined;
    const winner = (0, shiftSeries_1.relieverFor)({
        id: outgoingId,
        ...outgoing,
        startMs: shiftStartMs(outgoing),
        endMs: endTimeMs,
    }, hits.map((d) => ({
        id: d.id,
        ...d.data(),
        startMs: shiftStartMs(d.data()),
        endMs: shiftEndMs(d.data()),
    })), {
        earliestIncomingMs: endTimeMs - RELEVO_ALIGN_MS,
        latestIncomingMs: endTimeMs + RELEVO_WINDOW_AFTER_MS,
    });
    if (!winner?.id)
        return undefined;
    return hits.find((d) => d.id === String(winner.id));
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
function isGapCovered(data) {
    return data.operacionallyCovered === true || String(data.coverageStatus || '').toUpperCase() === 'COVERED';
}
function shiftEndDate(data) {
    const ms = shiftEndMs(data);
    return ms ? new Date(ms) : null;
}
async function runAutoCompletarTurnosPass(db, ctx, now = firestore_1.Timestamp.now(), passOpts) {
    const nowMs = now.toMillis();
    const cutoff = firestore_1.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);
    const onlyOutId = String(passOpts?.onlyOutgoingShiftId || '').trim();
    const dryRun = passOpts?.dryRun === true;
    let snap;
    if (onlyOutId) {
        const direct = await db.collection('turnos').doc(onlyOutId).get();
        snap = direct.exists
            ? { empty: false, docs: [direct] }
            : { empty: true, docs: [] };
    }
    else {
        snap = await db
            .collection('turnos')
            .where('status', '==', 'PRESENT')
            .where('endTime', '<=', cutoff)
            .get();
    }
    const actions = [];
    if (snap.empty)
        return { completed: 0, alertedNoRelief: 0, actions };
    const completeBatch = db.batch();
    let completed = 0;
    let alertedNoRelief = 0;
    const slaCache = new Map();
    const reliefIncomingClaimed = new Set();
    const reliefPendingClaimed = new Set();
    const capEscalations = [];
    const relevoFinishNotifs = [];
    const describe = (id, shift, kind, reason, extra = {}) => ({
        shiftId: id,
        kind,
        reason,
        empresaId: ctx.shiftEmpresaId(shift),
        employeeName: String(shift.employeeName || shift.employeeId || ''),
        objectiveName: String(shift.objectiveName || shift.objectiveId || ''),
        positionName: String(shift.positionName || ''),
        code: String(shift.code || ''),
        startMs: shiftStartMs(shift),
        endMs: shiftEndMs(shift),
        workStartMs: (0, shiftClose_1.shiftWorkStartMs)(shift),
        wasRetention: shift.isRetention === true,
        ccOff: !ctx.isEnabled(shift.empresaId),
        ...extra,
    });
    const update = (ref, patch) => {
        if (!dryRun)
            completeBatch.update(ref, patch);
    };
    const close = (docSnap, shift, realEndMs, reason, extra, gapShiftId) => {
        const patch = (0, shiftClose_1.buildAutoClosePatch)(shift, { realEndMs, reason, now, extra });
        update(docSnap.ref, patch);
        actions.push(describe(docSnap.id, shift, 'CLOSE', reason, {
            realEndMs: patch.realEndTime.toMillis(),
            requiereRevision: patch.requiereRevision === true,
            gapShiftId: gapShiftId ?? null,
        }));
        completed++;
    };
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
                .get();
            slaCache.set(oid, slaSnap.docs.map((d) => ({ ...d.data(), id: d.id })));
        }
        return (slaCache.get(oid) || []).some((sla) => (0, positionHasContinuity_1.positionHasContinuityFromSlaDoc)(sla, shift.positionName || '', end, (0, shiftSeries_1.seriesCodeOf)(shift)));
    }
    const outgoingDocs = [...snap.docs].sort((a, b) => (0, shiftClose_1.shiftWorkStartMs)(a.data()) - (0, shiftClose_1.shiftWorkStartMs)(b.data()));
    const reservedReliefKey = (objectiveId, employeeId) => `${String(objectiveId || '')}|${String(employeeId || '')}`;
    const reservedRelief = new Map();
    for (const d of outgoingDocs) {
        const rb = String(d.data().relievedBy || '').trim();
        if (rb)
            reservedRelief.set(reservedReliefKey(d.data().objectiveId, rb), d.id);
    }
    const reliefBusyForOther = (incoming, outgoingId) => {
        const linked = String(incoming.relievedOutgoingShiftId || '').trim();
        if (linked && linked !== outgoingId)
            return true;
        const owner = reservedRelief.get(reservedReliefKey(incoming.objectiveId, incoming.employeeId));
        return !!owner && owner !== outgoingId;
    };
    for (const docSnap of outgoingDocs) {
        if (onlyOutId && docSnap.id !== onlyOutId)
            continue;
        if (onlyOutId) {
            const endMs = shiftEndMs(docSnap.data());
            if (!endMs || endMs > cutoff.toMillis())
                continue;
        }
        const shift = docSnap.data();
        if (passOpts?.empresaFilter && !passOpts.empresaFilter(ctx.shiftEmpresaId(shift)))
            continue;
        const ccOff = !ctx.isEnabled(shift.empresaId);
        if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(shift))
            continue;
        if ((shift.status || '') === 'INTERRUPTED')
            continue;
        if ((0, simulableShift_1.isLicenseShiftCode)(shift.code)) {
            actions.push(describe(docSnap.id, shift, 'WAIT', 'LICENCIA_PRESENTE'));
            continue;
        }
        const endTimeMs = shiftEndMs(shift);
        if (!endTimeMs)
            continue;
        const capAtMs = (0, shiftClose_1.shiftHardCapAtMs)(shift);
        const capReached = capAtMs > 0 && nowMs >= capAtMs;
        const relievedBy = String(shift.relievedBy || '').trim();
        const relieveSchedMs = shift.relieveScheduledAt?.toMillis?.()
            ?? (relievedBy ? endTimeMs : 0);
        if (relievedBy && relieveSchedMs > 0 && nowMs >= relieveSchedMs) {
            const incomingName = String(shift.relievedByName || 'relevo').trim();
            close(docSnap, shift, relieveSchedMs, 'RELEVO_PROGRAMADO');
            const outEmpId = String(shift.employeeId || '').trim();
            if (outEmpId && !ccOff) {
                relevoFinishNotifs.push({
                    outEmpId,
                    outDocId: docSnap.id,
                    incomingName,
                    objectiveName: String(shift.objectiveName || ''),
                    empresaId: ctx.shiftEmpresaId(shift) || null,
                });
            }
            continue;
        }
        if (capAtMs > 0 && nowMs >= capAtMs + shiftClose_1.STALE_CAP_GRACE_MS) {
            const retained = shift.isRetention === true;
            close(docSnap, shift, retained ? capAtMs : endTimeMs, 'TOPE_JORNADA_RETROACTIVO', {
                requiereRevision: true,
            });
            continue;
        }
        if ((0, reliefEligibility_1.isExtraNonReliefShift)(shift)) {
            const cappedEnd = capAtMs > 0 ? Math.min(endTimeMs, capAtMs) : endTimeMs;
            close(docSnap, shift, cappedEnd, cappedEnd < endTimeMs ? 'TOPE_JORNADA' : 'FIN_TURNO_EXTRA');
            continue;
        }
        const manualExtended = !ccOff
            && shift.isRetention === true
            && shift.manualRetentionType === 'extended'
            && Number(shift.manualRetentionHours || 0) > 0;
        if (manualExtended) {
            const extH = Number(shift.manualRetentionHours);
            const baseMs = shift.manualRetentionStartedAt?.toMillis?.() ?? endTimeMs;
            const elapsedAt = baseMs + extH * 3600000;
            if (capReached) {
                close(docSnap, shift, capAtMs, 'TOPE_JORNADA');
                capEscalations.push({ shiftId: docSnap.id, shift, capAtMs, gapShiftId: null, gapCovered: false });
            }
            else if (nowMs >= elapsedAt) {
                close(docSnap, shift, elapsedAt, 'MANUAL_EXTENSION_ELAPSED');
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
        const relievePresent = pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => {
            if (reliefIncomingClaimed.has(d.id))
                return false;
            if (reliefBusyForOther(d.data(), docSnap.id))
                return false;
            return isReliefPresent(d.data());
        });
        const relievePending = pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => !reliefPendingClaimed.has(d.id) && isReliefPending(d.data()))
            ?? pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => isReliefPending(d.data()));
        if (relievePending)
            reliefPendingClaimed.add(relievePending.id);
        const relieveAbsent = pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => isReliefAbsent(d.data()));
        if (relievePresent) {
            reliefIncomingClaimed.add(relievePresent.id);
            update(relievePresent.ref, { relievedOutgoingShiftId: docSnap.id });
            const relData = relievePresent.data();
            const plannedIn = shiftStartMs(relData) || endTimeMs;
            const handoffMs = Math.max(plannedIn, endTimeMs);
            if (nowMs < handoffMs) {
                update(docSnap.ref, {
                    relievedBy: String(relData.employeeId || '').trim() || null,
                    relievedByName: String(relData.employeeName || 'relevo').trim(),
                    relieveScheduledAt: firestore_1.Timestamp.fromMillis(handoffMs),
                    relievedEarly: true,
                    autoRelevo: true,
                });
                actions.push(describe(docSnap.id, shift, 'WAIT', 'RELEVO_PROGRAMADO'));
                continue;
            }
            const punchMs = relData.checkInAt?.toMillis?.() ??
                relData.checkInTime?.toMillis?.() ??
                nowMs;
            const relCheckMs = Math.max(handoffMs, Math.min(punchMs, nowMs));
            const closeMs = relCheckMs;
            const overCap = capAtMs > 0 && closeMs > capAtMs;
            close(docSnap, shift, closeMs, overCap ? 'TOPE_JORNADA' : 'RELEVO_PRESENTE');
            const outEmpId = String(shift.employeeId || '').trim();
            if (outEmpId && !ccOff && relCheckMs <= endTimeMs) {
                relevoFinishNotifs.push({
                    outEmpId,
                    outDocId: docSnap.id,
                    incomingName: String(relData.employeeName || 'tu relevo').trim(),
                    objectiveName: String(shift.objectiveName || ''),
                    empresaId: ctx.shiftEmpresaId(shift) || null,
                });
            }
            continue;
        }
        if (capReached) {
            const linkedGapId = String(shift.retentionAbsenceShiftId || '').trim();
            let gapData = null;
            if (linkedGapId) {
                const inWindow = relieveDocs.find((d) => d.id === linkedGapId);
                gapData = inWindow ? inWindow.data() : ((await db.collection('turnos').doc(linkedGapId).get()).data() ?? null);
            }
            else {
                gapData = (relieveAbsent ?? relievePending)?.data() ?? null;
            }
            const gapShiftId = linkedGapId || (relieveAbsent ?? relievePending)?.id || null;
            const gapCovered = gapData ? isGapCovered(gapData) : false;
            close(docSnap, shift, capAtMs, 'TOPE_JORNADA', undefined, gapShiftId);
            if (!ccOff)
                capEscalations.push({ shiftId: docSnap.id, shift, capAtMs, gapShiftId, gapCovered });
            continue;
        }
        if (ccOff && shift.isRetention === true) {
            actions.push(describe(docSnap.id, shift, 'WAIT', 'CC_OFF_ESPERA_TOPE'));
            continue;
        }
        if (shift.isRetention === true) {
            const linkTarget = relieveAbsent ?? relievePending;
            if (!shift.retentionAbsenceShiftId && linkTarget) {
                update(docSnap.ref, { retentionAbsenceShiftId: linkTarget.id });
                actions.push(describe(docSnap.id, shift, 'LINK_RELIEF', 'RETENIDO_VINCULA_RELEVO', { gapShiftId: linkTarget.id }));
            }
            continue;
        }
        const continuous = await hasContinuity(shift);
        if (ccOff) {
            if (continuous)
                actions.push(describe(docSnap.id, shift, 'WAIT', 'CC_OFF_ESPERA_TOPE'));
            else
                close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
            continue;
        }
        if (relievePending || relieveAbsent) {
            const retentionUntilMs = shift.retentionExpectedUntil?.toMillis?.()
                ?? shift.lateReliefEtaAt?.toMillis?.()
                ?? 0;
            if (retentionUntilMs > 0 && nowMs < retentionUntilMs) {
                actions.push(describe(docSnap.id, shift, 'WAIT', 'ESPERA_ETA_RELEVO'));
                continue;
            }
            if (!continuous) {
                close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
                continue;
            }
            if (relieveAbsent) {
                const absentData = relieveAbsent.data();
                if (isGapCovered(absentData)) {
                    update(docSnap.ref, {
                        isRetention: true,
                        retentionReason: 'ESPERA_CUBRIDOR',
                        retentionKind: 'AUSENCIA_RELEVO',
                        retentionAbsenceShiftId: relieveAbsent.id,
                        autoRetentionAt: firestore_1.Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
                    });
                    actions.push(describe(docSnap.id, shift, 'RETAIN_QUIET', 'ESPERA_CUBRIDOR', { gapShiftId: relieveAbsent.id }));
                }
                else {
                    if (!dryRun) {
                        await (0, coverageRetention_1.retainOutgoingForGap)(db, { ...absentData, id: relieveAbsent.id }, { sendPush: true, reportedBy: 'AUTO' });
                    }
                    actions.push(describe(docSnap.id, shift, 'RETAIN', 'AUSENCIA_RELEVO', { gapShiftId: relieveAbsent.id }));
                }
            }
            else if (relievePending) {
                const pendingData = relievePending.data();
                update(docSnap.ref, {
                    isRetention: true,
                    retentionReason: `RELEVO_NO_PRESENTADO: ${pendingData.employeeName || 'relevo'} no se presentó`,
                    retentionAbsenceShiftId: relievePending.id,
                    autoRetentionAt: firestore_1.Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
                });
                actions.push(describe(docSnap.id, shift, 'RETAIN', 'RELEVO_NO_PRESENTADO', { gapShiftId: relievePending.id }));
            }
            alertedNoRelief++;
        }
        else if (!continuous) {
            const retentionUntilMs = shift.retentionExpectedUntil?.toMillis?.()
                ?? shift.lateReliefEtaAt?.toMillis?.()
                ?? 0;
            if (retentionUntilMs > 0 && nowMs < retentionUntilMs) {
                actions.push(describe(docSnap.id, shift, 'WAIT', 'ESPERA_ETA_RELEVO'));
                continue;
            }
            close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
        }
        else {
            update(docSnap.ref, {
                isRetention: true,
                retentionReason: 'SIN_RELEVO_CONTINUIDAD',
                autoRetentionAt: firestore_1.Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
            });
            actions.push(describe(docSnap.id, shift, 'RETAIN', 'SIN_RELEVO_CONTINUIDAD'));
            alertedNoRelief++;
        }
    }
    if (dryRun)
        return { completed, alertedNoRelief, actions };
    await completeBatch.commit();
    for (const n of relevoFinishNotifs) {
        await (0, relevoNotifications_1.notifyTurnoFinalizadoRelevo)(db, n).catch((e) => console.warn('[autoCompletarTurnos] TURNO_FINALIZADO:', e?.message));
    }
    for (const esc of capEscalations) {
        await escalateCapClose(db, ctx, esc, now).catch((e) => console.warn('[autoCompletarTurnos] TOPE_JORNADA escalado:', e?.message));
    }
    return { completed, alertedNoRelief, actions };
}
function fmtArHm(ms) {
    const d = new Date(ms - 3 * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
async function escalateCapClose(db, ctx, esc, now) {
    const { shift, shiftId, capAtMs, gapShiftId, gapCovered } = esc;
    const empresaId = ctx.shiftEmpresaId(shift) || null;
    const who = String(shift.employeeName || 'Guardia');
    const where = `${shift.objectiveName || 'objetivo'} (${shift.positionName || 'puesto'})`;
    const gapTxt = !gapShiftId
        ? 'sin relevo planificado: el puesto queda vacante.'
        : gapCovered
            ? 'el cubridor asignado todavía no se presentó.'
            : 'el relevo no está cubierto: el puesto queda vacante.';
    const safeId = shiftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    await db.collection('novedades').doc(`tope_${safeId}`).set({
        type: 'TOPE_JORNADA',
        status: 'PENDIENTE',
        shiftId,
        gapShiftId: gapShiftId || null,
        objectiveId: shift.objectiveId || null,
        objectiveName: shift.objectiveName || '',
        positionName: shift.positionName || '',
        employeeId: shift.employeeId || null,
        employeeName: who,
        empresaId,
        description: `${who} cerró a las ${fmtArHm(capAtMs)} por tope de jornada (12:59) en ${where}; ${gapTxt}`,
        createdAt: now,
        source: 'SYSTEM_SCHEDULER',
    }, { merge: true });
    if (gapShiftId && !gapCovered) {
        await (0, escalarVacanteSinCobertura_1.escalarVacanteSinCobertura)(db, {
            shiftId: gapShiftId,
            empresaId,
            objectiveId: String(shift.objectiveId || '') || null,
            objectiveName: String(shift.objectiveName || ''),
            positionName: String(shift.positionName || ''),
            attemptRetention: false,
            source: 'TOPE_JORNADA',
            message: `Tope de jornada: ${who} se retiró a las ${fmtArHm(capAtMs)} y el puesto ${where} quedó sin cobertura.`,
        });
    }
    const outEmpId = String(shift.employeeId || '').trim();
    if (outEmpId && outEmpId !== 'VACANTE') {
        const tokens = await ctx.getEmployeeTokens(db, outEmpId).catch(() => []);
        if (tokens.length) {
            const capName = (0, pushGreeting_1.guardFirstName)({ employeeName: shift.employeeName });
            await admin
                .messaging()
                .sendEachForMulticast({
                tokens,
                notification: {
                    title: 'Tope de jornada',
                    body: `${capName ? `${capName}, ` : ''}llegaste al máximo de horas de hoy. Podés retirarte, gracias por quedarte.`,
                },
                webpush: { fcmOptions: { link: '/app/' } },
            })
                .catch(() => undefined);
        }
    }
}
//# sourceMappingURL=autoCompletarTurnosCore.js.map