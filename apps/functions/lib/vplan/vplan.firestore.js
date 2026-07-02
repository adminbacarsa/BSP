"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadVplanPlanningSnapshot = loadVplanPlanningSnapshot;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const planificacionEstadoKeys_1 = require("../assistant/planificacionEstadoKeys");
const vplan_calendar_1 = require("./vplan.calendar");
const vplan_positions_1 = require("./vplan.positions");
const db = () => admin.firestore();
function timestampToDate(val) {
    if (!val)
        return null;
    if (val instanceof firestore_1.Timestamp)
        return val.toDate();
    if (val instanceof Date)
        return val;
    if (typeof val === 'object' && val !== null && 'toDate' in val && typeof val.toDate === 'function') {
        return val.toDate();
    }
    if (typeof val === 'object' && val !== null && 'seconds' in val) {
        const s = Number(val.seconds);
        if (Number.isFinite(s))
            return new Date(s * 1000);
    }
    return null;
}
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
    const status = String(data.status || '').toLowerCase().trim();
    if (status === 'inactivo' || status === 'inactive')
        return false;
    if (data.activo === true)
        return true;
    if (!status || status === 'activo' || status === 'active')
        return true;
    return true;
}
function normalizeObjectiveKey(value) {
    return value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
}
async function buildObjectiveAliasIds(empresaId, canonicalObjectiveId, slaObjectiveId, objectiveNameHint) {
    const aliases = new Set();
    const add = (value) => {
        const trimmed = String(value || '').trim();
        if (trimmed)
            aliases.add(trimmed);
    };
    add(canonicalObjectiveId);
    add(slaObjectiveId);
    if (objectiveNameHint)
        add(objectiveNameHint);
    const snap = await db().collection('clients').where('empresaId', '==', empresaId).limit(40).get();
    for (const doc of snap.docs) {
        const objetivos = Array.isArray(doc.data().objetivos) ? doc.data().objetivos : [];
        for (const raw of objetivos) {
            const obj = raw;
            const keys = [String(obj?.id || '').trim(), String(obj?.name || '').trim()].filter(Boolean);
            const matchesCanonical = keys.some((key) => aliases.has(key) || normalizeObjectiveKey(key) === normalizeObjectiveKey(canonicalObjectiveId));
            if (matchesCanonical)
                keys.forEach(add);
        }
    }
    const nameHints = new Set();
    for (const alias of aliases)
        nameHints.add(normalizeObjectiveKey(alias));
    const slaSnap = await db().collection('servicios_sla').where('empresaId', '==', empresaId).get();
    const idsByNormName = new Map();
    for (const doc of slaSnap.docs) {
        const data = doc.data();
        if (!isSlaActive(data))
            continue;
        const oid = String(data.objectiveId || '').trim();
        const oname = normalizeObjectiveKey(String(data.objectiveName || data.name || ''));
        if (!oname)
            continue;
        if (!idsByNormName.has(oname))
            idsByNormName.set(oname, new Set());
        if (oid)
            idsByNormName.get(oname).add(oid);
    }
    for (const hint of nameHints) {
        const related = idsByNormName.get(hint);
        if (!related)
            continue;
        related.forEach(add);
    }
    for (const doc of slaSnap.docs) {
        const data = doc.data();
        if (!isSlaActive(data))
            continue;
        const oid = String(data.objectiveId || '').trim();
        const oname = normalizeObjectiveKey(String(data.objectiveName || data.name || ''));
        if ((oid && aliases.has(oid)) || (oname && nameHints.has(oname))) {
            if (oid)
                add(oid);
            add(data.objectiveName);
        }
    }
    return aliases;
}
function refMatchesObjective(ref, objectiveAliases, slaIdToObjectiveId) {
    const trimmed = String(ref || '').trim();
    if (!trimmed)
        return false;
    if (objectiveAliases.has(trimmed))
        return true;
    const mapped = slaIdToObjectiveId[trimmed];
    if (mapped && objectiveAliases.has(mapped))
        return true;
    const norm = normalizeObjectiveKey(trimmed);
    for (const alias of objectiveAliases) {
        if (normalizeObjectiveKey(alias) === norm)
            return true;
    }
    return false;
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
        slaObjectiveId: String(sla.objectiveId || objectiveId),
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
async function buildSlaIdToObjectiveId(empresaId) {
    const snap = await db()
        .collection('servicios_sla')
        .where('empresaId', '==', empresaId)
        .get();
    const map = {};
    snap.docs.forEach((doc) => {
        const d = doc.data();
        if (!isSlaActive(d))
            return;
        const objId = String(d.objectiveId || '');
        if (objId)
            map[doc.id] = objId;
    });
    return map;
}
function employeeMatchesObjective(employeeId, data, objectiveAliases, slaIdToObjectiveId, planningEmployeeIds) {
    if (planningEmployeeIds.has(employeeId))
        return true;
    const dotacion = data.planificacionDotacion;
    if (dotacion && typeof dotacion === 'object') {
        for (const [objKey, cfg] of Object.entries(dotacion)) {
            if (cfg?.positionName && refMatchesObjective(objKey, objectiveAliases, slaIdToObjectiveId)) {
                return true;
            }
        }
    }
    const pref = String(data.preferredObjectiveId || '').trim();
    if (!pref)
        return false;
    return refMatchesObjective(pref, objectiveAliases, slaIdToObjectiveId);
}
async function loadEmployees(empresaId, objectiveAliases, opts) {
    const snap = await db()
        .collection('empleados')
        .where('empresaId', '==', empresaId)
        .get();
    const allowSet = opts.employeeIds?.length ? new Set(opts.employeeIds) : null;
    const scope = opts.supplyScope ?? 'objective';
    const slaMap = opts.slaIdToObjectiveId ?? {};
    const planningIds = opts.planningEmployeeIds ?? new Set();
    return snap.docs
        .filter((doc) => {
        if (allowSet && !allowSet.has(doc.id))
            return false;
        const data = doc.data();
        if (!isEmployeeActive(data))
            return false;
        if (scope === 'empresa')
            return true;
        return employeeMatchesObjective(doc.id, data, objectiveAliases, slaMap, planningIds);
    })
        .map((doc) => {
        const data = doc.data();
        const first = String(data.firstName || data.nombre || '').trim();
        const last = String(data.lastName || data.apellido || '').trim();
        const composed = [last, first].filter(Boolean).join(', ');
        return {
            id: doc.id,
            displayName: composed || String(data.fullName || data.name || doc.id),
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
async function loadPlanningState(empresaId, objectiveId, year, month) {
    const docIds = (0, planificacionEstadoKeys_1.planificacionEstadoLookupDocIds)(empresaId, objectiveId, year, month);
    for (const key of docIds) {
        const snap = await db().collection('planificacion_estados').doc(key).get();
        if (!snap.exists)
            continue;
        const d = snap.data() || {};
        const defaultPositionByEmp = d.defaultPositionByEmp || {};
        if (Object.keys(defaultPositionByEmp).length === 0)
            continue;
        return {
            defaultPositionByEmp,
            defaultShiftByEmp: d.defaultShiftByEmp || {},
            trailingWorkDays: d.trailingWorkDays,
            trailingRestDays: d.trailingRestDays,
            lastShiftByEmp: d.lastShiftByEmp,
            lastWorkBandBeforeRest: d.lastWorkBandBeforeRest,
        };
    }
    return emptyPlanningState();
}
function dateStrFromTimestamp(ts) {
    if (!ts)
        return null;
    if (typeof ts === 'string')
        return ts.slice(0, 10);
    const d = timestampToDate(ts);
    if (!d || Number.isNaN(d.getTime()))
        return null;
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
    const days = (0, vplan_calendar_1.buildMonthDays)(request.year, request.month);
    const prev = (0, vplan_calendar_1.previousMonth)(request.year, request.month);
    const prevKey = `${request.objectiveId}_${prev.year}_${prev.month}`;
    const [objectiveAliases, slaIdToObjectiveId, planningState, prevPlanningState, absences] = await Promise.all([
        buildObjectiveAliasIds(request.empresaId, request.objectiveId, sla.slaObjectiveId, objectiveName),
        buildSlaIdToObjectiveId(request.empresaId),
        loadPlanningState(request.empresaId, request.objectiveId, request.year, request.month),
        loadPlanningState(request.empresaId, request.objectiveId, prev.year, prev.month),
        loadAbsences(request.empresaId, request.year, request.month),
    ]);
    const planningEmployeeIds = new Set([
        ...Object.keys(planningState.defaultPositionByEmp || {}),
        ...Object.keys(prevPlanningState.defaultPositionByEmp || {}),
    ]);
    const employees = await loadEmployees(request.empresaId, objectiveAliases, {
        employeeIds: request.employeeIds,
        supplyScope: request.supplyScope,
        slaIdToObjectiveId,
        planningEmployeeIds,
    });
    const existingAssignments = await loadExistingAssignments(request.objectiveId, request.year, request.month);
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