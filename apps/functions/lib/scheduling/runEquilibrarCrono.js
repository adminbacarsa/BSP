"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEquilibrarCrono = exports.runEquilibrarCronoHandler = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const db = () => admin.firestore();
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
        start: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, m, 1, 0, 0, 0))),
        end: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, m + 1, 2, 23, 59, 59))),
    };
}
function rebuildTs(dateStr, prof) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, d, prof.startUTCHour, 0, 0));
    const endDayOffset = prof.endNextDay ? d + 1 : d;
    const endDate = new Date(Date.UTC(y, m - 1, endDayOffset, prof.endUTCHour, 0, 0));
    return {
        startTime: admin.firestore.Timestamp.fromDate(startDate),
        endTime: admin.firestore.Timestamp.fromDate(endDate),
    };
}
const RUNTIME = { timeoutSeconds: 180, memory: '512MB' };
const runEquilibrarCronoHandler = async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }
    const { empresaId, objectiveId, year, month } = data;
    if (!empresaId || !objectiveId || !year || !month || month < 1 || month > 12) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, year y month (1–12) son requeridos.');
    }
    const errores = [];
    const bounds = monthBoundsAR(year, month);
    const snap = await db().collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('startTime', '>=', bounds.start)
        .where('startTime', '<=', bounds.end)
        .get();
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
            hours: Number(d.hours) || 0,
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
    const posQtyByDay = {};
    for (const t of allTurnos) {
        if (t.isFranco || t.isAbsence || !t.posName)
            continue;
        if (!posProfiles[t.posName]) {
            const startD = t.startTime.toDate();
            const endD = t.endTime.toDate();
            const endNextDay = endD.getUTCDate() !== startD.getUTCDate()
                || endD.getUTCMonth() !== startD.getUTCMonth();
            posProfiles[t.posName] = {
                posName: t.posName,
                code: t.code,
                hours: t.hours,
                name: t.name,
                startUTCHour: startD.getUTCHours(),
                endUTCHour: endD.getUTCHours(),
                endNextDay,
            };
        }
        if (!posQtyByDay[t.posName])
            posQtyByDay[t.posName] = {};
        if (!posQtyByDay[t.posName][t.dateStr])
            posQtyByDay[t.posName][t.dateStr] = new Set();
        posQtyByDay[t.posName][t.dateStr].add(t.empId);
    }
    const posQty = {};
    for (const [posName, byDay] of Object.entries(posQtyByDay)) {
        posQty[posName] = Math.max(...Object.values(byDay).map(s => s.size));
    }
    const positions = Object.values(posProfiles);
    if (positions.length < 2) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
            horasAntes: {}, horasDespues: {}, errores: ['Se necesitan al menos 2 posiciones para equilibrar.'] };
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
                allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur });
                cur = [work[i]];
            }
        }
        allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur });
    }
    if (allBlocks.length === 0) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
            horasAntes, horasDespues: horasAntes, errores: ['No se detectaron bloques de trabajo.'] };
    }
    const slotsAvail = {};
    for (const t of allTurnos) {
        if (t.isFranco || t.isAbsence || !t.posName)
            continue;
        if (!slotsAvail[t.posName])
            slotsAvail[t.posName] = {};
        slotsAvail[t.posName][t.dateStr] = (slotsAvail[t.posName][t.dateStr] || 0) + 1;
    }
    const sortedPos = [...positions].sort((a, b) => b.hours - a.hours);
    const blockQueue = [...allBlocks];
    const updates = new Map();
    const rotadosSet = new Set();
    let bloquesProcesados = 0;
    const runningHours = {};
    while (blockQueue.length > 0) {
        blockQueue.sort((a, b) => {
            const ha = runningHours[a.empId] || 0;
            const hb = runningHours[b.empId] || 0;
            return ha !== hb ? ha - hb : a.startDate.localeCompare(b.startDate);
        });
        const block = blockQueue.shift();
        const blockDates = block.shifts.map(s => s.dateStr);
        let assignedPos = null;
        for (const pos of sortedPos) {
            if (blockDates.every(d => (slotsAvail[pos.posName]?.[d] ?? 0) > 0)) {
                assignedPos = pos;
                break;
            }
        }
        if (!assignedPos) {
            for (let pi = sortedPos.length - 1; pi >= 0; pi--) {
                if (blockDates.every(d => (slotsAvail[sortedPos[pi].posName]?.[d] ?? 0) > 0)) {
                    assignedPos = sortedPos[pi];
                    break;
                }
            }
        }
        if (!assignedPos) {
            const orig = posProfiles[block.shifts[0]?.posName];
            if (orig) {
                runningHours[block.empId] = (runningHours[block.empId] || 0)
                    + block.shifts.length * orig.hours;
            }
            bloquesProcesados++;
            continue;
        }
        for (const shift of block.shifts) {
            if (slotsAvail[assignedPos.posName]?.[shift.dateStr] !== undefined)
                slotsAvail[assignedPos.posName][shift.dateStr]--;
            if (shift.posName !== assignedPos.posName) {
                const ts = rebuildTs(shift.dateStr, assignedPos);
                updates.set(shift.id, {
                    posName: assignedPos.posName,
                    code: assignedPos.code,
                    hours: assignedPos.hours,
                    name: assignedPos.name,
                    startTime: ts.startTime,
                    endTime: ts.endTime,
                });
                rotadosSet.add(block.empId);
            }
        }
        runningHours[block.empId] = (runningHours[block.empId] || 0)
            + block.shifts.length * assignedPos.hours;
        bloquesProcesados++;
    }
    const turnosActualizados = updates.size;
    if (turnosActualizados === 0) {
        return { ok: true, empleadosRotados: 0, bloquesProcesados, turnosActualizados: 0,
            horasAntes, horasDespues: horasAntes,
            errores: ['Las horas ya están equilibradas — no se realizaron cambios.'] };
    }
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
    const horasDespues = { ...horasAntes };
    for (const [docId, fields] of updates.entries()) {
        const original = allTurnos.find(t => t.id === docId);
        if (original && fields.hours !== undefined) {
            horasDespues[original.empId] = (horasDespues[original.empId] || 0)
                + (fields.hours - original.hours);
        }
    }
    return {
        ok: true,
        empleadosRotados: rotadosSet.size,
        bloquesProcesados,
        turnosActualizados,
        horasAntes,
        horasDespues,
        errores,
    };
};
exports.runEquilibrarCronoHandler = runEquilibrarCronoHandler;
exports.runEquilibrarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(exports.runEquilibrarCronoHandler);
//# sourceMappingURL=runEquilibrarCrono.js.map