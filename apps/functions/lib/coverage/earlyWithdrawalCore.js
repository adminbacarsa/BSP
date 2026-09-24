"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processEarlyWithdrawal = processEarlyWithdrawal;
const firestore_1 = require("firebase-admin/firestore");
const earlyWithdrawCascade_1 = require("./earlyWithdrawCascade");
const opsManualMode_1 = require("../ops/opsManualMode");
const escalarVacanteSinCobertura_1 = require("./escalarVacanteSinCobertura");
const earlyWithdrawPolicy_1 = require("./earlyWithdrawPolicy");
function endMs(shift) {
    const et = shift.endTime;
    if (et instanceof firestore_1.Timestamp)
        return et.toMillis();
    if (et && typeof et.toMillis === 'function') {
        return et.toMillis();
    }
    return 0;
}
function startMs(shift) {
    const st = shift.startTime;
    if (st instanceof firestore_1.Timestamp)
        return st.toMillis();
    if (st && typeof st.toMillis === 'function') {
        return st.toMillis();
    }
    return 0;
}
function ymdAr(d) {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' });
}
async function processEarlyWithdrawal(db, input) {
    const shiftId = String(input.shiftId || '').trim();
    if (!shiftId) {
        return {
            ok: false,
            policy: 'NO_REPLACE',
            hoursLeft: 0,
            outgoingShiftClosed: false,
            remainderShiftId: null,
            cascadeStarted: false,
            escalated: false,
            retained: false,
            error: 'MISSING_SHIFT_ID',
        };
    }
    const ref = db.collection('turnos').doc(shiftId);
    const snap = await ref.get();
    if (!snap.exists) {
        return {
            ok: false,
            policy: 'NO_REPLACE',
            hoursLeft: 0,
            outgoingShiftClosed: false,
            remainderShiftId: null,
            cascadeStarted: false,
            escalated: false,
            retained: false,
            error: 'NOT_FOUND',
        };
    }
    const shift = snap.data();
    const now = input.now || firestore_1.Timestamp.now();
    const nowMs = now.toMillis();
    const endMsVal = endMs(shift);
    const hoursLeft = (0, earlyWithdrawPolicy_1.hoursRemainingUntilEnd)(nowMs, endMsVal);
    const empresaId = String(shift.empresaId || '').trim();
    const objectiveId = String(shift.objectiveId || '').trim();
    const employeeId = String(shift.employeeId || '').trim();
    const colleagues = await (0, escalarVacanteSinCobertura_1.countColleaguesPresentSameObjective)(db, objectiveId, shiftId, employeeId);
    const reemplazarRetiro2a3h = await (0, escalarVacanteSinCobertura_1.loadReemplazarRetiro2a3hFromSla)(db, objectiveId, String(shift.positionName || ''));
    const isAutoMode = input.resolvedBy === 'AUTO';
    const policy = (0, earlyWithdrawPolicy_1.resolveEarlyWithdrawReplacePolicy)({
        hoursLeft,
        colleaguesPresent: colleagues,
        reemplazarRetiro2a3h,
        isAutoMode,
        operatorReplaceChoice: input.operatorReplaceChoice,
    });
    if (policy === 'OPERATOR_CHOICE') {
        return {
            ok: false,
            policy,
            hoursLeft,
            outgoingShiftClosed: false,
            remainderShiftId: null,
            cascadeStarted: false,
            escalated: false,
            retained: false,
            error: 'OPERATOR_CHOICE_REQUIRED',
        };
    }
    const rrhh = (0, earlyWithdrawPolicy_1.rrhhPartialForReason)(input.reason);
    const scheduledH = Math.max(0.25, (endMsVal - startMs(shift)) / 3600000);
    const workedH = Math.max(0, scheduledH - hoursLeft);
    await ref.update({
        status: 'COMPLETED',
        isCompleted: true,
        isPresent: false,
        realEndTime: now,
        interrupted: true,
        interruptionReason: input.reason,
        endTime: now,
        completionReason: 'EARLY_WITHDRAW',
    });
    const dateStr = ymdAr(new Date(nowMs));
    await db.collection('ausencias').add({
        employeeId,
        employeeName: shift.employeeName || '',
        startDate: dateStr,
        endDate: dateStr,
        type: rrhh.typeLabel,
        absenceType: rrhh.absenceType,
        isPartialAbsence: true,
        partialScheduledHours: Math.round(scheduledH * 100) / 100,
        partialWorkedHours: Math.round(workedH * 100) / 100,
        origin: 'EARLY_WITHDRAW',
        shiftId,
        objectiveId: objectiveId || null,
        objectiveName: shift.objectiveName || null,
        positionName: shift.positionName || null,
        reason: `${rrhh.typeLabel} — ${shift.objectiveName || ''} (${shift.positionName || ''})`,
        status: 'Confirmada',
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        reportedBy: input.resolvedBy || 'OPERACIONES',
        empresaId: empresaId || null,
    });
    if (rrhh.disciplinary) {
        await db.collection('novedades').add({
            type: 'NOVEDAD_DISCIPLINARIA',
            status: 'PENDIENTE',
            shiftId,
            employeeId,
            employeeName: shift.employeeName || '',
            objectiveId: objectiveId || null,
            objectiveName: shift.objectiveName || '',
            empresaId: empresaId || null,
            description: `Abandono de puesto — retiro anticipado parcial (${shift.employeeName || ''}).`,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            source: 'EARLY_WITHDRAW',
        });
    }
    let remainderShiftId = null;
    let cascadeStarted = false;
    let escalated = false;
    let retained = false;
    const shouldReplace = policy === 'REPLACE' || policy === 'AUTO_REPLACE';
    if (shouldReplace && endMsVal > nowMs + 60_000) {
        const vacRef = db.collection('turnos').doc();
        remainderShiftId = vacRef.id;
        await vacRef.set({
            clientId: shift.clientId || null,
            clientName: shift.clientName || null,
            objectiveId: objectiveId || null,
            objectiveName: shift.objectiveName || '',
            positionName: shift.positionName || '',
            employeeId: 'VACANTE',
            employeeName: 'VACANTE (REMANENTE)',
            code: shift.code || 'M',
            startTime: now,
            endTime: shift.endTime instanceof firestore_1.Timestamp ? shift.endTime : firestore_1.Timestamp.fromMillis(endMsVal),
            status: 'UNCOVERED_REPORTED',
            isUnassigned: true,
            isPresent: false,
            isReported: true,
            origin: 'INTERRUPTION',
            originRef: shiftId,
            causedByEmployeeId: employeeId,
            causedByEmployeeName: shift.employeeName || '',
            empresaId: empresaId || null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        if (isAutoMode && empresaId) {
            const manual = await (0, opsManualMode_1.isEmpresaManualMode)(db, empresaId);
            if (!manual) {
                await (0, earlyWithdrawCascade_1.iniciarEarlyWithdrawCascade)(db, {
                    id: remainderShiftId,
                    empresaId,
                    objectiveId,
                    objectiveName: String(shift.objectiveName || ''),
                    positionName: String(shift.positionName || ''),
                    clientId: String(shift.clientId || ''),
                    clientName: String(shift.clientName || ''),
                    code: String(shift.code || ''),
                    startTime: now,
                    endTime: shift.endTime instanceof firestore_1.Timestamp
                        ? shift.endTime
                        : firestore_1.Timestamp.fromMillis(endMsVal),
                }, 'AUTO');
                cascadeStarted = true;
            }
        }
    }
    else if (shouldReplace && endMsVal <= nowMs + 60_000) {
        const esc = await (0, escalarVacanteSinCobertura_1.escalarVacanteSinCobertura)(db, {
            shiftId,
            empresaId,
            objectiveId,
            objectiveName: String(shift.objectiveName || ''),
            positionName: String(shift.positionName || ''),
            message: 'Retiro anticipado sin remanente útil — escalado.',
            attemptRetention: true,
            source: 'EARLY_WITHDRAW',
        });
        escalated = esc.escalated;
        retained = esc.retained;
    }
    await db.collection('audit_logs').add({
        action: shouldReplace ? 'BAJA_PROTOCOLO' : 'BAJA_CUBIERTA',
        module: 'OPERACIONES',
        actorName: input.actorName || input.resolvedBy || 'OPERACIONES',
        actorUid: input.actorUid || null,
        shiftId,
        employeeId,
        employeeName: shift.employeeName || '',
        objectiveId,
        objectiveName: shift.objectiveName || '',
        details: `Retiro anticipado (${input.reason}) policy=${policy} hLeft=${hoursLeft.toFixed(2)}`,
        timestamp: firestore_1.FieldValue.serverTimestamp(),
    });
    return {
        ok: true,
        policy,
        hoursLeft,
        outgoingShiftClosed: true,
        remainderShiftId,
        cascadeStarted,
        escalated,
        retained,
    };
}
//# sourceMappingURL=earlyWithdrawalCore.js.map