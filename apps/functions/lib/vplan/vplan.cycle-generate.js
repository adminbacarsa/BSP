"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOpeningSlotsForVplan = resolveOpeningSlotsForVplan;
exports.generateCycleAssignments = generateCycleAssignments;
exports.mergeCycleWithEngineAssignments = mergeCycleWithEngineAssignments;
exports.inferOpeningSlotsFromHistory4x2 = inferOpeningSlotsFromHistory4x2;
exports.generate4x2Assignments = generate4x2Assignments;
exports.is4x2CycleMode = is4x2CycleMode;
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const vplan_rotation_1 = require("./vplan.rotation");
const vplan_positions_1 = require("./vplan.positions");
const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
function dayLetter(dateStr) {
    return DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];
}
function isActiveDay(pos, dayLetterStr) {
    const days = pos.activeDays;
    if (!days || days.length >= 7)
        return true;
    return days.includes(dayLetterStr);
}
function inferOpeningSlot12(lastCode, trailingWork, trailingRest) {
    if (!lastCode)
        return null;
    const code = (0, vplan_cycle_templates_1.normalizeCodeForCycle)(lastCode, '4+2');
    for (let day1 = 0; day1 < 12; day1++) {
        const prevDay = (day1 - 1 + 12) % 12;
        if (vplan_cycle_templates_1.CYCLE_12_DN[prevDay] !== code)
            continue;
        if ((0, vplan_cycle_templates_1.isCycleWorkCode)(code, '4+2')) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (vplan_cycle_templates_1.CYCLE_12_DN[(prevDay - b + 12) % 12] !== code)
                    break;
                ok += 1;
            }
            if (ok >= need)
                return day1;
        }
        else if ((0, vplan_cycle_templates_1.isFrancoCycleCode)(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (vplan_cycle_templates_1.CYCLE_12_DN[(prevDay - b + 12) % 12] !== 'F')
                    break;
                ok += 1;
            }
            if (ok < need)
                continue;
            if (need === 1 && vplan_cycle_templates_1.CYCLE_12_DN[day1] !== 'F')
                continue;
            if (need >= 2 && !(0, vplan_cycle_templates_1.isCycleWorkCode)(vplan_cycle_templates_1.CYCLE_12_DN[day1], '4+2'))
                continue;
            return day1;
        }
    }
    return null;
}
function resolveOpeningSlots12(ctx, subgroups) {
    const out = {};
    const cold = (0, vplan_cycle_templates_1.coldStartOpenings)('4+2');
    const ZONE_SLOT = { D12: 2, N12: 6, F: 10 };
    for (const groupIds of subgroups) {
        const regularIds = groupIds.slice(0, (0, vplan_cycle_templates_1.subgroupSize)('4+2'));
        const withTrail = [];
        const withoutTrail = [];
        for (const empId of regularIds) {
            const slot = inferOpeningSlot12(ctx.prevMonthLastShiftByEmp?.[empId], ctx.prevMonthTrailingWorkDays?.[empId], ctx.prevMonthTrailingRestDays?.[empId]);
            if (slot !== null) {
                out[empId] = slot;
                withTrail.push(empId);
            }
            else {
                withoutTrail.push(empId);
            }
        }
        const usedZones = new Set();
        for (const empId of [...withTrail]) {
            const zone = (0, vplan_cycle_templates_1.bandZoneForSlot)(out[empId], '4+2');
            if (!usedZones.has(zone))
                usedZones.add(zone);
            else {
                delete out[empId];
                withoutTrail.push(empId);
            }
        }
        const firstTrail = withTrail.find((id) => out[id] !== undefined);
        const anchor = firstTrail !== undefined ? out[firstTrail] : cold[0];
        const canonicalForZone = {};
        for (let k = 0; k < 3; k++) {
            const s = ((anchor + k * 4) % 12 + 12) % 12;
            const z = (0, vplan_cycle_templates_1.bandZoneForSlot)(s, '4+2');
            if (!(z in canonicalForZone))
                canonicalForZone[z] = s;
        }
        for (const empId of withTrail) {
            if (out[empId] === undefined)
                continue;
            const zone = (0, vplan_cycle_templates_1.bandZoneForSlot)(out[empId], '4+2');
            const c = canonicalForZone[zone];
            if (c !== undefined)
                out[empId] = c;
        }
        const ALL_ZONES = ['D12', 'N12', 'F'];
        const available = new Set(ALL_ZONES.filter((z) => !usedZones.has(z)));
        withoutTrail.forEach((empId, i) => {
            const fixed = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            let zone = ALL_ZONES[i % 3];
            if (fixed === 'D12' || fixed === 'M' || fixed === 'T')
                zone = 'D12';
            else if (fixed === 'N12' || fixed === 'N')
                zone = 'N12';
            else if (available.size > 0)
                zone = [...available][0];
            available.delete(zone);
            out[empId] = canonicalForZone[zone] ?? ZONE_SLOT[zone] ?? cold[i % cold.length];
        });
        groupIds.slice((0, vplan_cycle_templates_1.subgroupSize)('4+2')).forEach((empId, fi) => {
            const slot = inferOpeningSlot12(ctx.prevMonthLastShiftByEmp?.[empId], ctx.prevMonthTrailingWorkDays?.[empId], ctx.prevMonthTrailingRestDays?.[empId]);
            out[empId] = slot ?? cold[fi % cold.length];
        });
    }
    return out;
}
function buildSubgroups(positionGroups, positions, cycle) {
    const result = [];
    const size = (0, vplan_cycle_templates_1.subgroupSize)(cycle);
    for (const [posName, groupIds] of Object.entries(positionGroups)) {
        const pos = positions.find((p) => p.positionName === posName);
        if (!pos || !(0, vplan_positions_1.is24hsPosition)(pos))
            continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7)
            continue;
        const qty = Math.max(1, pos.qty);
        const subgroupCount = Math.min(qty, Math.floor(groupIds.length / size));
        if (subgroupCount === 0)
            continue;
        for (let i = 0; i < subgroupCount; i++) {
            const core = groupIds.slice(i * size, i * size + size);
            result.push({
                positionName: posName,
                subgroupIndex: i,
                subgroupCount,
                employeeIds: [...core],
            });
        }
        const floaters = groupIds.slice(subgroupCount * size);
        floaters.forEach((id, fi) => {
            const target = result[fi % subgroupCount];
            if (target)
                target.employeeIds.push(id);
        });
    }
    return result;
}
function spreadCollidingOpeningSlots(slots, employeeIds, cycle) {
    const len = (0, vplan_cycle_templates_1.cycleLength)(cycle);
    const bySlot = new Map();
    for (const empId of employeeIds) {
        const s = slots[empId];
        if (s === undefined)
            continue;
        if (!bySlot.has(s))
            bySlot.set(s, []);
        bySlot.get(s).push(empId);
    }
    for (const [baseSlot, emps] of bySlot) {
        if (emps.length <= 1)
            continue;
        emps.forEach((empId, i) => {
            slots[empId] = ((baseSlot + i) % len + len) % len;
        });
    }
}
function subgroupPhaseOffset(cycle, subgroupIndex, subgroupCount) {
    if (subgroupCount <= 1 || subgroupIndex === 0)
        return 0;
    const profile = (0, vplan_rotation_1.getRotationProfile)(cycle);
    return subgroupIndex * profile.workersPerDay;
}
function resolveOpeningSlotsForVplan(opts) {
    const trailingSlots = opts.useTrailing
        ? (0, vplan_cycle_templates_1.inferTrailingOpeningSlots)(opts.prevPlanningState, opts.cycle)
        : {};
    const len = (0, vplan_cycle_templates_1.getCycleTemplate)(opts.cycle).length;
    const stagger = (0, vplan_cycle_templates_1.is4x2Cycle)(opts.cycle) ? 4 : 6;
    const size = (0, vplan_cycle_templates_1.subgroupSize)(opts.cycle);
    const cold = (0, vplan_cycle_templates_1.coldStartOpenings)(opts.cycle);
    const subgroups = buildSubgroups(opts.positionGroups, opts.positions, opts.cycle);
    const out = { ...opts.engineSlots };
    let trailingAnchors = 0;
    for (const subgroup of subgroups) {
        const regular = subgroup.employeeIds.slice(0, size);
        const floaters = subgroup.employeeIds.slice(size);
        const sgOffset = subgroupPhaseOffset(opts.cycle, subgroup.subgroupIndex, subgroup.subgroupCount);
        let anchorOpening;
        for (const empId of regular) {
            if (trailingSlots[empId] !== undefined) {
                anchorOpening = trailingSlots[empId];
                trailingAnchors += 1;
                break;
            }
        }
        if (anchorOpening === undefined) {
            for (const empId of regular) {
                if (opts.engineSlots[empId] !== undefined) {
                    anchorOpening = opts.engineSlots[empId];
                    break;
                }
            }
        }
        if (anchorOpening === undefined) {
            anchorOpening = cold[subgroup.subgroupIndex % cold.length] ?? cold[0];
        }
        regular.forEach((empId, i) => {
            const trail = trailingSlots[empId];
            const engine = opts.engineSlots[empId];
            if (trail !== undefined) {
                out[empId] = sgOffset > 0
                    ? ((trail + sgOffset) % len + len) % len
                    : trail;
                return;
            }
            if (engine !== undefined) {
                out[empId] = sgOffset > 0
                    ? ((engine + sgOffset) % len + len) % len
                    : engine;
                return;
            }
            out[empId] = ((anchorOpening + sgOffset + i * stagger) % len + len) % len;
        });
        spreadCollidingOpeningSlots(out, regular, opts.cycle);
        floaters.forEach((empId, fi) => {
            const trail = trailingSlots[empId];
            if (trail !== undefined) {
                out[empId] = sgOffset > 0
                    ? ((trail + sgOffset) % len + len) % len
                    : trail;
            }
            else if (opts.engineSlots[empId] !== undefined) {
                const engine = opts.engineSlots[empId];
                out[empId] = sgOffset > 0
                    ? ((engine + sgOffset) % len + len) % len
                    : engine;
            }
            else {
                const anchor = regular[fi % regular.length];
                out[empId] = anchor !== undefined ? out[anchor] : anchorOpening;
            }
        });
        spreadCollidingOpeningSlots(out, subgroup.employeeIds, opts.cycle);
    }
    return {
        slots: out,
        trailingCount: trailingAnchors,
        historyCount: 0,
    };
}
function generateCycleAssignments(opts) {
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)(opts.cycle);
    const len = template.length;
    const empToPosition = {};
    for (const [posName, ids] of Object.entries(opts.positionGroups)) {
        ids.forEach((id) => { empToPosition[id] = posName; });
    }
    const assignments = [];
    for (const [empId, opening] of Object.entries(opts.openingSlotByEmp)) {
        const posName = empToPosition[empId];
        const pos = opts.positions.find((p) => p.positionName === posName);
        if (!pos || !(0, vplan_positions_1.is24hsPosition)(pos))
            continue;
        opts.dateStrs.forEach((dateStr, di) => {
            if (opts.ctx.absences[empId]?.has(dateStr))
                return;
            const letter = dayLetter(dateStr);
            if (!isActiveDay(pos, letter))
                return;
            const rawCode = template[(opening + di) % len];
            const hours = (0, vplan_cycle_templates_1.billableHoursForCode)(rawCode, opts.cycle);
            const isFranco = rawCode === 'F';
            assignments.push({
                employeeId: empId,
                dateStr,
                code: rawCode,
                positionName: isFranco ? '' : posName,
                hours,
            });
        });
    }
    return assignments;
}
function mergeCycleWithEngineAssignments(engineAssignments, cycleAssignments, openingSlotByEmp) {
    const cycleEmpIds = new Set(Object.keys(openingSlotByEmp));
    const cycleKeys = new Set(cycleAssignments.map((a) => `${a.employeeId}_${a.dateStr}`));
    const kept = engineAssignments.filter((a) => !cycleEmpIds.has(a.employeeId));
    const cycleMerged = cycleAssignments.filter((a) => cycleKeys.has(`${a.employeeId}_${a.dateStr}`));
    return [...kept, ...cycleMerged];
}
function inferOpeningSlotsFromHistory4x2(assignments, monthDateStrs, targetMonthFirstDateStr) {
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)('4+2');
    const len = template.length;
    const byEmp = new Map();
    const anchor = new Date(`${targetMonthFirstDateStr}T12:00:00`).getTime();
    for (const a of assignments) {
        if (!monthDateStrs.includes(a.dateStr))
            continue;
        const code = (0, vplan_cycle_templates_1.normalizeCodeForCycle)(a.code, '4+2');
        if (!(0, vplan_cycle_templates_1.isCycleWorkCode)(code, '4+2') && !(0, vplan_cycle_templates_1.isFrancoCycleCode)(code))
            continue;
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, []);
        byEmp.get(a.employeeId).push({ dateStr: a.dateStr, code });
    }
    const out = {};
    for (const [empId, rows] of byEmp) {
        if (rows.length < 3)
            continue;
        rows.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        let bestSlot = null;
        let bestScore = -Infinity;
        for (let opening = 0; opening < len; opening++) {
            let score = 0;
            for (const row of rows) {
                const offset = Math.round((new Date(`${row.dateStr}T12:00:00`).getTime() - anchor) / 86_400_000);
                const expected = template[(opening + offset + len * 200) % len];
                if (expected === row.code)
                    score += 3;
                else if ((0, vplan_cycle_templates_1.isFrancoCycleCode)(row.code) && expected === 'F')
                    score += 2;
                else if ((0, vplan_cycle_templates_1.isCycleWorkCode)(row.code, '4+2') && (0, vplan_cycle_templates_1.isCycleWorkCode)(String(expected), '4+2'))
                    score -= 2;
            }
            if (score > bestScore) {
                bestScore = score;
                bestSlot = opening;
            }
        }
        const minScore = Math.max(4, Math.floor(rows.length * 1.5));
        if (bestSlot !== null && bestScore >= minScore) {
            out[empId] = bestSlot;
        }
    }
    return out;
}
function generate4x2Assignments(opts) {
    const assignments = generateCycleAssignments({
        ctx: opts.ctx,
        positions: opts.positions,
        positionGroups: opts.positionGroups,
        dateStrs: opts.dateStrs,
        openingSlotByEmp: opts.openingSlotByEmp,
        cycle: '4+2',
    });
    return { assignments, openingSlotByEmp: opts.openingSlotByEmp };
}
function is4x2CycleMode(cycle) {
    return (0, vplan_cycle_templates_1.is4x2Cycle)(cycle);
}
//# sourceMappingURL=vplan.cycle-generate.js.map