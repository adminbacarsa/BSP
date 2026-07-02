"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveTrailingFromAssignments = deriveTrailingFromAssignments;
exports.planningStateHasTrailing = planningStateHasTrailing;
exports.enrichPlanningStateWithTrailingFromTurnos = enrichPlanningStateWithTrailingFromTurnos;
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
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
    const daysDesc = [...monthDateStrs].sort().reverse();
    for (const [empId, dayMap] of byEmp) {
        let lastCode;
        for (const d of daysDesc) {
            const c = dayMap.get(d);
            if (c) {
                lastCode = c;
                lastShiftByEmp[empId] = c;
                break;
            }
        }
        if (!lastCode)
            continue;
        if (isFranco(lastCode)) {
            let rest = 0;
            for (const d of daysDesc) {
                const c = dayMap.get(d);
                if (!c)
                    continue;
                if (isFranco(c))
                    rest += 1;
                else
                    break;
            }
            if (rest > 0)
                trailingRestDays[empId] = rest;
            for (const d of daysDesc) {
                const c = dayMap.get(d);
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
        if (isWorkBand(lastCode)) {
            const band = normBand(lastCode);
            let work = 0;
            for (const d of daysDesc) {
                const c = dayMap.get(d);
                if (!c)
                    continue;
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
function enrichPlanningStateWithTrailingFromTurnos(state, prevAssignments, prevMonthDateStrs) {
    if (planningStateHasTrailing(state) || prevAssignments.length === 0) {
        return state;
    }
    const derived = deriveTrailingFromAssignments(prevAssignments, prevMonthDateStrs);
    return {
        ...state,
        trailingWorkDays: { ...derived.trailingWorkDays, ...state.trailingWorkDays },
        trailingRestDays: { ...derived.trailingRestDays, ...state.trailingRestDays },
        lastShiftByEmp: { ...derived.lastShiftByEmp, ...state.lastShiftByEmp },
        lastWorkBandBeforeRest: {
            ...derived.lastWorkBandBeforeRest,
            ...state.lastWorkBandBeforeRest,
        },
    };
}
//# sourceMappingURL=vplan.trailing.js.map