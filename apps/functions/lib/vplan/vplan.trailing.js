"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveTrailingFromAssignments = deriveTrailingFromAssignments;
exports.planningStateHasTrailing = planningStateHasTrailing;
exports.countTrailingEmployees = countTrailingEmployees;
exports.inferOpeningSlotsFromMonthHistory = inferOpeningSlotsFromMonthHistory;
exports.enrichPlanningStateWithTrailingFromTurnos = enrichPlanningStateWithTrailingFromTurnos;
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const RET_CODES = new Set(['RET', 'R']);
function normBand(code) {
    const c = code.toUpperCase();
    if (c === 'D12')
        return 'M';
    if (c === 'N12')
        return 'N';
    return c;
}
function isWorkBand(code) {
    return WORK_BANDS.has(normBand(code));
}
function isFranco(code) {
    return FRANCO_CODES.has(code.toUpperCase());
}
function isAbsence(code) {
    return ABSENCE_CODES.has(code.toUpperCase());
}
function isRet(code) {
    return RET_CODES.has(code.toUpperCase());
}
function codeOnDay(dayMap, dateStr) {
    const c = dayMap.get(dateStr);
    return c ? String(c).toUpperCase() : undefined;
}
function deriveTrailingFromAssignments(assignments, monthDateStrs) {
    const byEmp = new Map();
    for (const a of assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, String(a.code || '').toUpperCase());
    }
    const trailingWorkDays = {};
    const trailingRestDays = {};
    const lastShiftByEmp = {};
    const lastWorkBandBeforeRest = {};
    for (const [empId, dayMap] of byEmp) {
        const empDatesDesc = [...dayMap.keys()].sort().reverse();
        if (empDatesDesc.length === 0)
            continue;
        const lastDate = empDatesDesc[0];
        const lastCode = codeOnDay(dayMap, lastDate);
        if (!lastCode)
            continue;
        lastShiftByEmp[empId] = lastCode;
        if (isFranco(lastCode)) {
            let rest = 0;
            for (const d of empDatesDesc) {
                const c = codeOnDay(dayMap, d);
                if (!c || !isFranco(c))
                    break;
                rest += 1;
            }
            if (rest > 0)
                trailingRestDays[empId] = rest;
            for (const d of empDatesDesc) {
                const c = codeOnDay(dayMap, d);
                if (!c)
                    continue;
                if (isFranco(c))
                    continue;
                if (isWorkBand(c)) {
                    lastWorkBandBeforeRest[empId] = normBand(c);
                    break;
                }
                break;
            }
            continue;
        }
        if (isAbsence(lastCode))
            continue;
        if (isRet(lastCode)) {
            lastShiftByEmp[empId] = 'RET';
            let band;
            for (const d of empDatesDesc) {
                const c = codeOnDay(dayMap, d);
                if (!c)
                    continue;
                if (isRet(c))
                    continue;
                if (isFranco(c) || isAbsence(c))
                    break;
                if (isWorkBand(c)) {
                    band = normBand(c);
                    break;
                }
                break;
            }
            if (band) {
                lastWorkBandBeforeRest[empId] = band;
                let work = 0;
                for (const d of empDatesDesc) {
                    const c = codeOnDay(dayMap, d);
                    if (!c)
                        continue;
                    if (isRet(c))
                        continue;
                    if (isFranco(c) || isAbsence(c))
                        break;
                    if (normBand(c) === band)
                        work += 1;
                    else if (isWorkBand(c))
                        break;
                }
                if (work > 0)
                    trailingWorkDays[empId] = work;
            }
            continue;
        }
        if (isWorkBand(lastCode)) {
            const band = normBand(lastCode);
            let work = 0;
            for (const d of empDatesDesc) {
                const c = codeOnDay(dayMap, d);
                if (!c)
                    break;
                if (isAbsence(c))
                    break;
                if (isFranco(c))
                    break;
                if (normBand(c) === band)
                    work += 1;
                else if (isWorkBand(c))
                    break;
            }
            if (work > 0)
                trailingWorkDays[empId] = work;
        }
    }
    return {
        trailingWorkDays,
        trailingRestDays,
        lastShiftByEmp,
        lastWorkBandBeforeRest,
    };
}
function planningStateHasTrailing(state) {
    return Boolean((state.lastShiftByEmp && Object.keys(state.lastShiftByEmp).length > 0)
        || (state.trailingWorkDays && Object.keys(state.trailingWorkDays).length > 0));
}
function countTrailingEmployees(state) {
    const ids = new Set();
    Object.keys(state.lastShiftByEmp || {}).forEach((id) => ids.add(id));
    Object.keys(state.trailingWorkDays || {}).forEach((id) => ids.add(id));
    return ids.size;
}
function dayOffsetFromAnchor(dateStr, anchorDateStr) {
    const a = new Date(`${anchorDateStr}T12:00:00`).getTime();
    const b = new Date(`${dateStr}T12:00:00`).getTime();
    return Math.round((b - a) / 86_400_000);
}
function inferOpeningSlotsFromMonthHistory(assignments, monthDateStrs, targetMonthFirstDateStr, cycle = '6+2') {
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)(cycle);
    const len = template.length;
    const byEmp = new Map();
    for (const a of assignments) {
        if (!monthDateStrs.includes(a.dateStr))
            continue;
        let code = String(a.code || '').toUpperCase();
        if ((0, vplan_cycle_templates_1.is4x2Cycle)(cycle))
            code = (0, vplan_cycle_templates_1.normalizeCodeForCycle)(code, cycle);
        if (isAbsence(code))
            continue;
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, []);
        byEmp.get(a.employeeId).push({ dateStr: a.dateStr, code });
    }
    const out = {};
    for (const [empId, rows] of byEmp) {
        if (rows.length === 0)
            continue;
        rows.sort((x, y) => x.dateStr.localeCompare(y.dateStr));
        const cycleRows = rows.filter((r) => isWorkBand(r.code) || isFranco(r.code));
        if (cycleRows.length < 3)
            continue;
        let bestSlot = null;
        let bestScore = -Infinity;
        for (let opening = 0; opening < len; opening++) {
            let score = 0;
            for (const row of cycleRows) {
                const offset = dayOffsetFromAnchor(row.dateStr, targetMonthFirstDateStr);
                const expected = template[(opening + offset + len * 200) % len];
                if (expected === row.code) {
                    score += 3;
                }
                else if (isFranco(row.code) && expected === 'F') {
                    score += 2;
                }
                else if (isWorkBand(row.code) && isWorkBand(expected)) {
                    score -= 2;
                }
                else if (isFranco(row.code) || expected === 'F') {
                    score -= 1;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestSlot = opening;
            }
        }
        const minScore = Math.max(6, Math.floor(cycleRows.length * 1.5));
        if (bestSlot !== null && bestScore >= minScore) {
            out[empId] = bestSlot;
        }
    }
    return out;
}
function enrichPlanningStateWithTrailingFromTurnos(state, prevAssignments, prevMonthDateStrs) {
    if (prevAssignments.length === 0)
        return state;
    const derived = deriveTrailingFromAssignments(prevAssignments, prevMonthDateStrs);
    const hasDerived = planningStateHasTrailing({
        ...emptyTrailingState(),
        ...derived,
    });
    if (!hasDerived)
        return state;
    return {
        ...state,
        trailingWorkDays: { ...state.trailingWorkDays, ...derived.trailingWorkDays },
        trailingRestDays: { ...state.trailingRestDays, ...derived.trailingRestDays },
        lastShiftByEmp: { ...state.lastShiftByEmp, ...derived.lastShiftByEmp },
        lastWorkBandBeforeRest: {
            ...state.lastWorkBandBeforeRest,
            ...derived.lastWorkBandBeforeRest,
        },
    };
}
function emptyTrailingState() {
    return { defaultPositionByEmp: {}, defaultShiftByEmp: {} };
}
//# sourceMappingURL=vplan.trailing.js.map