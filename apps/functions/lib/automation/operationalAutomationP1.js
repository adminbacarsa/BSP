"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendCoverageCandidates = recommendCoverageCandidates;
exports.runDailyReplanWindow = runDailyReplanWindow;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const eligibilityFilter_1 = require("../coverage/eligibilityFilter");
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'M1', 'T1', 'N1', 'REF', 'ESC', 'EN', 'RO']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const COST_BY_STEP = {
    SIN_TURNO: 10,
    RET: 20,
    ESC: 30,
    CROSS_POS: 40,
    EXT_DUAL: 55,
    INTERCAMBIO: 60,
    CROSS_OBJ: 70,
    FT: 90,
};
function nowIso() {
    return new Date().toISOString();
}
function normalizeCode(raw) {
    return String(raw ?? '').trim().toUpperCase();
}
function dayStartArUtc(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}
function dayEndArUtc(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 0, 0));
}
function arYmdFromTs(ts) {
    const ms = ts.toMillis() - 3 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
}
function todayArYmd() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
function addDaysYmd(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function empDisplayName(emp) {
    const ln = String(emp.lastName ?? '').trim();
    const fn = String(emp.firstName ?? '').trim();
    const joined = [ln, fn].filter(Boolean).join(', ');
    if (joined)
        return joined;
    return String(emp.name ?? emp.fullName ?? emp.id);
}
function empCoords(emp) {
    const lat = Number(emp.lat ?? emp.location?.lat);
    const lng = Number(emp.lng ?? emp.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return null;
    return { lat, lng };
}
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function knowledgeScore(emp, objectiveId) {
    if (String(emp.preferredObjectiveId ?? '') === objectiveId)
        return 3;
    if (emp.experienciaObjetivos?.[objectiveId])
        return 2;
    if (Array.isArray(emp.volante) && emp.volante.includes(objectiveId))
        return 1;
    return 0;
}
async function resolveObjectiveCoords(db, objectiveId, clientId) {
    const tryObj = (o) => {
        const lat = Number(o?.lat ?? o?.location?.lat ?? o?.geo?.lat);
        const lng = Number(o?.lng ?? o?.location?.lng ?? o?.geo?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            return null;
        return { lat, lng };
    };
    if (clientId) {
        const snap = await db.collection('clients').doc(clientId).get();
        if (snap.exists) {
            const objs = Array.isArray(snap.data()?.objetivos) ? snap.data().objetivos : [];
            const hit = objs.find((o) => String(o.id || o.objectiveId || '') === objectiveId);
            const c = tryObj(hit);
            if (c)
                return c;
        }
    }
    const clients = await db.collection('clients').where('empresaId', '==', arguments[0] ? '' : '').limit(1).get();
    void clients;
    const all = await db.collection('clients').limit(120).get();
    for (const cdoc of all.docs) {
        const objs = Array.isArray(cdoc.data()?.objetivos) ? cdoc.data().objetivos : [];
        const hit = objs.find((o) => String(o.id || o.objectiveId || '') === objectiveId);
        const c = tryObj(hit);
        if (c)
            return c;
    }
    return null;
}
function isOperationalCoverage(row) {
    return (row.origin === 'OPERATIONS_COVERAGE' ||
        row.origin === 'RETEN' ||
        row.resolvedBy === 'OPERACIONES' ||
        row.isReten === true);
}
function coverageKey(objectiveId, code, date) {
    return `${objectiveId}__${code}__${date}`;
}
async function loadShiftById(empresaId, shiftId) {
    const snap = await admin.firestore().collection('turnos').doc(shiftId).get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    const emp = String(data.empresaId ?? '').trim();
    if (emp && emp !== empresaId)
        return null;
    return { ...data, id: snap.id };
}
async function loadEmployees(empresaId) {
    const snap = await admin.firestore().collection('empleados').where('empresaId', '==', empresaId).limit(900).get();
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => {
        const st = String(e.status ?? e.estado ?? 'ACTIVE').toUpperCase();
        return st !== 'INACTIVE' && st !== 'INACTIVO';
    });
}
async function loadDayShifts(empresaId, fecha, objectiveId) {
    const db = admin.firestore();
    const start = firestore_1.Timestamp.fromDate(dayStartArUtc(fecha));
    const end = firestore_1.Timestamp.fromDate(dayEndArUtc(fecha));
    let q = db
        .collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('startTime', '>=', start)
        .where('startTime', '<', end)
        .limit(1800);
    if (objectiveId)
        q = q.where('objectiveId', '==', objectiveId);
    try {
        const snap = await q.get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    catch {
        const snap = await db.collection('turnos').where('empresaId', '==', empresaId).limit(3000).get();
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => {
            const st = t.startTime instanceof firestore_1.Timestamp ? t.startTime : null;
            if (!st)
                return false;
            const ms = st.toMillis();
            if (ms < start.toMillis() || ms >= end.toMillis())
                return false;
            if (objectiveId && String(t.objectiveId ?? '') !== objectiveId)
                return false;
            return true;
        });
    }
}
function buildCandidate(emp, step, opts) {
    const eligibility = (0, eligibilityFilter_1.checkEligibility)(emp, { objectiveId: opts.objectiveId }, step === 'EXT_DUAL' ? 'EXTEND' : step, opts.distanceKm ?? undefined, step === 'RET' ? eligibilityFilter_1.RET_RADIUS_KM_EXPANDED : eligibilityFilter_1.RET_RADIUS_KM_PRIMARY);
    if (!eligibility.eligible)
        return null;
    const know = knowledgeScore(emp, opts.objectiveId);
    const costScore = COST_BY_STEP[step];
    const hours = Number(opts.monthlyHours ?? 0);
    const riskHours = hours > 180 ? Math.min(40, hours - 180) : 0;
    const riskDistance = opts.distanceKm != null && Number.isFinite(opts.distanceKm)
        ? Math.max(0, opts.distanceKm - eligibilityFilter_1.RET_RADIUS_KM_PRIMARY) * 1.5
        : 8;
    const riskScore = Math.round(riskHours + riskDistance + (step === 'FT' ? 15 : 0));
    const score = Math.round(1000 - costScore * 8 - riskScore * 2 + know * 18);
    return {
        employeeId: emp.id,
        employeeName: empDisplayName(emp),
        cascadeStep: step,
        cascadeRank: eligibilityFilter_1.CASCADE_ORDER.indexOf(step),
        score,
        costScore,
        riskScore,
        knowledgeScore: know,
        distanceKm: opts.distanceKm,
        reason: `${step} · costo ${costScore} · riesgo ${riskScore} · conocimiento ${know}`,
        sourceShiftId: opts.sourceShiftId,
        sourceCode: opts.sourceCode,
    };
}
async function recommendCoverageCandidates(input) {
    const empresaId = String(input.empresaId || '').trim();
    if (!empresaId)
        throw new Error('empresaId requerido.');
    let shift = null;
    if (input.shiftId) {
        shift = await loadShiftById(empresaId, String(input.shiftId));
        if (!shift)
            throw new Error(`Turno ${input.shiftId} no encontrado.`);
    }
    const objectiveId = String(input.objectiveId || shift?.objectiveId || '').trim();
    if (!objectiveId)
        throw new Error('objectiveId o shiftId requerido.');
    const startTs = shift?.startTime instanceof firestore_1.Timestamp ? shift.startTime : null;
    const fecha = String(input.fecha || (startTs ? arYmdFromTs(startTs) : todayArYmd())).slice(0, 10);
    const banda = normalizeCode(input.banda || shift?.code || 'M') || 'M';
    const objectiveName = String(shift?.objectiveName || shift?.objetivoNombre || objectiveId);
    const clientId = String(shift?.clientId || '').trim();
    const urgency = startTs ? (0, eligibilityFilter_1.getUrgency)(startTs) : 'NORMAL';
    const limite = Math.max(3, Math.min(40, Number(input.limite ?? 12)));
    const [emps, dayShifts, objCoords] = await Promise.all([
        loadEmployees(empresaId),
        loadDayShifts(empresaId, fecha, undefined),
        resolveObjectiveCoords(admin.firestore(), objectiveId, clientId || undefined),
    ]);
    const byEmp = new Map();
    for (const t of dayShifts) {
        const empId = String(t.employeeId || '').trim();
        if (!empId)
            continue;
        if (!byEmp.has(empId))
            byEmp.set(empId, []);
        byEmp.get(empId).push(t);
    }
    const coveredKeys = new Set();
    for (const t of dayShifts) {
        if (isOperationalCoverage(t) && t.isAbsent !== true) {
            const st = t.startTime instanceof firestore_1.Timestamp ? t.startTime : null;
            if (!st)
                continue;
            coveredKeys.add(coverageKey(String(t.objectiveId || ''), normalizeCode(t.code), arYmdFromTs(st)));
        }
    }
    const candidates = [];
    const notes = [];
    for (const emp of emps) {
        const shifts = byEmp.get(emp.id) || [];
        const coords = empCoords(emp);
        const distanceKm = objCoords && coords ? haversineKm(objCoords.lat, objCoords.lng, coords.lat, coords.lng) : null;
        const monthlyHours = Number(emp.hoursMonth || emp.horasMes || 0);
        if (shifts.length === 0) {
            const c = buildCandidate(emp, 'SIN_TURNO', { objectiveId, distanceKm, monthlyHours });
            if (c)
                candidates.push(c);
            continue;
        }
        for (const sh of shifts) {
            if (sh.draft === true || sh.isAbsent === true || sh.isCompleted === true)
                continue;
            const code = normalizeCode(sh.code);
            if (code === 'RET') {
                const c = buildCandidate(emp, 'RET', {
                    objectiveId,
                    distanceKm,
                    monthlyHours,
                    sourceShiftId: sh.id,
                    sourceCode: code,
                });
                if (c)
                    candidates.push(c);
            }
            else if (code === 'ESC' || code === 'REF') {
                if (String(sh.objectiveId || '') === objectiveId) {
                    const c = buildCandidate(emp, 'ESC', {
                        objectiveId,
                        distanceKm,
                        monthlyHours,
                        sourceShiftId: sh.id,
                        sourceCode: code,
                    });
                    if (c)
                        candidates.push(c);
                }
            }
            else if (FRANCO_CODES.has(code)) {
                const c = buildCandidate(emp, 'FT', {
                    objectiveId,
                    distanceKm,
                    monthlyHours,
                    sourceShiftId: sh.id,
                    sourceCode: code,
                });
                if (c)
                    candidates.push(c);
            }
            else if (WORK_CODES.has(code) && ['M', 'T', 'N'].includes(code)) {
                const c = buildCandidate(emp, 'EXT_DUAL', {
                    objectiveId,
                    distanceKm,
                    monthlyHours,
                    sourceShiftId: sh.id,
                    sourceCode: code,
                });
                if (c)
                    candidates.push(c);
            }
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.cascadeRank - b.cascadeRank || a.costScore - b.costScore);
    const top = candidates.slice(0, limite);
    if (!top.length)
        notes.push('Sin candidatos elegibles según cascada CCT y restricciones.');
    if (coveredKeys.has(coverageKey(objectiveId, banda, fecha))) {
        notes.push('Ya existe cobertura operativa para ese slot (se recomienda igual para backup).');
    }
    return {
        ok: true,
        empresaId,
        shiftId: shift?.id || null,
        objectiveId,
        objectiveName,
        fecha,
        banda,
        urgency,
        candidates: top,
        generatedAt: nowIso(),
        notes,
    };
}
async function findWindowVacancies(empresaId, fromYmd, toYmd, objectiveId) {
    const db = admin.firestore();
    const start = firestore_1.Timestamp.fromDate(dayStartArUtc(fromYmd));
    const end = firestore_1.Timestamp.fromDate(dayEndArUtc(toYmd));
    let snap;
    try {
        let q = db
            .collection('turnos')
            .where('empresaId', '==', empresaId)
            .where('startTime', '>=', start)
            .where('startTime', '<', end)
            .limit(4000);
        if (objectiveId)
            q = q.where('objectiveId', '==', objectiveId);
        snap = await q.get();
    }
    catch {
        snap = await db.collection('turnos').where('empresaId', '==', empresaId).limit(5000).get();
    }
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const coverage = new Set();
    for (const t of rows) {
        if (!isOperationalCoverage(t) || t.isAbsent === true)
            continue;
        const st = t.startTime instanceof firestore_1.Timestamp ? t.startTime : null;
        if (!st)
            continue;
        coverage.add(coverageKey(String(t.objectiveId || ''), normalizeCode(t.code), arYmdFromTs(st)));
    }
    const out = [];
    for (const t of rows) {
        if (t.draft === true || t.isVirtual === true || t.isFranco === true)
            continue;
        const st = t.startTime instanceof firestore_1.Timestamp ? t.startTime : null;
        if (!st)
            continue;
        const ms = st.toMillis();
        if (ms < start.toMillis() || ms >= end.toMillis())
            continue;
        if (objectiveId && String(t.objectiveId || '') !== objectiveId)
            continue;
        const code = normalizeCode(t.code);
        if (!WORK_CODES.has(code))
            continue;
        const date = arYmdFromTs(st);
        const oid = String(t.objectiveId || '');
        const uncoveredAbsence = t.isAbsent === true && !coverage.has(coverageKey(oid, code, date));
        const vacantSlot = (!t.employeeId || t.employeeId === 'VACANTE' || t.isUnassigned === true) &&
            !coverage.has(coverageKey(oid, code, date));
        const unresolved = t.isAbsent === true &&
            t.resolvedBy !== 'OPERACIONES' &&
            t.isReportedToPlanning !== true &&
            !coverage.has(coverageKey(oid, code, date));
        if (uncoveredAbsence || vacantSlot || unresolved)
            out.push(t);
    }
    return out;
}
async function runDailyReplanWindow(input) {
    const empresaId = String(input.empresaId || '').trim();
    if (!empresaId)
        throw new Error('empresaId requerido.');
    const windowDays = Math.max(1, Math.min(14, Number(input.windowDays ?? 3)));
    const dryRun = input.dryRun !== false;
    const autoApplyRet = input.autoApplyRet === true;
    const maxVacancies = Math.max(1, Math.min(80, Number(input.maxVacancies ?? 40)));
    const objectiveId = String(input.objectiveId || '').trim() || undefined;
    const from = todayArYmd();
    const to = addDaysYmd(from, windowDays - 1);
    const runId = `replan_${empresaId}_${from}_${to}_${Date.now()}`;
    const vacancies = await findWindowVacancies(empresaId, from, to, objectiveId);
    const selected = vacancies.slice(0, maxVacancies);
    const items = [];
    let recommendations = 0;
    let draftsCreated = 0;
    const db = admin.firestore();
    for (const vac of selected) {
        const st = vac.startTime instanceof firestore_1.Timestamp ? vac.startTime : null;
        const et = vac.endTime instanceof firestore_1.Timestamp ? vac.endTime : null;
        const date = st ? arYmdFromTs(st) : from;
        const code = normalizeCode(vac.code) || 'M';
        const oid = String(vac.objectiveId || '');
        const oname = String(vac.objectiveName || vac.objetivoNombre || oid);
        const empId = String(vac.employeeId || '');
        const empName = String(vac.employeeName || vac.empleadoNombre || empId || 'Vacante');
        let recommended = null;
        try {
            const rec = await recommendCoverageCandidates({
                empresaId,
                shiftId: vac.id,
                objectiveId: oid,
                fecha: date,
                banda: code,
                limite: 5,
            });
            recommended = rec.candidates[0] || null;
            if (recommended)
                recommendations += 1;
        }
        catch {
            recommended = null;
        }
        let action = 'recommend_only';
        let detail = recommended
            ? `Mejor opción: ${recommended.employeeName} (${recommended.cascadeStep}, score ${recommended.score})`
            : 'Sin candidato recomendado';
        if (!dryRun &&
            autoApplyRet &&
            recommended &&
            recommended.cascadeStep === 'RET' &&
            st &&
            et) {
            await db.collection('turnos').add({
                empresaId,
                objectiveId: oid,
                objectiveName: oname,
                objetivoNombre: oname,
                clientId: String(vac.clientId || ''),
                employeeId: recommended.employeeId,
                employeeName: recommended.employeeName,
                empleadoNombre: recommended.employeeName,
                code,
                name: code,
                startTime: st,
                endTime: et,
                draft: true,
                origin: 'OPERATIONS_COVERAGE',
                resolvedBy: 'OPERACIONES',
                isPresent: false,
                isAbsent: false,
                isCompleted: false,
                automationSource: 'DAILY_REPLAN_P1',
                automationRunId: runId,
                coversShiftId: vac.id,
                createdAt: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            });
            draftsCreated += 1;
            action = 'draft_created';
            detail = `Borrador RET creado: ${recommended.employeeName}`;
        }
        else if (!recommended) {
            action = 'skipped';
        }
        items.push({
            shiftId: vac.id,
            objectiveId: oid,
            objectiveName: oname,
            employeeId: empId,
            employeeName: empName,
            code,
            date,
            startMs: st?.toMillis() || 0,
            recommended,
            action,
            detail,
        });
    }
    await db.collection('automation_runs').doc(runId).set({
        runId,
        type: 'DAILY_REPLAN_P1',
        empresaId,
        objectiveId: objectiveId || null,
        windowDays,
        from,
        to,
        dryRun,
        autoApplyRet,
        vacanciesFound: vacancies.length,
        recommendations,
        draftsCreated,
        items: items.slice(0, 60),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return {
        ok: true,
        runId,
        empresaId,
        windowDays,
        vacanciesFound: vacancies.length,
        recommendations,
        draftsCreated,
        dryRun,
        items,
        generatedAt: nowIso(),
    };
}
//# sourceMappingURL=operationalAutomationP1.js.map