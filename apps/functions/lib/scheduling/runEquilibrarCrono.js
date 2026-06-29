"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEquilibrarCrono = exports.runEquilibrarCronoHandler = void 0;
const functions = require("firebase-functions/v1");
const firestore_1 = require("firebase-admin/firestore");
const db = () => (0, firestore_1.getFirestore)();
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);
function isOperacional(d) {
    return d.origin === 'RETEN' || d.origin === 'OPERATIONS_COVERAGE'
        || d.origin === 'SLA_VIRTUAL' || !!d.isReten || d.resolvedBy === 'OPERACIONES';
}
function tsToDateStrAR(ts) {
    const ms = ts.toMillis() - 3 * 60 * 60 * 1000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function monthBoundsAR(year, month) {
    const m = month - 1;
    return {
        start: firestore_1.Timestamp.fromDate(new Date(Date.UTC(year, m, 1, 0, 0, 0))),
        end: firestore_1.Timestamp.fromDate(new Date(Date.UTC(year, m + 1, 2, 23, 59, 59))),
    };
}
function rebuildTs(dateStr, prof) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, d, prof.startUTCHour, 0, 0));
    const endDayOffset = prof.endNextDay ? d + 1 : d;
    const endDate = new Date(Date.UTC(y, m - 1, endDayOffset, prof.endUTCHour, 0, 0));
    return {
        startTime: firestore_1.Timestamp.fromDate(startDate),
        endTime: firestore_1.Timestamp.fromDate(endDate),
    };
}
const RUNTIME = { timeoutSeconds: 180, memory: '512MB' };
const runEquilibrarCronoHandler = async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }
    const { empresaId, objectiveId, year, month, dryRun = false } = data;
    if (!empresaId || !objectiveId || !year || !month || month < 1 || month > 12) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, year y month (1–12) son requeridos.');
    }
    try {
        const errores = [];
        const bounds = monthBoundsAR(year, month);
        let snap;
        try {
            snap = await db().collection('turnos')
                .where('objectiveId', '==', objectiveId)
                .where('startTime', '>=', bounds.start)
                .where('startTime', '<=', bounds.end)
                .get();
        }
        catch (_queryErr) {
            snap = await db().collection('turnos')
                .where('objectiveId', '==', objectiveId)
                .get();
        }
        const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
        const allTurnos = [];
        let skippedOps = 0, skippedNoTs = 0, skippedOtherMonth = 0;
        for (const doc of snap.docs) {
            const d = doc.data();
            if (isOperacional(d)) {
                skippedOps++;
                continue;
            }
            if (!d.startTime || !d.endTime) {
                skippedNoTs++;
                continue;
            }
            const code = String(d.code || '').toUpperCase();
            const isFranco = d.isFranco === true || FRANCO_CODES.has(code);
            const isAbsence = ABSENCE_CODES.has(code);
            const dateStr = tsToDateStrAR(d.startTime);
            if (!dateStr.startsWith(monthPrefix)) {
                skippedOtherMonth++;
                continue;
            }
            allTurnos.push({
                id: doc.id,
                empId: String(d.employeeId || ''),
                empName: String(d.employeeName || d.employeeId || ''),
                dateStr,
                posName: String(d.positionName || ''),
                code,
                hours: (() => {
                    let h = Number(d.hours) || 0;
                    if (!h) {
                        const diffMs = d.endTime.toMillis() - d.startTime.toMillis();
                        if (diffMs > 0 && diffMs <= 24 * 3600000)
                            h = Math.round(diffMs / 3600000 * 2) / 2;
                    }
                    return h;
                })(),
                name: String(d.name || code),
                startTime: d.startTime,
                endTime: d.endTime,
                isFranco,
                isAbsence,
                isDraft: d.draft === true,
            });
        }
        if (allTurnos.length === 0) {
            const diag = `(query: ${snap.docs.length} docs, ops: ${skippedOps}, sinTs: ${skippedNoTs}, otroMes: ${skippedOtherMonth})`;
            return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                horasAntes: {}, horasDespues: {}, errores: [`No se encontraron turnos para este objetivo/mes. ${diag}`] };
        }
        const posProfiles = {};
        for (const t of allTurnos) {
            if (t.isFranco || t.isAbsence || !t.posName)
                continue;
            const slotKey = `${t.posName}__${t.code}`;
            if (!posProfiles[slotKey]) {
                const startD = t.startTime.toDate();
                const endD = t.endTime.toDate();
                const endNextDay = endD.getUTCDate() !== startD.getUTCDate()
                    || endD.getUTCMonth() !== startD.getUTCMonth();
                posProfiles[slotKey] = {
                    posName: t.posName,
                    code: t.code,
                    hours: t.hours,
                    name: t.name,
                    startUTCHour: startD.getUTCHours(),
                    endUTCHour: endD.getUTCHours(),
                    endNextDay,
                };
            }
        }
        const slotKeys = Object.keys(posProfiles);
        if (slotKeys.length < 2) {
            return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                horasAntes: {}, horasDespues: {}, errores: ['Se necesitan al menos 2 tipos de turno distintos para equilibrar.'] };
        }
        const horasAntes = {};
        for (const t of allTurnos) {
            if (!t.isFranco && !t.isAbsence) {
                horasAntes[t.empId] = (horasAntes[t.empId] || 0) + t.hours;
            }
        }
        const byEmp = {};
        for (const t of allTurnos) {
            if (!byEmp[t.empId])
                byEmp[t.empId] = [];
            byEmp[t.empId].push(t);
        }
        const allBlocks = [];
        const pushBlock = (empId, cur) => {
            if (cur.length === 0)
                return;
            const slotKey = `${cur[0].posName}__${cur[0].code}`;
            const isPure = cur.every(s => `${s.posName}__${s.code}` === slotKey);
            allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur, slotKey, isPure });
        };
        for (const [empId, shifts] of Object.entries(byEmp)) {
            shifts.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
            const work = shifts.filter(s => !s.isFranco && !s.isAbsence && s.posName);
            if (work.length === 0)
                continue;
            let cur = [work[0]];
            for (let i = 1; i < work.length; i++) {
                const prevMs = new Date(work[i - 1].dateStr + 'T12:00:00Z').getTime();
                const currMs = new Date(work[i].dateStr + 'T12:00:00Z').getTime();
                const diffDays = Math.round((currMs - prevMs) / 86400000);
                if (diffDays === 1) {
                    cur.push(work[i]);
                }
                else {
                    pushBlock(empId, cur);
                    cur = [work[i]];
                }
            }
            pushBlock(empId, cur);
        }
        if (allBlocks.length === 0) {
            return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                horasAntes, horasDespues: horasAntes, errores: ['No se detectaron bloques de trabajo.'] };
        }
        const sortedSlotKeys = slotKeys.slice().sort((a, b) => {
            const hd = posProfiles[b].hours - posProfiles[a].hours;
            return hd !== 0 ? hd : a.localeCompare(b);
        });
        const updates = new Map();
        const rotadosSet = new Set();
        let bloquesProcesados = 0;
        const currentHours = { ...horasAntes };
        const empIds = Object.keys(horasAntes);
        const targetHours = empIds.length > 0
            ? Math.round(empIds.reduce((s, id) => s + (horasAntes[id] || 0), 0) / empIds.length)
            : 192;
        const lastBlockEndDate = {};
        const lastAssignedSlotKey = {};
        const violaTransicion = (empId, candidate, blockFirstDay) => {
            const prevKey = lastAssignedSlotKey[empId];
            const prevEnd = lastBlockEndDate[empId];
            if (!prevKey || !prevEnd)
                return false;
            const prevSlot = posProfiles[prevKey];
            if (!prevSlot)
                return false;
            if (prevSlot.endUTCHour !== candidate.startUTCHour)
                return false;
            const gapDays = Math.round((new Date(blockFirstDay + 'T12:00:00Z').getTime()
                - new Date(prevEnd + 'T12:00:00Z').getTime()) / 86400000);
            return gapDays <= 1;
        };
        const blocksByRange = {};
        for (const block of allBlocks) {
            const endDate = block.shifts[block.shifts.length - 1].dateStr;
            const key = `${block.startDate}__${endDate}`;
            if (!blocksByRange[key])
                blocksByRange[key] = [];
            blocksByRange[key].push(block);
        }
        for (const rangeKey of Object.keys(blocksByRange).sort()) {
            const group = blocksByRange[rangeKey];
            group.sort((a, b) => {
                const ha = Math.max(horasAntes[a.empId] || 0, currentHours[a.empId] || 0);
                const hb = Math.max(horasAntes[b.empId] || 0, currentHours[b.empId] || 0);
                return ha !== hb ? ha - hb : a.empId.localeCompare(b.empId);
            });
            const groupPool = {};
            for (const block of group) {
                if (block.isPure && block.slotKey)
                    groupPool[block.slotKey] = (groupPool[block.slotKey] || 0) + 1;
            }
            for (const block of group) {
                const blockEndDate = block.shifts[block.shifts.length - 1].dateStr;
                if (!block.isPure) {
                    bloquesProcesados++;
                    lastBlockEndDate[block.empId] = blockEndDate;
                    lastAssignedSlotKey[block.empId] = block.slotKey || lastAssignedSlotKey[block.empId] || '';
                    continue;
                }
                const origProfCheck = posProfiles[block.slotKey];
                const origHCheck = origProfCheck ? block.shifts.length * origProfCheck.hours : 0;
                let assigned = null;
                for (const sk of sortedSlotKeys) {
                    if ((groupPool[sk] || 0) <= 0)
                        continue;
                    const candidate = posProfiles[sk];
                    if (violaTransicion(block.empId, candidate, block.startDate))
                        continue;
                    const newH = block.shifts.length * candidate.hours;
                    if (newH > origHCheck && (currentHours[block.empId] || 0) > targetHours)
                        continue;
                    assigned = candidate;
                    groupPool[sk]--;
                    break;
                }
                if (!assigned) {
                    if ((groupPool[block.slotKey] || 0) > 0) {
                        assigned = posProfiles[block.slotKey];
                        groupPool[block.slotKey]--;
                    }
                }
                if (!assigned) {
                    lastBlockEndDate[block.empId] = blockEndDate;
                    lastAssignedSlotKey[block.empId] = block.slotKey;
                    bloquesProcesados++;
                    continue;
                }
                const origProf2 = posProfiles[block.slotKey];
                const origH = origProf2 ? block.shifts.length * origProf2.hours : 0;
                currentHours[block.empId] = (currentHours[block.empId] || 0) - origH + block.shifts.length * assigned.hours;
                const assignedSlotKey = `${assigned.posName}__${assigned.code}`;
                let changed = false;
                for (const shift of block.shifts) {
                    if (`${shift.posName}__${shift.code}` !== assignedSlotKey) {
                        const ts = rebuildTs(shift.dateStr, assigned);
                        updates.set(shift.id, {
                            posName: assigned.posName,
                            code: assigned.code,
                            hours: assigned.hours,
                            name: assigned.name,
                            startTime: ts.startTime,
                            endTime: ts.endTime,
                        });
                        changed = true;
                    }
                }
                if (changed)
                    rotadosSet.add(block.empId);
                lastBlockEndDate[block.empId] = blockEndDate;
                lastAssignedSlotKey[block.empId] = assignedSlotKey;
                bloquesProcesados++;
            }
        }
        const HORA_TOPE = 200;
        const sobreUmbral = Object.keys(currentHours).filter(id => (currentHours[id] || 0) > HORA_TOPE);
        if (sobreUmbral.length > 0) {
            const turnosPorFecha = {};
            for (const t of allTurnos) {
                if (t.isFranco || t.isAbsence || !t.posName)
                    continue;
                if (!turnosPorFecha[t.dateStr])
                    turnosPorFecha[t.dateStr] = [];
                turnosPorFecha[t.dateStr].push(t);
            }
            const getEffectiveProf = (t) => {
                const u = updates.get(t.id);
                const sk = u ? `${u.posName}__${u.code}` : `${t.posName}__${t.code}`;
                return posProfiles[sk] || null;
            };
            const violaDiaAnterior = (empId, newProf, dateStr) => {
                const prevMs = new Date(dateStr + 'T12:00:00Z').getTime() - 86400000;
                const prevDate = new Date(prevMs).toISOString().slice(0, 10);
                const prevShift = (turnosPorFecha[prevDate] || []).find(t => t.empId === empId);
                if (!prevShift)
                    return false;
                const prevProf = getEffectiveProf(prevShift);
                return !!prevProf && prevProf.endUTCHour === newProf.startUTCHour;
            };
            for (const empId of sobreUmbral) {
                const misShifts = allTurnos
                    .filter(t => t.empId === empId && !t.isFranco && !t.isAbsence && t.posName)
                    .sort((a, b) => (getEffectiveProf(b)?.hours || 0) - (getEffectiveProf(a)?.hours || 0));
                for (const shift of misShifts) {
                    if ((currentHours[empId] || 0) <= HORA_TOPE)
                        break;
                    const profActual = getEffectiveProf(shift);
                    if (!profActual || profActual.hours <= 8)
                        continue;
                    const candidatos = (turnosPorFecha[shift.dateStr] || []).filter(other => {
                        if (other.empId === empId)
                            return false;
                        const profOther = getEffectiveProf(other);
                        if (!profOther || profOther.hours >= profActual.hours)
                            return false;
                        const nuevasHrs = (currentHours[other.empId] || 0) - profOther.hours + profActual.hours;
                        if (nuevasHrs > HORA_TOPE)
                            return false;
                        if (violaDiaAnterior(other.empId, profActual, shift.dateStr))
                            return false;
                        return true;
                    });
                    if (candidatos.length === 0)
                        continue;
                    candidatos.sort((a, b) => (currentHours[a.empId] || 0) - (currentHours[b.empId] || 0));
                    const comp = candidatos[0];
                    const profComp = getEffectiveProf(comp);
                    if (violaDiaAnterior(empId, profComp, shift.dateStr))
                        continue;
                    const tsEmp = rebuildTs(shift.dateStr, profComp);
                    const tsComp = rebuildTs(shift.dateStr, profActual);
                    updates.set(shift.id, {
                        posName: profComp.posName, code: profComp.code,
                        hours: profComp.hours, name: profComp.name,
                        startTime: tsEmp.startTime, endTime: tsEmp.endTime,
                    });
                    updates.set(comp.id, {
                        posName: profActual.posName, code: profActual.code,
                        hours: profActual.hours, name: profActual.name,
                        startTime: tsComp.startTime, endTime: tsComp.endTime,
                    });
                    currentHours[empId] = (currentHours[empId] || 0) - profActual.hours + profComp.hours;
                    currentHours[comp.empId] = (currentHours[comp.empId] || 0) - profComp.hours + profActual.hours;
                    rotadosSet.add(empId);
                    rotadosSet.add(comp.empId);
                }
            }
        }
        const turnosActualizados = updates.size;
        const horasDespues = { ...currentHours };
        const proposedChanges = [];
        for (const [docId, fields] of updates.entries()) {
            const original = allTurnos.find(t => t.id === docId);
            if (!original)
                continue;
            const toAR = (ms) => {
                const d = new Date(ms - 3 * 3600000);
                return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            };
            proposedChanges.push({
                empId: original.empId,
                dateStr: original.dateStr,
                positionName: fields.posName,
                code: fields.code,
                name: fields.name,
                hours: fields.hours,
                startTimeStr: toAR(fields.startTime.toMillis()),
                endTimeStr: toAR(fields.endTime.toMillis()),
            });
        }
        const planDocId = `${empresaId}_${objectiveId}_${year}_${month}`;
        const planDocIdLegacy = `${objectiveId}_${year}_${month}`;
        const planRef = db().collection('planificacion_estados').doc(planDocId);
        const planRefLegacy = db().collection('planificacion_estados').doc(planDocIdLegacy);
        const [planSnap, planSnapLegacy] = await Promise.all([planRef.get(), planRefLegacy.get()]);
        const isPublished = planSnap.exists || planSnapLegacy.exists;
        if (turnosActualizados === 0) {
            return { ok: true, empleadosRotados: 0, bloquesProcesados, turnosActualizados: 0,
                horasAntes, horasDespues: horasAntes, dryRun, isPublished, proposedChanges: [],
                errores: ['Las horas ya están equilibradas — no se realizaron cambios.'] };
        }
        if (dryRun) {
            return {
                ok: true,
                empleadosRotados: rotadosSet.size,
                bloquesProcesados,
                turnosActualizados,
                horasAntes,
                horasDespues,
                errores,
                dryRun: true,
                isPublished,
                proposedChanges,
            };
        }
        if (planSnap.exists)
            await planRef.delete();
        if (planSnapLegacy.exists)
            await planRefLegacy.delete();
        const entries = Array.from(updates.entries());
        const BATCH_MAX = 400;
        for (let i = 0; i < entries.length; i += BATCH_MAX) {
            const batch = db().batch();
            for (const [docId, fields] of entries.slice(i, i + BATCH_MAX)) {
                batch.update(db().collection('turnos').doc(docId), {
                    positionName: fields.posName,
                    code: fields.code,
                    name: fields.name,
                    hours: fields.hours,
                    startTime: fields.startTime,
                    endTime: fields.endTime,
                });
            }
            await batch.commit();
        }
        try {
            await db().collection('audit_logs').add({
                action: 'EQUILIBRAR_CRONOGRAMA',
                module: 'PLANIFICADOR',
                label: 'Equilibrar horas',
                detail: `${rotadosSet.size} emp. rotados · ${turnosActualizados} turnos actualizados${isPublished ? ' · plan movido a BORRADOR' : ''}`,
                empresaId,
                objectiveId,
                year,
                month,
                actor: context.auth.token?.name || context.auth.token?.email || context.auth.uid,
                actorUid: context.auth.uid,
                actorEmail: context.auth.token?.email || '',
                actorName: context.auth.token?.name || '',
                timestamp: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        catch (_logErr) {
        }
        return {
            ok: true,
            empleadosRotados: rotadosSet.size,
            bloquesProcesados,
            turnosActualizados,
            horasAntes,
            horasDespues,
            errores,
            proposedChanges,
            wasPublished: isPublished,
        };
    }
    catch (e) {
        const msg = (e instanceof functions.https.HttpsError)
            ? (() => { throw e; })()
            : (e?.message || String(e));
        return {
            ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
            horasAntes: {}, horasDespues: {}, errores: [`Error: ${msg}`],
        };
    }
};
exports.runEquilibrarCronoHandler = runEquilibrarCronoHandler;
exports.runEquilibrarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(exports.runEquilibrarCronoHandler);
//# sourceMappingURL=runEquilibrarCrono.js.map