"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEEDS_REINFORCEMENT_CODE = exports.NEEDS_REINFORCEMENT_EMP_ID = void 0;
exports.fillAssignableGapsFromAudit = fillAssignableGapsFromAudit;
exports.fillCoverageGapsWithLadder = fillCoverageGapsWithLadder;
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_coverage_audit_1 = require("./vplan.coverage-audit");
const vplan_brain_model_1 = require("./vplan.brain-model");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_custom_schedule_1 = require("./vplan.custom-schedule");
const vplan_positions_1 = require("./vplan.positions");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
exports.NEEDS_REINFORCEMENT_EMP_ID = 'SIN_COBERTURA';
exports.NEEDS_REINFORCEMENT_CODE = 'NR';
const FRANCO_POOL = new Set(['F', 'FF', 'FP']);
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function slotKey(dateStr, posName, band) {
    return `${dateStr}__${posName}__${band}`;
}
function shiftAppliesOnDay(shift, dayLetter) {
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
function countBillableHours(assignments) {
    let total = 0;
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c))
            continue;
        total += a.hours ?? (0, vplan_positions_1.shiftBandHours)({ code: c, hours: 8 });
    }
    return Math.round(total);
}
function contingencyShiftCode(shiftCode) {
    const c = shiftCode.toUpperCase();
    if (c === 'M' || c === 'T')
        return 'D12';
    if (c === 'N')
        return 'N12';
    if (c === 'D12' || c === 'N12')
        return c;
    return null;
}
function positionHasShift(pos, code) {
    return (pos.shifts || []).some((s) => String(s.code || '').toUpperCase() === code.toUpperCase());
}
function bandLimitsForPosition(pos, dayLetter, cycle) {
    const limits = new Map();
    for (const shift of (0, vplan_positions_1.shiftsForCycle)(pos, cycle)) {
        const code = String(shift.code || '').toUpperCase();
        const limit = dailySlotLimit(pos, code, dayLetter);
        if (limit <= 0)
            continue;
        const band = (0, vplan_sla_enforce_1.normBandCode)(code);
        limits.set(band, (limits.get(band) || 0) + limit);
    }
    return limits;
}
function countBandsOnPosition(assignments, dateStr, posName, defaultPositionByEmp) {
    const counts = new Map();
    for (const a of assignments) {
        if (a.dateStr !== dateStr)
            continue;
        const code = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            continue;
        const pos = String(a.positionName || defaultPositionByEmp[a.employeeId] || '').trim();
        if (pos !== posName)
            continue;
        const band = (0, vplan_sla_enforce_1.normBandCode)(code);
        counts.set(band, (counts.get(band) || 0) + 1);
    }
    return counts;
}
function candidateCanTakeBand(opts) {
    if ((0, vplan_positions_1.isVirtualEmployeeId)(opts.empId))
        return false;
    if (opts.protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(opts.empId, opts.dateStr)))
        return false;
    const evalResult = (0, vplan_coverage_audit_1.evaluateCoverageCandidate)({
        empId: opts.empId,
        dateStr: opts.dateStr,
        shiftCode: opts.shiftCode,
        assignments: opts.assignments,
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
        francoTrabajado: opts.francoTrabajado === true,
    });
    return evalResult.canAssign;
}
function expectedBandForEmployeeDay(empId, dateStr, ctx) {
    const opening = ctx.openingSlotByEmp?.[empId];
    if (opening === undefined || opening === null)
        return null;
    const dayIndex = ctx.dateStrList.indexOf(dateStr);
    if (dayIndex < 0)
        return null;
    const skipFixed = Boolean(ctx.useTrailing && ctx.trailingEmpIds?.has(empId));
    const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
    return (0, vplan_cycle_continuity_1.expectedCycleCodeForEmployeeDay)(opening, dayIndex, ctx.cycle, fixedBand, skipFixed);
}
function cycleBandMatchesEmployeeDay(empId, dateStr, shiftCode, ctx) {
    const expected = expectedBandForEmployeeDay(empId, dateStr, ctx);
    if (!expected)
        return false;
    if (expected === 'F')
        return false;
    return (0, vplan_sla_enforce_1.normBandCode)(expected) === (0, vplan_sla_enforce_1.normBandCode)(shiftCode);
}
function cyclePreferenceRank(empId, dateStr, shiftCode, ctx) {
    return cycleBandMatchesEmployeeDay(empId, dateStr, shiftCode, ctx) ? 0 : 1;
}
function sortFrancoCandidatesByCycle(items, dateStr, shiftCode, ctx) {
    return [...items].sort((x, y) => {
        const xr = cyclePreferenceRank(x.a.employeeId, dateStr, shiftCode, ctx);
        const yr = cyclePreferenceRank(y.a.employeeId, dateStr, shiftCode, ctx);
        return xr - yr;
    });
}
function tryDirectBandReassign(opts) {
    const needBand = (0, vplan_sla_enforce_1.normBandCode)(opts.shiftCode);
    const limits = bandLimitsForPosition(opts.pos, opts.dayLetter, opts.fillCtx.cycle);
    const counts = countBandsOnPosition(opts.assignments, opts.dateStr, opts.posName, opts.defaultPositionByEmp);
    const occupants = opts.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
        if (a.dateStr !== opts.dateStr)
            return false;
        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            return false;
        const code = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            return false;
        const pos = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
        if (pos !== opts.posName)
            return false;
        return (0, vplan_sla_enforce_1.normBandCode)(code) !== needBand;
    })
        .sort((x, y) => {
        const pref = {
            openingSlotByEmp: opts.fillCtx.openingSlotByEmp,
            dateStrList: opts.fillCtx.dateStrList,
            cycle: opts.fillCtx.cycle,
            defaultShiftByEmp: opts.fillCtx.defaultShiftByEmp,
            useTrailing: opts.fillCtx.useTrailing,
            trailingEmpIds: opts.fillCtx.trailingEmpIds,
        };
        const xr = cyclePreferenceRank(x.a.employeeId, opts.dateStr, opts.shiftCode, pref);
        const yr = cyclePreferenceRank(y.a.employeeId, opts.dateStr, opts.shiftCode, pref);
        return xr - yr;
    });
    for (const { a, i } of occupants) {
        const fromBand = (0, vplan_sla_enforce_1.normBandCode)(String(a.code || ''));
        const fromCount = counts.get(fromBand) || 0;
        const fromLimit = limits.get(fromBand) || 0;
        const needCount = counts.get(needBand) || 0;
        const needLimit = limits.get(needBand) || 0;
        if (needCount >= needLimit)
            continue;
        if (fromCount <= fromLimit)
            continue;
        if (!candidateCanTakeBand({
            ...opts.fillCtx,
            empId: a.employeeId,
            dateStr: opts.dateStr,
            shiftCode: opts.shiftCode,
        })) {
            continue;
        }
        const cyclePref = {
            openingSlotByEmp: opts.fillCtx.openingSlotByEmp,
            dateStrList: opts.fillCtx.dateStrList,
            cycle: opts.fillCtx.cycle,
            defaultShiftByEmp: opts.fillCtx.defaultShiftByEmp,
            useTrailing: opts.fillCtx.useTrailing,
            trailingEmpIds: opts.fillCtx.trailingEmpIds,
        };
        if (opts.fillCtx.openingSlotByEmp
            && !cycleBandMatchesEmployeeDay(a.employeeId, opts.dateStr, opts.shiftCode, cyclePref)) {
            continue;
        }
        const nextCounts = new Map(counts);
        nextCounts.set(fromBand, fromCount - 1);
        nextCounts.set(needBand, needCount + 1);
        let bandsOk = true;
        for (const [band, limit] of limits) {
            if ((nextCounts.get(band) || 0) < limit) {
                bandsOk = false;
                break;
            }
        }
        if (!bandsOk)
            continue;
        return { ok: true, idx: i, fromBand };
    }
    return { ok: false };
}
function tryPairBandSwap(opts) {
    const needBand = (0, vplan_sla_enforce_1.normBandCode)(opts.shiftCode);
    const limits = bandLimitsForPosition(opts.pos, opts.dayLetter, opts.fillCtx.cycle);
    const counts = countBandsOnPosition(opts.assignments, opts.dateStr, opts.posName, opts.defaultPositionByEmp);
    const occupants = opts.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
        if (a.dateStr !== opts.dateStr)
            return false;
        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            return false;
        const code = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            return false;
        const pos = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
        return pos === opts.posName;
    });
    for (let x = 0; x < occupants.length; x++) {
        for (let y = x + 1; y < occupants.length; y++) {
            const a = occupants[x];
            const b = occupants[y];
            const bandA = (0, vplan_sla_enforce_1.normBandCode)(String(a.a.code || ''));
            const bandB = (0, vplan_sla_enforce_1.normBandCode)(String(b.a.code || ''));
            if (bandA === bandB)
                continue;
            const trySwap = (donor, receiver, donorBand, receiverBand) => {
                if (donorBand === needBand)
                    return false;
                if (!candidateCanTakeBand({
                    ...opts.fillCtx,
                    empId: donor.a.employeeId,
                    dateStr: opts.dateStr,
                    shiftCode: opts.shiftCode,
                })) {
                    return false;
                }
                if (!candidateCanTakeBand({
                    ...opts.fillCtx,
                    empId: receiver.a.employeeId,
                    dateStr: opts.dateStr,
                    shiftCode: donorBand,
                })) {
                    return false;
                }
                const nextCounts = new Map(counts);
                nextCounts.set(donorBand, (nextCounts.get(donorBand) || 0) - 1);
                nextCounts.set(needBand, (nextCounts.get(needBand) || 0) + 1);
                nextCounts.set(receiverBand, (nextCounts.get(receiverBand) || 0) - 1);
                nextCounts.set(donorBand, (nextCounts.get(donorBand) || 0) + 1);
                for (const [band, limit] of limits) {
                    const have = nextCounts.get(band) || 0;
                    if (have < limit)
                        return false;
                }
                return true;
            };
            if (trySwap(a, b, bandA, bandB)) {
                return { ok: true, idxA: a.i, idxB: b.i, fromA: bandA, fromB: bandB };
            }
            if (trySwap(b, a, bandB, bandA)) {
                return { ok: true, idxA: b.i, idxB: a.i, fromA: bandB, fromB: bandA };
            }
        }
    }
    return { ok: false };
}
function tryBandSwapWithFrancoHelper(opts) {
    const needBand = (0, vplan_sla_enforce_1.normBandCode)(opts.shiftCode);
    const counts = countBandsOnPosition(opts.assignments, opts.dateStr, opts.posName, opts.defaultPositionByEmp);
    const needCount = counts.get(needBand) || 0;
    const needLimit = bandLimitsForPosition(opts.pos, opts.dayLetter, opts.fillCtx.cycle).get(needBand) || 0;
    if (needCount >= needLimit)
        return { ok: false };
    const occupants = opts.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
        if (a.dateStr !== opts.dateStr)
            return false;
        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            return false;
        const code = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            return false;
        const pos = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
        return pos === opts.posName && (0, vplan_sla_enforce_1.normBandCode)(code) !== needBand;
    });
    const francos = opts.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
        if (a.dateStr !== opts.dateStr)
            return false;
        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            return false;
        if (!FRANCO_POOL.has(String(a.code || '').toUpperCase()))
            return false;
        return opts.defaultPositionByEmp[a.employeeId] === opts.posName;
    });
    for (const occ of occupants) {
        const fromBand = (0, vplan_sla_enforce_1.normBandCode)(String(occ.a.code || ''));
        void fromBand;
    }
    const ranked = [...occupants].sort((a, b) => {
        const ba = (0, vplan_sla_enforce_1.normBandCode)(String(a.a.code || ''));
        const bb = (0, vplan_sla_enforce_1.normBandCode)(String(b.a.code || ''));
        const preferOrder = needBand === 'M' ? ['T', 'N', 'M'] : needBand === 'T' ? ['M', 'N', 'T'] : ['T', 'M', 'N'];
        return preferOrder.indexOf(ba) - preferOrder.indexOf(bb);
    });
    for (const occ of ranked) {
        const fromBand = (0, vplan_sla_enforce_1.normBandCode)(String(occ.a.code || ''));
        if (!candidateCanTakeBand({
            ...opts.fillCtx,
            empId: occ.a.employeeId,
            dateStr: opts.dateStr,
            shiftCode: opts.shiftCode,
            francoTrabajado: opts.allowFrancoTrabajado === true,
        })) {
            continue;
        }
        for (const fr of francos) {
            const canTakeFrom = candidateCanFill({
                ...opts.fillCtx,
                empId: fr.a.employeeId,
                dateStr: opts.dateStr,
                shiftCode: fromBand,
                cycle: opts.fillCtx.cycle,
                francoTrabajado: opts.allowFrancoTrabajado === true,
            });
            if (!canTakeFrom)
                continue;
            return { ok: true, occupantIdx: occ.i, francoIdx: fr.i, fromBand };
        }
    }
    return { ok: false };
}
function candidateCanFill(opts) {
    if (!candidateCanTakeBand(opts))
        return false;
    if (opts.francoTrabajado || !opts.openingSlotByEmp)
        return true;
    const expected = expectedBandForEmployeeDay(opts.empId, opts.dateStr, {
        openingSlotByEmp: opts.openingSlotByEmp,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        defaultShiftByEmp: opts.defaultShiftByEmp,
        useTrailing: opts.useTrailing,
        trailingEmpIds: opts.trailingEmpIds,
    });
    if (!expected || expected === 'F')
        return true;
    return (0, vplan_sla_enforce_1.normBandCode)(expected) === (0, vplan_sla_enforce_1.normBandCode)(opts.shiftCode);
}
function assignCell(assignments, idx, shiftCode, posName, pos) {
    const shift = (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === shiftCode);
    assignments[idx] = {
        ...assignments[idx],
        code: shiftCode,
        positionName: posName,
        hours: shift ? (0, vplan_positions_1.shiftBandHours)(shift) : (shiftCode === 'D12' || shiftCode === 'N12' ? 12 : 8),
    };
}
function markNeedsReinforcement(assignments, dateStr, posName, shiftCode) {
    const band = (0, vplan_sla_enforce_1.normBandCode)(shiftCode);
    const existing = assignments.filter((a) => (a.employeeId === exports.NEEDS_REINFORCEMENT_EMP_ID
        || a.employeeId.startsWith(`${exports.NEEDS_REINFORCEMENT_EMP_ID}:`))
        && a.dateStr === dateStr
        && a.positionName === posName
        && (0, vplan_sla_enforce_1.normBandCode)(a.code) === band).length;
    assignments.push({
        employeeId: existing === 0
            ? exports.NEEDS_REINFORCEMENT_EMP_ID
            : `${exports.NEEDS_REINFORCEMENT_EMP_ID}:${existing + 1}`,
        dateStr,
        code: exports.NEEDS_REINFORCEMENT_CODE,
        positionName: posName,
        hours: 0,
    });
}
function countBandSlotsFilled(assignments, dateStr, posName, band, defaultPositionByEmp) {
    let n = 0;
    for (const a of assignments) {
        if (a.dateStr !== dateStr)
            continue;
        const code = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            continue;
        const pos = String(a.positionName || defaultPositionByEmp[a.employeeId] || '').trim();
        if (pos !== posName)
            continue;
        if ((0, vplan_sla_enforce_1.normBandCode)(code) === band)
            n += 1;
    }
    return n;
}
function liveAuditGapCandidateCanFill(opts) {
    if (opts.protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(opts.empId, opts.dateStr)))
        return false;
    if ((0, vplan_positions_1.isVirtualEmployeeId)(opts.empId))
        return false;
    const cell = opts.assignments.find((a) => a.employeeId === opts.empId && a.dateStr === opts.dateStr);
    const currentCode = String(cell?.code || 'F').toUpperCase();
    if (!FRANCO_POOL.has(currentCode))
        return false;
    const defaultPos = String(opts.defaultPositionByEmp[opts.empId] || '').trim();
    if (defaultPos !== opts.positionName)
        return false;
    const evalResult = (0, vplan_coverage_audit_1.evaluateCoverageCandidate)({
        empId: opts.empId,
        dateStr: opts.dateStr,
        shiftCode: opts.shiftCode,
        assignments: opts.assignments,
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
        francoTrabajado: opts.francoTrabajado === true,
    });
    if (!evalResult.canAssign)
        return false;
    if (opts.francoTrabajado || !opts.openingSlotByEmp)
        return true;
    const expected = expectedBandForEmployeeDay(opts.empId, opts.dateStr, {
        openingSlotByEmp: opts.openingSlotByEmp,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        defaultShiftByEmp: opts.defaultShiftByEmp,
        useTrailing: opts.useTrailing,
        trailingEmpIds: opts.trailingEmpIds,
    });
    if (!expected || expected === 'F')
        return true;
    return (0, vplan_sla_enforce_1.normBandCode)(expected) === (0, vplan_sla_enforce_1.normBandCode)(opts.shiftCode);
}
function fillAssignableGapsFromAudit(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const ladderStats = {
        subgrupo6x2: 0,
        refuerzo4x2: 0,
        sinTurno: 0,
        ret: 0,
        ft: 0,
        needsReinforcement: 0,
        bandSwap: 0,
        auditGap: 0,
    };
    const liveCtx = {
        assignments,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules,
        protectedCells: opts.protectedCells,
        openingSlotByEmp: opts.openingSlotByEmp,
        defaultShiftByEmp: opts.defaultShiftByEmp,
        useTrailing: opts.useTrailing,
        trailingEmpIds: opts.trailingEmployeeIds
            ? new Set(opts.trailingEmployeeIds)
            : undefined,
    };
    for (let round = 0; round < 32; round += 1) {
        const audit = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: { ...opts.draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrs: opts.dateStrList,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
        });
        if (audit.gaps.length === 0)
            break;
        let assignedThisRound = 0;
        for (const gap of audit.gaps) {
            for (let missing = 0; missing < gap.missing; missing += 1) {
                const pick = gap.candidates.find((candidate) => liveAuditGapCandidateCanFill({
                    ...liveCtx,
                    empId: candidate.employeeId,
                    dateStr: gap.dateStr,
                    shiftCode: gap.shiftCode,
                    positionName: gap.positionName,
                }))
                    ?? (opts.allowFrancoTrabajado
                        ? gap.candidates.find((candidate) => liveAuditGapCandidateCanFill({
                            ...liveCtx,
                            empId: candidate.employeeId,
                            dateStr: gap.dateStr,
                            shiftCode: gap.shiftCode,
                            positionName: gap.positionName,
                            francoTrabajado: true,
                        }))
                        : undefined);
                if (!pick)
                    break;
                const idx = assignments.findIndex((a) => a.employeeId === pick.employeeId && a.dateStr === gap.dateStr);
                if (idx < 0)
                    break;
                const pos = posByName.get(gap.positionName);
                if (!pos)
                    break;
                assignCell(assignments, idx, gap.shiftCode, gap.positionName, pos);
                log.push({
                    code: 'LADDER_AUDIT_GAP',
                    message: (0, vplan_brain_model_1.ladderMessage)('SUBGRUPO_6X2_LEGAL', gap.dateStr, gap.positionName, gap.shiftCode),
                    employeeId: pick.employeeId,
                    dateStr: gap.dateStr,
                });
                ladderStats.auditGap += 1;
                ladderStats.subgrupo6x2 += 1;
                assignedThisRound += 1;
            }
        }
        if (assignedThisRound === 0)
            break;
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
        ladderStats,
    };
}
function fillCoverageGapsWithLadder(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const cycle = opts.cycle ?? '6+2';
    const dateStrList = opts.dateStrList ?? opts.dateStrs.map((d) => d.dateStr);
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const pool = new Set(opts.employeeIds ?? Object.keys(opts.defaultPositionByEmp));
    const ladderStats = {
        subgrupo6x2: 0,
        refuerzo4x2: 0,
        sinTurno: 0,
        ret: 0,
        ft: 0,
        needsReinforcement: 0,
        bandSwap: 0,
        auditGap: 0,
    };
    const daySlotCount = new Map();
    for (const a of assignments) {
        const posName = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
        const code = String(a.code || '').toUpperCase();
        if (!posName || !WORK_CODES.has(code))
            continue;
        const band = (0, vplan_sla_enforce_1.normBandCode)(code);
        const k = slotKey(a.dateStr, posName, band);
        daySlotCount.set(k, (daySlotCount.get(k) || 0) + 1);
    }
    let hourHeadroom = (0, vplan_brain_model_1.computeHourHeadroom)({
        slaVendidas: opts.slaVendidas ?? 0,
        billableHours: countBillableHours(assignments),
        offerHours: opts.offerHours,
        tolerance: rules.slaHoursTolerance ?? 8,
    });
    const fillCtx = {
        assignments,
        dateStrList,
        cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules,
        protectedCells: opts.protectedCells,
        openingSlotByEmp: opts.openingSlotByEmp,
        defaultShiftByEmp: opts.defaultShiftByEmp,
        useTrailing: opts.useTrailing,
        trailingEmpIds: opts.trailingEmployeeIds
            ? new Set(opts.trailingEmployeeIds)
            : undefined,
    };
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
                const band = (0, vplan_sla_enforce_1.normBandCode)(shiftCode);
                const key = slotKey(dateStr, posName, band);
                let used = daySlotCount.get(key) || 0;
                let syntheticFilled = 0;
                let slotAttempts = 0;
                const maxSlotAttempts = limit + 8;
                while (used + syntheticFilled < limit) {
                    slotAttempts += 1;
                    if (slotAttempts > maxSlotAttempts)
                        break;
                    const progressBefore = used + syntheticFilled;
                    used = countBandSlotsFilled(assignments, dateStr, posName, band, opts.defaultPositionByEmp);
                    daySlotCount.set(key, used);
                    if (used + syntheticFilled >= limit)
                        break;
                    hourHeadroom = (0, vplan_brain_model_1.computeHourHeadroom)({
                        slaVendidas: opts.slaVendidas ?? 0,
                        billableHours: countBillableHours(assignments),
                        offerHours: opts.offerHours,
                        tolerance: rules.slaHoursTolerance ?? 8,
                    });
                    let filled = false;
                    const swapCtx = {
                        assignments,
                        dateStr,
                        posName,
                        pos,
                        dayLetter,
                        shiftCode,
                        defaultPositionByEmp: opts.defaultPositionByEmp,
                        fillCtx,
                    };
                    const directSwap = tryDirectBandReassign(swapCtx);
                    if (directSwap.ok && directSwap.idx !== undefined) {
                        const currentUsed = countBandSlotsFilled(assignments, dateStr, posName, band, opts.defaultPositionByEmp);
                        if (currentUsed >= limit) {
                            filled = false;
                        }
                        else {
                            const fromBand = directSwap.fromBand || '';
                            assignCell(assignments, directSwap.idx, shiftCode, posName, pos);
                            if (fromBand) {
                                const oldKey = slotKey(dateStr, posName, fromBand);
                                daySlotCount.set(oldKey, Math.max(0, (daySlotCount.get(oldKey) || 0) - 1));
                            }
                            used = countBandSlotsFilled(assignments, dateStr, posName, band, opts.defaultPositionByEmp);
                            daySlotCount.set(key, used);
                            log.push({
                                code: 'LADDER_BAND_SWAP',
                                message: `${fromBand} → ${shiftCode} en ${posName} (${dateStr})`,
                                employeeId: assignments[directSwap.idx].employeeId,
                                dateStr,
                            });
                            ladderStats.bandSwap += 1;
                            filled = true;
                        }
                    }
                    if (!filled) {
                        const pairSwap = tryPairBandSwap(swapCtx);
                        if (pairSwap.ok
                            && pairSwap.idxA !== undefined
                            && pairSwap.idxB !== undefined
                            && pairSwap.fromA
                            && pairSwap.fromB) {
                            assignCell(assignments, pairSwap.idxA, shiftCode, posName, pos);
                            assignCell(assignments, pairSwap.idxB, pairSwap.fromA, posName, pos);
                            const oldKeyB = slotKey(dateStr, posName, pairSwap.fromB);
                            daySlotCount.set(oldKeyB, Math.max(0, (daySlotCount.get(oldKeyB) || 0) - 1));
                            const oldKeyA = slotKey(dateStr, posName, pairSwap.fromA);
                            daySlotCount.set(oldKeyA, (daySlotCount.get(oldKeyA) || 0) + 1);
                            daySlotCount.set(key, (daySlotCount.get(key) || 0) + 1);
                            log.push({
                                code: 'LADDER_BAND_SWAP_PAIR',
                                message: `${pairSwap.fromA}/${pairSwap.fromB} → ${shiftCode}/${pairSwap.fromA} en ${posName} (${dateStr})`,
                                employeeId: assignments[pairSwap.idxA].employeeId,
                                dateStr,
                            });
                            ladderStats.bandSwap += 1;
                            filled = true;
                        }
                    }
                    if (!filled) {
                        const helperSwap = tryBandSwapWithFrancoHelper({
                            ...swapCtx,
                            allowFrancoTrabajado: opts.allowFrancoTrabajado === true,
                        });
                        if (helperSwap.ok
                            && helperSwap.occupantIdx !== undefined
                            && helperSwap.francoIdx !== undefined
                            && helperSwap.fromBand) {
                            assignCell(assignments, helperSwap.occupantIdx, shiftCode, posName, pos);
                            assignCell(assignments, helperSwap.francoIdx, helperSwap.fromBand, posName, pos);
                            const oldKey = slotKey(dateStr, posName, helperSwap.fromBand);
                            daySlotCount.set(oldKey, Math.max(0, (daySlotCount.get(oldKey) || 0) - 1) + 1);
                            daySlotCount.set(key, (daySlotCount.get(key) || 0) + 1);
                            log.push({
                                code: 'LADDER_BAND_SWAP_FRANCO',
                                message: `${helperSwap.fromBand}→${shiftCode} + F→${helperSwap.fromBand} en ${posName} (${dateStr})`,
                                employeeId: assignments[helperSwap.occupantIdx].employeeId,
                                dateStr,
                            });
                            ladderStats.bandSwap += 1;
                            if (opts.allowFrancoTrabajado)
                                ladderStats.ft += 1;
                            filled = true;
                        }
                    }
                    const francoOnPosition = assignments
                        .map((a, i) => ({ a, i }))
                        .filter(({ a }) => {
                        if (a.dateStr !== dateStr)
                            return false;
                        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
                            return false;
                        const c = String(a.code || '').toUpperCase();
                        if (!FRANCO_POOL.has(c))
                            return false;
                        return opts.defaultPositionByEmp[a.employeeId] === posName;
                    });
                    const cyclePref = {
                        openingSlotByEmp: opts.openingSlotByEmp,
                        dateStrList,
                        cycle,
                        defaultShiftByEmp: opts.defaultShiftByEmp,
                        useTrailing: opts.useTrailing,
                        trailingEmpIds: fillCtx.trailingEmpIds,
                    };
                    const francoSorted = sortFrancoCandidatesByCycle(francoOnPosition, dateStr, shiftCode, cyclePref);
                    const pick6x2Legal = francoSorted.find(({ a }) => candidateCanFill({ ...fillCtx, empId: a.employeeId, dateStr, shiftCode, cycle }));
                    const pick6x2Ft = !pick6x2Legal && opts.allowFrancoTrabajado
                        ? francoSorted.find(({ a }) => candidateCanFill({
                            ...fillCtx,
                            empId: a.employeeId,
                            dateStr,
                            shiftCode,
                            cycle,
                            francoTrabajado: true,
                        }))
                        : undefined;
                    const pick6x2 = pick6x2Legal ?? pick6x2Ft;
                    if (pick6x2) {
                        assignCell(assignments, pick6x2.i, shiftCode, posName, pos);
                        const usedFt = !pick6x2Legal && !!pick6x2Ft;
                        log.push({
                            code: usedFt ? 'LADDER_FT' : 'LADDER_6X2',
                            message: (0, vplan_brain_model_1.ladderMessage)(usedFt ? 'FT_FRANCO_TRABAJADO' : 'SUBGRUPO_6X2_LEGAL', dateStr, posName, shiftCode),
                            employeeId: assignments[pick6x2.i].employeeId,
                            dateStr,
                        });
                        if (usedFt)
                            ladderStats.ft += 1;
                        else
                            ladderStats.subgrupo6x2 += 1;
                        filled = true;
                    }
                    if (!filled && hourHeadroom.canUseContingency4x2) {
                        const contCode = contingencyShiftCode(shiftCode);
                        if (contCode && positionHasShift(pos, contCode)) {
                            const pick4x2 = sortFrancoCandidatesByCycle(francoOnPosition, dateStr, contCode, cyclePref).find(({ a }) => candidateCanFill({
                                ...fillCtx,
                                empId: a.employeeId,
                                dateStr,
                                shiftCode: contCode,
                                cycle: '4+2',
                            }));
                            if (pick4x2) {
                                assignCell(assignments, pick4x2.i, contCode, posName, pos);
                                log.push({
                                    code: 'LADDER_4X2',
                                    message: (0, vplan_brain_model_1.ladderMessage)('REFUERZO_4X2_OBJETIVO', dateStr, posName, contCode),
                                    employeeId: assignments[pick4x2.i].employeeId,
                                    dateStr,
                                });
                                ladderStats.refuerzo4x2 += 1;
                                filled = true;
                            }
                        }
                    }
                    if (!filled) {
                        const francoPool = assignments
                            .map((a, i) => ({ a, i }))
                            .filter(({ a }) => {
                            if (a.dateStr !== dateStr)
                                return false;
                            if (!pool.has(a.employeeId))
                                return false;
                            if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
                                return false;
                            const c = String(a.code || '').toUpperCase();
                            if (!FRANCO_POOL.has(c))
                                return false;
                            if (opts.defaultPositionByEmp[a.employeeId] === posName)
                                return false;
                            if (opts.excludeCustomCrossPool && !(0, vplan_custom_schedule_1.isCustomEmployeeCrossAssignable)({
                                empId: a.employeeId,
                                positions: opts.positions,
                                defaultPositionByEmp: opts.defaultPositionByEmp,
                            }))
                                return false;
                            return true;
                        });
                        const pickPool = sortFrancoCandidatesByCycle(francoPool, dateStr, shiftCode, cyclePref).find(({ a }) => candidateCanFill({ ...fillCtx, empId: a.employeeId, dateStr, shiftCode, cycle }));
                        if (pickPool) {
                            assignCell(assignments, pickPool.i, shiftCode, posName, pos);
                            log.push({
                                code: 'LADDER_POOL',
                                message: (0, vplan_brain_model_1.ladderMessage)('SIN_TURNO_OBJETIVO', dateStr, posName, shiftCode),
                                employeeId: assignments[pickPool.i].employeeId,
                                dateStr,
                            });
                            ladderStats.sinTurno += 1;
                            filled = true;
                        }
                        else if (hourHeadroom.canUseContingency4x2) {
                            const contCode = contingencyShiftCode(shiftCode);
                            if (contCode && positionHasShift(pos, contCode)) {
                                const pickPool4 = francoPool.find(({ a }) => candidateCanFill({
                                    ...fillCtx,
                                    empId: a.employeeId,
                                    dateStr,
                                    shiftCode: contCode,
                                    cycle: '4+2',
                                }));
                                if (pickPool4) {
                                    assignCell(assignments, pickPool4.i, contCode, posName, pos);
                                    log.push({
                                        code: 'LADDER_4X2',
                                        message: (0, vplan_brain_model_1.ladderMessage)('REFUERZO_4X2_OBJETIVO', dateStr, posName, contCode),
                                        employeeId: assignments[pickPool4.i].employeeId,
                                        dateStr,
                                    });
                                    ladderStats.refuerzo4x2 += 1;
                                    filled = true;
                                }
                            }
                        }
                    }
                    if (!filled) {
                        const retPick = assignments.findIndex((a) => a.dateStr === dateStr
                            && String(a.code || '').toUpperCase() === 'RET'
                            && !(0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId)
                            && (opts.defaultPositionByEmp[a.employeeId] === posName
                                || pool.has(a.employeeId)));
                        if (retPick >= 0) {
                            const retEmp = assignments[retPick].employeeId;
                            if (candidateCanFill({ ...fillCtx, empId: retEmp, dateStr, shiftCode, cycle })) {
                                assignCell(assignments, retPick, shiftCode, posName, pos);
                                log.push({
                                    code: 'LADDER_RET',
                                    message: (0, vplan_brain_model_1.ladderMessage)('RET_OBJETIVO', dateStr, posName, shiftCode),
                                    employeeId: retEmp,
                                    dateStr,
                                });
                                ladderStats.ret += 1;
                                filled = true;
                            }
                        }
                    }
                    if (!filled) {
                        const francoObjective = assignments
                            .map((a, i) => ({ a, i }))
                            .filter(({ a }) => {
                            if (a.dateStr !== dateStr)
                                return false;
                            if (!pool.has(a.employeeId))
                                return false;
                            if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
                                return false;
                            const c = String(a.code || '').toUpperCase();
                            return FRANCO_POOL.has(c);
                        });
                        const pickFt = francoObjective.find(({ a }) => candidateCanFill({
                            ...fillCtx,
                            empId: a.employeeId,
                            dateStr,
                            shiftCode,
                            cycle,
                            francoTrabajado: true,
                        }));
                        if (pickFt) {
                            assignCell(assignments, pickFt.i, shiftCode, posName, pos);
                            log.push({
                                code: 'LADDER_FT',
                                message: `${(0, vplan_brain_model_1.ladderMessage)('FT_FRANCO_TRABAJADO', dateStr, posName, shiftCode)} · ${assignments[pickFt.i].employeeId}`,
                                employeeId: assignments[pickFt.i].employeeId,
                                dateStr,
                            });
                            ladderStats.ft += 1;
                            filled = true;
                        }
                    }
                    if (filled) {
                        used = countBandSlotsFilled(assignments, dateStr, posName, band, opts.defaultPositionByEmp);
                        daySlotCount.set(key, used);
                        if (used + syntheticFilled > progressBefore)
                            continue;
                        filled = false;
                    }
                    markNeedsReinforcement(assignments, dateStr, posName, shiftCode);
                    log.push({
                        code: 'NEEDS_REINFORCEMENT',
                        message: `Sin candidato 6+2 legal — ${shiftCode} en ${posName} (${dateStr})`,
                        dateStr,
                    });
                    ladderStats.needsReinforcement += 1;
                    syntheticFilled += 1;
                }
            }
        }
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
        ladderStats,
    };
}
//# sourceMappingURL=vplan.coverage-ladder.js.map