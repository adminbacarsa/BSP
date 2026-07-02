"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadVplanPlanningSnapshot = loadVplanPlanningSnapshot;
const admin = require("firebase-admin");
const vplan_calendar_1 = require("./vplan.calendar");
const vplan_positions_1 = require("./vplan.positions");
const db = () => admin.firestore();
function isSlaActive(data) {
    const status = String(data.status || '').toLowerCase();
    if (status === 'inactive')
        return false;
    if (status === 'active')
        return true;
    if (data.active === false)
        return false;
    return true;
}
function isEmployeeActive(data) {
    if (data.activo === false)
        return false;
    const status = String(data.status || '').toUpperCase();
    if (status === 'INACTIVE')
        return false;
    return data.activo === true || status === 'ACTIVE' || status === '';
}
async function loadSlaForObjective(objectiveId, empresaId) {
    const snap = await db()
        .collection('servicios_sla')
        .where('objectiveId', '==', objectiveId)
        .get();
    const docs = snap.docs.filter((d) => {
        const data = d.data();
        if (empresaId && data.empresaId && data.empresaId !== empresaId)
            return false;
        return isSlaActive(data);
    });
    if (docs.length === 0) {
        throw new Error(`No hay SLA activo para el objetivo ${objectiveId}`);
    }
    const doc = docs[0];
    const sla = doc.data();
    return {
        slaId: doc.id,
        slaVendidas: Math.max(0, Number(sla.totalMonthlyHours) || 0),
        positions: (0, vplan_positions_1.normalizeSlaPositions)(sla.positions || []),
        objectiveName: sla.objectiveName ? String(sla.objectiveName) : undefined,
    };
}
async function resolveObjectiveName(objectiveId, empresaId) {
    const snap = await db().collection('clients').where('empresaId', '==', empresaId).limit(40).get();
    for (const doc of snap.docs) {
        const objs = Array.isArray(doc.data().objetivos) ? doc.data().objetivos : [];
        const found = objs.find((o) => o?.id === objectiveId || o?.name === objectiveId);
        if (found)
            return String(found.name || found.id || objectiveId);
    }
    return undefined;
}
async function loadEmployees(empresaId, objectiveId, employeeIds) {
    const snap = await db()
        .collection('empleados')
        .where('empresaId', '==', empresaId)
        .get();
    const allowSet = employeeIds?.length ? new Set(employeeIds) : null;
    return snap.docs
        .filter((doc) => {
        if (allowSet && !allowSet.has(doc.id))
            return false;
        const data = doc.data();
        if (!isEmployeeActive(data))
            return false;
        const pref = data.preferredObjectiveId;
        return !pref || pref === objectiveId;
    })
        .map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            displayName: String(data.nombre || data.fullName || data.name || doc.id),
            priorCctHours: Math.max(0, Number(data.priorCctHours ?? data.horasCiclo ?? data.horasMes) || 0),
        };
    });
}
async function loadAbsences(empresaId, year, month) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const snap = await db()
        .collection('ausencias')
        .where('empresaId', '==', empresaId)
        .where('startDate', '<=', monthEnd)
        .where('endDate', '>=', monthStart)
        .get();
    const result = {};
    snap.docs.forEach((doc) => {
        const d = doc.data();
        const empId = String(d.employeeId || d.empId || '');
        if (!empId)
            return;
        const startStr = String(d.startDate || '').slice(0, 10);
        const endStr = String(d.endDate || '').slice(0, 10);
        if (!startStr || !endStr)
            return;
        if (!result[empId])
            result[empId] = new Set();
        const start = new Date(`${startStr}T12:00:00`);
        const end = new Date(`${endStr}T12:00:00`);
        for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
            const y = cur.getFullYear();
            const m = String(cur.getMonth() + 1).padStart(2, '0');
            const day = String(cur.getDate()).padStart(2, '0');
            const dk = `${y}-${m}-${day}`;
            if (dk >= monthStart && dk <= monthEnd)
                result[empId].add(dk);
        }
    });
    return result;
}
function emptyPlanningState() {
    return {
        defaultPositionByEmp: {},
        defaultShiftByEmp: {},
    };
}
async function loadPlanningState(objectiveId, year, month) {
    const key = `${objectiveId}_${year}_${month}`;
    const snap = await db().collection('planificacion_estados').doc(key).get();
    if (!snap.exists)
        return emptyPlanningState();
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
function dateStrFromTimestamp(ts) {
    if (!ts)
        return null;
    if (typeof ts === 'string')
        return ts.slice(0, 10);
    const d = ts instanceof admin.firestore.Timestamp ? ts.toDate() : ts;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
async function loadExistingAssignments(objectiveId, year, month) {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const snap = await db()
        .collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .get();
    const result = [];
    snap.docs.forEach((doc) => {
        const d = doc.data();
        if (d.draft === true)
            return;
        const dateStr = dateStrFromTimestamp(d.startTime)
            ?? String(d.dateStr || d.date || '').slice(0, 10);
        if (!dateStr.startsWith(monthPrefix))
            return;
        const employeeId = String(d.employeeId || d.empId || '');
        if (!employeeId)
            return;
        result.push({
            employeeId,
            dateStr,
            code: String(d.code || d.shiftCode || 'M').toUpperCase(),
            positionName: String(d.positionName || d.puesto || ''),
            hours: Number(d.hours) || undefined,
        });
    });
    return result;
}
async function loadVplanPlanningSnapshot(request) {
    const sla = await loadSlaForObjective(request.objectiveId, request.empresaId);
    const objectiveName = sla.objectiveName ?? await resolveObjectiveName(request.objectiveId, request.empresaId);
    const employees = await loadEmployees(request.empresaId, request.objectiveId, request.employeeIds);
    const absences = await loadAbsences(request.empresaId, request.year, request.month);
    const days = (0, vplan_calendar_1.buildMonthDays)(request.year, request.month);
    const prev = (0, vplan_calendar_1.previousMonth)(request.year, request.month);
    const prevKey = `${request.objectiveId}_${prev.year}_${prev.month}`;
    const [planningState, prevPlanningState, existingAssignments] = await Promise.all([
        loadPlanningState(request.objectiveId, request.year, request.month),
        loadPlanningState(request.objectiveId, prev.year, prev.month),
        loadExistingAssignments(request.objectiveId, request.year, request.month),
    ]);
    let mergedPlanning = planningState;
    if (Object.keys(planningState.defaultPositionByEmp).length === 0
        && Object.keys(prevPlanningState.defaultPositionByEmp).length > 0) {
        mergedPlanning = {
            ...planningState,
            defaultPositionByEmp: prevPlanningState.defaultPositionByEmp,
            defaultShiftByEmp: prevPlanningState.defaultShiftByEmp,
        };
    }
    return {
        empresaId: request.empresaId,
        objectiveId: request.objectiveId,
        objectiveName,
        slaId: sla.slaId,
        slaVendidas: sla.slaVendidas,
        positions: sla.positions,
        employees,
        absences,
        days,
        previousMonthStateKey: prevKey,
        planningState: mergedPlanning,
        prevPlanningState,
        existingAssignments,
    };
}
//# sourceMappingURL=vplan.firestore.js.map