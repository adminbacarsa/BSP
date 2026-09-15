"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlannerContextFromScheduleResult = buildPlannerContextFromScheduleResult;
exports.mergeGeminiCorrectionsIntoAssignments = mergeGeminiCorrectionsIntoAssignments;
exports.optimizeScheduleAssignmentsWithGemini = optimizeScheduleAssignmentsWithGemini;
const planningGeminiServer_1 = require("./planningGeminiServer");
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const SHIFT_HRS = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9, RO: 10 };
const SHIFT_START = {
    M: '06:00',
    T: '14:00',
    N: '22:00',
    D12: '07:00',
    N12: '19:00',
    EN: '08:00',
    RO: '20:00',
};
function maxBillableHoursPerPositionDay(pos) {
    const qty = Math.max(1, Number(pos?.qty) || 1);
    const cov = String(pos?.coverageType || 'custom').toLowerCase();
    if (cov === '24hs' || cov === '24' || cov === '24h')
        return qty * 24;
    const shiftsArr = Array.isArray(pos?.shifts) ? pos.shifts : [];
    const sumHs = shiftsArr.reduce((acc, s) => acc + (Number(s.hours) || 8), 0);
    const banda = sumHs > 0 ? sumHs : 8;
    return qty * banda;
}
function billableHours(assignments, dateStr, positionName) {
    return assignments.reduce((s, a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName)
            return s;
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c))
            return s;
        return s + (Number(a.hours) || SHIFT_HRS[c] || 0);
    }, 0);
}
function dayLetter(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][dow] || 'L';
}
function positionActiveOnDay(pos, letter) {
    const days = Array.isArray(pos.activeDays) ? pos.activeDays.map((x) => String(x).toUpperCase()) : null;
    if (!days || days.length === 0 || days.length === 7)
        return true;
    const map = {
        L: ['L', 'LU', 'LUN', 'LUNES', '1'],
        M: ['M', 'MA', 'MAR', 'MARTES', '2'],
        X: ['X', 'MI', 'MIE', 'MIÉRCOLES', 'MIERCOLES', '3'],
        J: ['J', 'JU', 'JUE', 'JUEVES', '4'],
        V: ['V', 'VI', 'VIE', 'VIERNES', '5'],
        S: ['S', 'SA', 'SAB', 'SÁBADO', 'SABADO', '6'],
        D: ['D', 'DO', 'DOM', 'DOMINGO', '0'],
    };
    const aliases = map[letter] || [letter];
    return days.some((d) => aliases.includes(d) || d === letter);
}
function buildCoberturaPorDia(seed, assignments, positionGroups) {
    const out = {};
    for (const dateStr of seed.days) {
        const letter = dayLetter(dateStr);
        out[dateStr] = {};
        for (const pos of seed.positions) {
            const posName = pos.positionName;
            const active = positionActiveOnDay(pos, letter);
            if (!active) {
                out[dateStr][posName] = { actual: 0, requerido: 0, deficit: 0, retDisponibles: 0 };
                continue;
            }
            const requerido = maxBillableHoursPerPositionDay(pos);
            const actual = billableHours(assignments, dateStr, posName);
            const group = positionGroups[posName] || [];
            const retDisponibles = assignments.filter((a) => a.dateStr === dateStr && group.includes(a.empId) && String(a.code).toUpperCase() === 'RET').length;
            out[dateStr][posName] = {
                actual,
                requerido,
                deficit: Math.max(0, requerido - actual),
                retDisponibles,
            };
        }
    }
    return out;
}
function buildPlanificacionCompleta(assignments) {
    const byEmp = {};
    for (const a of assignments) {
        if (!byEmp[a.empId])
            byEmp[a.empId] = [];
        byEmp[a.empId].push({
            fecha: a.dateStr,
            codigo: String(a.code || '').toUpperCase(),
            puesto: a.positionName || 'General',
        });
    }
    return byEmp;
}
function buildEmpleadosPayload(seed, assignments, stats) {
    const groups = stats.positionGroups || {};
    const empPos = {};
    Object.entries(groups).forEach(([pos, ids]) => {
        (ids || []).forEach((id) => {
            empPos[id] = pos;
        });
    });
    const monthly = stats.employeeMonthlyHours || {};
    const values = Object.values(monthly).filter((h) => h > 0);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return seed.employees.map((e) => {
        const puestoAsignado = empPos[e.id] || null;
        const horasMes = monthly[e.id] || 0;
        const groupIds = puestoAsignado ? groups[puestoAsignado] || [] : [];
        const ownerVirtual = !!puestoAsignado && groupIds.length === 1 && groupIds[0] === e.id;
        const posCfg = puestoAsignado ? seed.positions.find((p) => p.positionName === puestoAsignado) : null;
        return {
            id: e.id,
            nombre: e.nombre,
            puestoAsignado,
            defaultPos: puestoAsignado,
            ownerVirtual,
            horasMes,
            priorHoursCiclo: 0,
            diferenciaProm: Math.round((horasMes - avg) * 10) / 10,
            qtyPuesto: posCfg ? Number(posCfg.qty) || 1 : 1,
        };
    });
}
function buildPlannerContextFromScheduleResult(params) {
    const absencesObj = {};
    Object.entries(params.seed.absences || {}).forEach(([empId, dates]) => {
        absencesObj[empId] = {};
        (dates || []).forEach((d) => {
            absencesObj[empId][d] = 'A';
        });
    });
    return {
        mes: params.mesLabel,
        objetivo: params.objetivoNombre,
        slaVendidas: params.seed.slaVendidas,
        puestos: params.seed.positions,
        empleados: buildEmpleadosPayload(params.seed, params.result.assignments, params.result.stats),
        dias: params.seed.days,
        diasBloqueados: [],
        planificacionCompleta: buildPlanificacionCompleta(params.result.assignments),
        ausencias: absencesObj,
        coberturaPorDia: buildCoberturaPorDia(params.seed, params.result.assignments, params.result.stats.positionGroups || {}),
        autoCycles: ['6+2'],
    };
}
function mergeGeminiCorrectionsIntoAssignments(assignments, correcciones, positions) {
    const next = [...assignments];
    const idx = new Map();
    next.forEach((a, i) => idx.set(`${a.empId}_${a.dateStr}`, i));
    let applied = 0;
    let skipped = 0;
    for (const c of correcciones) {
        const empId = String(c.empId || '').trim();
        const fecha = String(c.fecha || '').trim();
        const code = String(c.codigoNuevo || '').toUpperCase().trim();
        if (!empId || !fecha || !code) {
            skipped += 1;
            continue;
        }
        const posName = String(c.puesto || '').trim() || 'General';
        const pos = positions.find((p) => p.positionName === posName);
        const shiftMeta = (pos?.shifts || []).find((s) => String(s.code || '').toUpperCase() === code);
        const hours = NON_BILLABLE.has(code)
            ? 0
            : Number(shiftMeta?.hours) || SHIFT_HRS[code] || 8;
        const startTime = String(shiftMeta?.startTime || SHIFT_START[code] || '07:00').slice(0, 5);
        const endTime = shiftMeta?.endTime ? String(shiftMeta.endTime).slice(0, 5) : undefined;
        const patch = {
            empId,
            dateStr: fecha,
            positionName: posName,
            code,
            name: shiftMeta?.name || code,
            hours,
            startTime,
            ...(endTime ? { endTime } : {}),
            ...(code === 'F' || code === 'FF' || code === 'FP' || code === 'RET' ? { isFranco: code !== 'RET' ? true : false } : { isFranco: false }),
        };
        const key = `${empId}_${fecha}`;
        const i = idx.get(key);
        if (i !== undefined)
            next[i] = { ...next[i], ...patch };
        else {
            idx.set(key, next.length);
            next.push(patch);
        }
        applied += 1;
    }
    return { assignments: next, applied, skipped };
}
async function optimizeScheduleAssignmentsWithGemini(params) {
    const uncovered = Number(params.result.coverage?.uncoveredSlots ?? 0);
    const slaClosed = params.result.coverage?.slaHoursClosed === true;
    const forceOrNeeded = uncovered > 0 || !slaClosed || !params.result.ok;
    try {
        const context = buildPlannerContextFromScheduleResult(params);
        const gemini = await (0, planningGeminiServer_1.runPlanningGeminiOptimize)(context);
        if (gemini.bloqueoEstructural) {
            return {
                assignments: params.result.assignments,
                gemini,
                applied: 0,
                skipped: 0,
                usedAi: true,
            };
        }
        if (!gemini.correcciones?.length) {
            return {
                assignments: params.result.assignments,
                gemini,
                applied: 0,
                skipped: 0,
                usedAi: true,
            };
        }
        const merged = mergeGeminiCorrectionsIntoAssignments(params.result.assignments, gemini.correcciones, params.seed.positions);
        return {
            assignments: merged.assignments,
            gemini,
            applied: merged.applied,
            skipped: merged.skipped,
            usedAi: true,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[assistantPlanningWithGemini] fallback motor sin IA', {
            msg: msg.slice(0, 240),
            forceOrNeeded,
        });
        return {
            assignments: params.result.assignments,
            gemini: null,
            applied: 0,
            skipped: 0,
            usedAi: false,
            aiError: msg.slice(0, 240),
        };
    }
}
//# sourceMappingURL=assistantPlanningWithGemini.js.map