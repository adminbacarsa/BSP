"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVacanteId = isVacanteId;
exports.normBandCode = normBandCode;
exports.maxEmployeesForPosition = maxEmployeesForPosition;
exports.prioritizeEmployeeIds = prioritizeEmployeeIds;
exports.capDefaultPositionByEmp = capDefaultPositionByEmp;
exports.resolvePositionAssignees = resolvePositionAssignees;
exports.stripExcessSlaAssignments = stripExcessSlaAssignments;
exports.fillCoverageGaps = fillCoverageGaps;
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_positions_1 = require("./vplan.positions");
const vplan_rotation_1 = require("./vplan.rotation");
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function isVacanteId(empId) {
    return (0, vplan_positions_1.isVirtualEmployeeId)(empId);
}
function normBandCode(code) {
    const c = String(code || '').toUpperCase();
    if (c === 'D12')
        return 'M';
    if (c === 'N12')
        return 'N';
    return c;
}
function maxEmployeesForPosition(pos, cycle) {
    const qty = Math.max(1, Number(pos.qty) || 1);
    if ((0, vplan_positions_1.is24hsPosition)(pos))
        return qty * (0, vplan_rotation_1.headcountPerQtyUnit)(cycle);
    return qty;
}
function prioritizeEmployeeIds(empIds, defaultPositionByEmp, posName) {
    return [...empIds].sort((a, b) => {
        if (isVacanteId(a) && !isVacanteId(b))
            return 1;
        if (!isVacanteId(a) && isVacanteId(b))
            return -1;
        const aMatch = defaultPositionByEmp[a] === posName ? 0 : 1;
        const bMatch = defaultPositionByEmp[b] === posName ? 0 : 1;
        if (aMatch !== bMatch)
            return aMatch - bMatch;
        return a.localeCompare(b);
    });
}
function capDefaultPositionByEmp(positions, map, cycle) {
    const posByName = new Map(positions.map((p) => [p.positionName, p]));
    const byPos = new Map();
    for (const [empId, posName] of Object.entries(map)) {
        if ((0, vplan_positions_1.isVirtualEmployeeId)(empId))
            continue;
        const name = String(posName || '').trim();
        if (!name || !posByName.has(name) || (0, vplan_positions_1.isVirtualEmployeeId)(name))
            continue;
        if (!byPos.has(name))
            byPos.set(name, []);
        byPos.get(name).push(empId);
    }
    const out = {};
    for (const [posName, empIds] of byPos) {
        const pos = posByName.get(posName);
        const limit = maxEmployeesForPosition(pos, cycle);
        for (const empId of prioritizeEmployeeIds(empIds, map, posName).slice(0, limit)) {
            out[empId] = posName;
        }
    }
    return out;
}
function shiftAppliesOnDay(shift, dayLetter) {
    const c = String(shift.code || '').toUpperCase();
    if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c))
        return false;
    if (!Array.isArray(shift.days) || shift.days.length === 0)
        return true;
    return shift.days.includes(dayLetter);
}
function dailySlotLimit(pos, shiftCode, dayLetter) {
    if (!(0, vplan_positions_1.isPositionActiveOnDay)(pos, dayLetter))
        return 0;
    const qty = Math.max(1, Number(pos.qty) || 1);
    const shift = (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === shiftCode);
    if (!shift || !shiftAppliesOnDay(shift, dayLetter))
        return 0;
    return qty;
}
function slotKey(dateStr, posName, band) {
    return `${dateStr}__${posName}__${band}`;
}
function resolvePosName(a, defaultPos) {
    return String(a.positionName || defaultPos[a.employeeId] || '').trim();
}
function openShiftCodesOnDay(pos, dateStr, dayLetter, posName, daySlotCount, excludeBand) {
    const open = [];
    for (const shift of pos.shifts || []) {
        const sc = String(shift.code || '').toUpperCase();
        if (!sc || NON_BILLABLE.has(sc) || ABSENCE_CODES.has(sc))
            continue;
        if (!shiftAppliesOnDay(shift, dayLetter))
            continue;
        const band = normBandCode(sc);
        if (excludeBand && band === excludeBand)
            continue;
        const limit = dailySlotLimit(pos, sc, dayLetter);
        const used = daySlotCount.get(slotKey(dateStr, posName, band)) || 0;
        if (used < limit)
            open.push(sc);
    }
    return open;
}
function assignmentPriority(a, defaultPos, protectedCells) {
    const key = `${a.employeeId}_${a.dateStr}`;
    if (protectedCells?.has(key))
        return 0;
    if (isVacanteId(a.employeeId))
        return 3;
    const posName = resolvePosName(a, defaultPos);
    if (posName && defaultPos[a.employeeId] === posName)
        return 1;
    return 2;
}
function resolvePositionAssignees(opts) {
    const posList = opts.onlyCustom
        ? opts.positions.filter((p) => (0, vplan_positions_1.isCustomFixedShiftPosition)(p))
        : opts.positions;
    const posNames = new Set(posList.map((p) => p.positionName));
    const capped = capDefaultPositionByEmp(posList, opts.defaultPositionByEmp, opts.cycle);
    const empToPos = new Map(Object.entries(capped));
    if (opts.draftAssignments) {
        for (const a of opts.draftAssignments) {
            if (empToPos.has(a.employeeId))
                continue;
            const code = a.code.toUpperCase();
            for (const pos of posList) {
                if (!posNames.has(pos.positionName))
                    continue;
                const expected = (0, vplan_positions_1.primaryShiftCode)(pos);
                if (code === expected || ((0, vplan_positions_1.is24hsPosition)(pos) && normBandCode(code) === normBandCode(expected))) {
                    const byPos = new Map();
                    for (const [e, p] of empToPos) {
                        if (!byPos.has(p))
                            byPos.set(p, []);
                        byPos.get(p).push(e);
                    }
                    const current = byPos.get(pos.positionName) || [];
                    if (current.length >= maxEmployeesForPosition(pos, opts.cycle))
                        continue;
                    empToPos.set(a.employeeId, pos.positionName);
                    break;
                }
            }
        }
    }
    return empToPos;
}
function stripExcessSlaAssignments(opts) {
    const log = [];
    const defaultPos = opts.defaultPositionByEmp ?? {};
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const sorted = [...opts.draft.assignments].sort((a, b) => {
        const pa = assignmentPriority(a, defaultPos, opts.protectedCells);
        const pb = assignmentPriority(b, defaultPos, opts.protectedCells);
        if (pa !== pb)
            return pa - pb;
        return `${a.dateStr}_${a.employeeId}`.localeCompare(`${b.dateStr}_${b.employeeId}`);
    });
    const daySlotCount = new Map();
    const kept = [];
    for (const a of sorted) {
        const posName = resolvePosName(a, defaultPos);
        const code = String(a.code || '').toUpperCase();
        if (!posName || !code || NON_BILLABLE.has(code) || ABSENCE_CODES.has(code)) {
            kept.push(a);
            continue;
        }
        const pos = posByName.get(posName);
        if (!pos) {
            kept.push(a);
            continue;
        }
        const dayMeta = opts.dateStrs.find((d) => d.dateStr === a.dateStr);
        if (!dayMeta) {
            kept.push(a);
            continue;
        }
        const band = normBandCode(code);
        const limit = dailySlotLimit(pos, code, dayMeta.dayLetter);
        if (limit <= 0) {
            kept.push(a);
            continue;
        }
        const key = slotKey(a.dateStr, posName, band);
        const used = daySlotCount.get(key) || 0;
        if (used >= limit) {
            if (opts.protectedCells?.has(`${a.employeeId}_${a.dateStr}`)) {
                kept.push(a);
                continue;
            }
            if ((0, vplan_positions_1.isCustomFixedShiftPosition)(pos)) {
                log.push({
                    code: 'SLA_QTY_EXCESS',
                    message: `Exceso ${code} en ${posName} (qty ${limit}/día) — ${a.employeeId} → F`,
                    employeeId: a.employeeId,
                    dateStr: a.dateStr,
                });
                kept.push({ ...a, code: 'F', positionName: '', hours: 0 });
                continue;
            }
            const rebandOptions = openShiftCodesOnDay(pos, a.dateStr, dayMeta.dayLetter, posName, daySlotCount, band);
            if (rebandOptions.length > 0) {
                const newCode = rebandOptions[0];
                const shift = (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === newCode);
                const newBand = normBandCode(newCode);
                daySlotCount.set(slotKey(a.dateStr, posName, newBand), (daySlotCount.get(slotKey(a.dateStr, posName, newBand)) || 0) + 1);
                log.push({
                    code: 'SLA_QTY_REBAND',
                    message: `Exceso ${code} en ${posName} → ${newCode} (hueco libre, qty ${limit}/día)`,
                    employeeId: a.employeeId,
                    dateStr: a.dateStr,
                });
                kept.push({
                    ...a,
                    code: newCode,
                    positionName: posName,
                    hours: shift ? (0, vplan_positions_1.shiftBandHours)(shift) : (a.hours ?? 8),
                });
                continue;
            }
            log.push({
                code: 'SLA_QTY_EXCESS',
                message: `Exceso ${code} en ${posName} sin banda libre — ${a.employeeId} → F`,
                employeeId: a.employeeId,
                dateStr: a.dateStr,
            });
            kept.push({ ...a, code: 'F', positionName: '', hours: 0 });
            continue;
        }
        daySlotCount.set(key, used + 1);
        kept.push({ ...a, positionName: a.positionName || posName });
    }
    return { draft: { ...opts.draft, assignments: kept }, log };
}
function fillCoverageGaps(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const cycle = opts.cycle ?? '6+2';
    const dateStrList = opts.dateStrList ?? opts.dateStrs.map((d) => d.dateStr);
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const daySlotCount = new Map();
    for (const a of assignments) {
        const posName = resolvePosName(a, opts.defaultPositionByEmp);
        const code = String(a.code || '').toUpperCase();
        if (!posName || !WORK_CODES.has(code))
            continue;
        const band = normBandCode(code);
        const k = slotKey(a.dateStr, posName, band);
        daySlotCount.set(k, (daySlotCount.get(k) || 0) + 1);
    }
    function candidateCanFill(empId, dateStr, shiftCode) {
        if ((0, vplan_positions_1.isVirtualEmployeeId)(empId))
            return false;
        if (opts.protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(empId, dateStr)))
            return false;
        const cct = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
            assignments,
            dateStrs: dateStrList,
            empId,
            dateStr,
            shiftCode,
            cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
        });
        return cct.ok;
    }
    for (const { dateStr, dayLetter } of opts.dateStrs) {
        for (const pos of opts.positions) {
            const posName = pos.positionName;
            for (const shift of (0, vplan_positions_1.shiftsForCycle)(pos, opts.cycle)) {
                const shiftCode = String(shift.code || '').toUpperCase();
                if (!shiftCode || NON_BILLABLE.has(shiftCode) || ABSENCE_CODES.has(shiftCode))
                    continue;
                if (!shiftAppliesOnDay(shift, dayLetter))
                    continue;
                const limit = dailySlotLimit(pos, shiftCode, dayLetter);
                if (limit <= 0)
                    continue;
                const band = normBandCode(shiftCode);
                const key = slotKey(dateStr, posName, band);
                let used = daySlotCount.get(key) || 0;
                while (used < limit) {
                    const candidateIndices = assignments
                        .map((a, i) => ({ a, i }))
                        .filter(({ a }) => {
                        if (a.dateStr !== dateStr)
                            return false;
                        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
                            return false;
                        const c = String(a.code || '').toUpperCase();
                        if (c !== 'F' && c !== 'FF' && c !== 'FP')
                            return false;
                        return opts.defaultPositionByEmp[a.employeeId] === posName;
                    })
                        .sort((x, y) => {
                        const xOk = candidateCanFill(x.a.employeeId, dateStr, shiftCode) ? 0 : 1;
                        const yOk = candidateCanFill(y.a.employeeId, dateStr, shiftCode) ? 0 : 1;
                        return xOk - yOk;
                    });
                    const pick = candidateIndices.find(({ a }) => candidateCanFill(a.employeeId, dateStr, shiftCode));
                    if (!pick)
                        break;
                    const candidateIdx = pick.i;
                    assignments[candidateIdx] = {
                        ...assignments[candidateIdx],
                        code: shiftCode,
                        positionName: posName,
                        hours: (0, vplan_positions_1.shiftBandHours)(shift),
                    };
                    log.push({
                        code: 'COVERAGE_GAP_FILL',
                        message: `F → ${shiftCode} en ${posName} (${dateStr})`,
                        employeeId: assignments[candidateIdx].employeeId,
                        dateStr,
                    });
                    used += 1;
                    daySlotCount.set(key, used);
                }
            }
        }
    }
    return { draft: { ...opts.draft, assignments }, log };
}
//# sourceMappingURL=vplan.sla-enforce.js.map