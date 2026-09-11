"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAutoSchedule = exports.runAutoScheduleHandler = void 0;
exports.runAutoScheduleCore = runAutoScheduleCore;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const autoScheduleEngine_1 = require("./autoScheduleEngine");
const db = () => admin.firestore();
function buildDaysInMonth(year, month) {
    const days = [];
    const last = new Date(Date.UTC(year, month, 0)).getDate();
    for (let d = 1; d <= last; d++) {
        days.push(new Date(Date.UTC(year, month - 1, d, 12, 0, 0)));
    }
    return days;
}
function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
async function loadPositionsFromSla(objectiveId) {
    const snap = await db()
        .collection('servicios_sla')
        .where('objectiveId', '==', objectiveId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty)
        throw new functions.https.HttpsError('not-found', `No hay SLA activo para el objetivo ${objectiveId}`);
    const sla = snap.docs[0].data();
    const rawPositions = sla.positions || [];
    const slaVendidas = Number(sla.totalMonthlyHours || 0);
    const codeHoursHint = {};
    const positions = rawPositions.map((p) => {
        const shifts = (p.allowedShiftTypes || p.shifts || []).map((s) => {
            const code = String(s.code || '').toUpperCase();
            const hours = Number(s.hours) || 8;
            if (code && hours > 0)
                codeHoursHint[code] = hours;
            return { code, name: s.name, hours, startTime: s.startTime, endTime: s.endTime, days: s.days };
        });
        return {
            positionName: String(p.name || p.positionName || ''),
            qty: Number(p.quantity || p.qty) || 1,
            shifts,
            activeDays: p.activeDays,
            coverageType: p.coverageType,
            excludedDates: p.excludedDates,
        };
    });
    return { positions, slaVendidas, codeHoursHint };
}
async function loadEmployees(empresaId, objectiveId) {
    const snap = await db()
        .collection('empleados')
        .where('empresaId', '==', empresaId)
        .where('activo', '==', true)
        .get();
    return snap.docs
        .filter(doc => {
        const d = doc.data();
        return !d.preferredObjectiveId || d.preferredObjectiveId === objectiveId;
    })
        .map(doc => ({
        id: doc.id,
        nombre: doc.data().nombre || doc.data().name || doc.id,
    }));
}
async function loadAbsences(objectiveId, empresaId, year, month) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const snap = await db()
        .collection('ausencias')
        .where('empresaId', '==', empresaId)
        .where('startDate', '<=', monthEnd)
        .where('endDate', '>=', monthStart)
        .get();
    const result = {};
    snap.docs.forEach(doc => {
        const d = doc.data();
        const empId = d.employeeId || d.empId;
        if (!empId)
            return;
        if (!result[empId])
            result[empId] = new Set();
        const start = new Date(d.startDate + 'T12:00:00Z');
        const end = new Date(d.endDate + 'T12:00:00Z');
        for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
            const dk = dateKey(cur);
            if (dk >= monthStart && dk <= monthEnd)
                result[empId].add(dk);
        }
    });
    return result;
}
async function loadPlanningState(objectiveId, year, month) {
    const key = `${objectiveId}_${year}_${month}`;
    const snap = await db().collection('planificacion_estados').doc(key).get();
    const d = snap.data() || {};
    return {
        defaultPositionByEmp: d.defaultPositionByEmp || {},
        defaultShiftByEmp: d.defaultShiftByEmp || {},
        trailingWorkDays: d.trailingWorkDays,
        trailingRestDays: d.trailingRestDays,
        lastShiftByEmp: d.lastShiftByEmp,
        lastWorkBandBeforeRest: d.lastWorkBandBeforeRest,
    };
}
function BANDS_12H_set() { return new Set(['D12', 'N12']); }
function is24hs(pos) {
    const c = String(pos.coverageType || '').toLowerCase();
    return c === '24hs' || c === '24' || c === '24h';
}
function posCapacity(pos) {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const sevenDays = !Array.isArray(pos.activeDays) || pos.activeDays.length >= 7;
    const WORK_BANDS = new Set(['M', 'T', 'N']);
    if (is24hs(pos) && sevenDays) {
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        return qty * (codes.length > 0 && codes.every(c => BANDS_12H_set().has(c)) ? 3 : 4);
    }
    if (sevenDays) {
        const activeBands = (pos.shifts || []).filter(s => WORK_BANDS.has(String(s.code || '').toUpperCase())).length;
        if (activeBands === 0)
            return qty;
        return qty * Math.max(1, activeBands) * 2;
    }
    return qty;
}
function buildStaffingNeeds(positions, positionGroups) {
    return positions.map(pos => {
        const needed = posCapacity(pos);
        const assigned = (positionGroups[pos.positionName] || []).length;
        return {
            positionName: pos.positionName,
            qty: Number(pos.qty) || 1,
            employeesNeeded: needed,
            employeesAssigned: assigned,
            gap: Math.max(0, needed - assigned),
        };
    });
}
const RUNTIME = { timeoutSeconds: 120, memory: '512MB' };
async function runAutoScheduleCore(data) {
    const { objectiveId, year, month, empresaId, options } = data;
    if (!objectiveId || !year || !month || !empresaId) {
        throw new Error('objectiveId, year, month y empresaId son requeridos.');
    }
    if (month < 1 || month > 12)
        throw new Error('month debe ser 1-12.');
    const [{ positions, slaVendidas, codeHoursHint }, employees,] = await Promise.all([
        loadPositionsFromSla(objectiveId),
        loadEmployees(empresaId, objectiveId),
    ]);
    if (positions.length === 0)
        throw new Error('El SLA no tiene puestos definidos.');
    const daysInMonth = buildDaysInMonth(year, month);
    const currentState = await loadPlanningState(objectiveId, year, month);
    let defaultPositionByEmp = currentState.defaultPositionByEmp;
    let defaultShiftByEmp = currentState.defaultShiftByEmp;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevState = await loadPlanningState(objectiveId, prevYear, prevMonth);
    if (Object.keys(defaultPositionByEmp).length === 0 && Object.keys(prevState.defaultPositionByEmp).length > 0) {
        defaultPositionByEmp = prevState.defaultPositionByEmp;
        defaultShiftByEmp = prevState.defaultShiftByEmp;
    }
    const absencesRaw = await loadAbsences(objectiveId, empresaId, year, month);
    const absences = absencesRaw;
    const ctx = {
        positions,
        employees,
        daysInMonth,
        slaVendidas,
        autoCycles: ['6+2'],
        absences,
        defaultPositionByEmp,
        defaultShiftByEmp,
        prevMonthTrailingWorkDays: prevState.trailingWorkDays,
        prevMonthTrailingRestDays: prevState.trailingRestDays,
        prevMonthLastShiftByEmp: prevState.lastShiftByEmp,
        prevMonthLastWorkBandBeforeRest: prevState.lastWorkBandBeforeRest,
        cctCutoffDay: options?.cctCutoffDay ?? 25,
        codeHoursHint,
    };
    const result = (0, autoScheduleEngine_1.generateSchedule)(ctx);
    const coverage = (0, autoScheduleEngine_1.verifyCoverage)(ctx, result.assignments);
    const staffingNeeds = buildStaffingNeeds(positions, result.stats.positionGroups);
    return {
        ok: coverage.uncoveredSlots === 0 && coverage.slaHoursClosed,
        assignments: result.assignments,
        stats: result.stats,
        coverage,
        staffingNeeds,
        meta: {
            objectiveId,
            year,
            month,
            employeeCount: employees.length,
            positionCount: positions.length,
            generatedAt: new Date().toISOString(),
        },
    };
}
const runAutoScheduleHandler = async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }
    try {
        return await runAutoScheduleCore(data);
    }
    catch (e) {
        const msg = String(e?.message ?? e ?? 'Error en autoSchedule');
        if (msg.includes('requeridos') || msg.includes('1-12')) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        if (msg.includes('puestos definidos')) {
            throw new functions.https.HttpsError('failed-precondition', msg);
        }
        throw new functions.https.HttpsError('internal', msg);
    }
};
exports.runAutoScheduleHandler = runAutoScheduleHandler;
exports.runAutoSchedule = functions
    .runWith(RUNTIME)
    .https.onCall(exports.runAutoScheduleHandler);
//# sourceMappingURL=runAutoSchedule.js.map