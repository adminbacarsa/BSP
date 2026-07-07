"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLD_START_12 = exports.COLD_START_24 = exports.CYCLE_12_DN = exports.CYCLE_24_MTN = void 0;
exports.normalizeCycleKey = normalizeCycleKey;
exports.is4x2Cycle = is4x2Cycle;
exports.getCycleTemplate = getCycleTemplate;
exports.cycleLength = cycleLength;
exports.coldStartOpenings = coldStartOpenings;
exports.subgroupSize = subgroupSize;
exports.normalizeCodeForCycle = normalizeCodeForCycle;
exports.isCycleWorkCode = isCycleWorkCode;
exports.isFrancoCycleCode = isFrancoCycleCode;
exports.bandZoneForSlot = bandZoneForSlot;
exports.maxWorkStreak = maxWorkStreak;
exports.billableHoursForCode = billableHoursForCode;
exports.inferCycleSlotFromTrailing = inferCycleSlotFromTrailing;
exports.inferTrailingOpeningSlots = inferTrailingOpeningSlots;
exports.CYCLE_24_MTN = [
    ...Array(6).fill('M'),
    ...Array(2).fill('F'),
    ...Array(6).fill('T'),
    ...Array(2).fill('F'),
    ...Array(6).fill('N'),
    ...Array(2).fill('F'),
];
exports.CYCLE_12_DN = [
    ...Array(4).fill('D12'),
    ...Array(2).fill('F'),
    ...Array(4).fill('N12'),
    ...Array(2).fill('F'),
];
exports.COLD_START_24 = [4, 10, 16, 22];
exports.COLD_START_12 = [2, 6, 10];
const WORK_8 = new Set(['M', 'T', 'N']);
const WORK_12 = new Set(['D12', 'N12']);
const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
function normalizeCycleKey(cycle) {
    if (cycle === '4+2' || cycle === '5+1' || cycle === '6+1')
        return cycle;
    return '6+2';
}
function is4x2Cycle(cycle) {
    return normalizeCycleKey(cycle) === '4+2';
}
function getCycleTemplate(cycle) {
    return is4x2Cycle(cycle) ? exports.CYCLE_12_DN : exports.CYCLE_24_MTN;
}
function cycleLength(cycle) {
    return getCycleTemplate(cycle).length;
}
function coldStartOpenings(cycle) {
    return is4x2Cycle(cycle) ? exports.COLD_START_12 : exports.COLD_START_24;
}
function subgroupSize(cycle) {
    return is4x2Cycle(cycle) ? 3 : 4;
}
function normalizeCodeForCycle(code, cycle) {
    const c = code.toUpperCase();
    if (!is4x2Cycle(cycle))
        return c;
    if (c === 'M' || c === 'T' || c === 'D12')
        return 'D12';
    if (c === 'N' || c === 'N12')
        return 'N12';
    if (FRANCO.has(c))
        return 'F';
    return c;
}
function isCycleWorkCode(code, cycle) {
    const c = code.toUpperCase();
    if (FRANCO.has(c))
        return false;
    if (is4x2Cycle(cycle))
        return WORK_12.has(c);
    return WORK_8.has(c) || WORK_12.has(c);
}
function isFrancoCycleCode(code) {
    return FRANCO.has(code.toUpperCase());
}
function bandZoneForSlot(slot, cycle) {
    const len = cycleLength(cycle);
    const s = ((slot % len) + len) % len;
    return getCycleTemplate(cycle)[s];
}
function maxWorkStreak(cycle) {
    const key = normalizeCycleKey(cycle);
    if (key === '4+2')
        return 4;
    if (key === '5+1')
        return 5;
    if (key === '6+1')
        return 6;
    return 6;
}
function billableHoursForCode(code, cycle) {
    const c = code.toUpperCase();
    if (FRANCO.has(c))
        return 0;
    if (c === 'D12' || c === 'N12')
        return 12;
    if (is4x2Cycle(cycle) && WORK_8.has(c))
        return 12;
    return 8;
}
const FRANCO_SET = FRANCO;
const WORK_8_SET = WORK_8;
function inferCycleSlotFromTrailing(lastCode, trailingWork, trailingRest, lastWorkBand, cycle = '6+2') {
    if (!lastCode)
        return null;
    const template = getCycleTemplate(cycle);
    const len = template.length;
    let code = lastCode.toUpperCase();
    if (is4x2Cycle(cycle))
        code = normalizeCodeForCycle(code, cycle);
    const workBlock = is4x2Cycle(cycle) ? 4 : 6;
    const candidates = [];
    if (code === 'RET' || code === 'R') {
        const band = (lastWorkBand || '').toUpperCase();
        const effective = is4x2Cycle(cycle) ? normalizeCodeForCycle(band, cycle) : band;
        if (!isCycleWorkCode(effective, cycle))
            return null;
        code = effective;
    }
    for (let day1 = 0; day1 < len; day1++) {
        const prevDay = (day1 - 1 + len) % len;
        if (template[prevDay] !== code)
            continue;
        if (isCycleWorkCode(code, cycle)) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (template[(prevDay - b + len) % len] !== code)
                    break;
                ok += 1;
            }
            if (ok >= need)
                candidates.push(day1);
        }
        else if (FRANCO_SET.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (template[(prevDay - b + len) % len] !== 'F')
                    break;
                ok += 1;
            }
            if (ok < need)
                continue;
            if (need === 1 && template[day1] !== 'F')
                continue;
            if (need >= 2 && !isCycleWorkCode(String(template[day1]), cycle))
                continue;
            candidates.push(day1);
        }
    }
    if (candidates.length === 0)
        return null;
    if (isCycleWorkCode(code, cycle)) {
        const streak = trailingWork ?? 1;
        const continueSameBand = streak < workBlock;
        if (continueSameBand) {
            const same = candidates.find((d) => template[d] === code);
            if (same !== undefined)
                return same;
        }
        else {
            const franco = candidates.find((d) => template[d] === 'F');
            if (franco !== undefined)
                return franco;
        }
    }
    return candidates[0];
}
function inferTrailingOpeningSlots(prevPlanningState, cycle = '6+2') {
    const out = {};
    for (const empId of Object.keys(prevPlanningState.lastShiftByEmp || {})) {
        const slot = inferCycleSlotFromTrailing(prevPlanningState.lastShiftByEmp?.[empId], prevPlanningState.trailingWorkDays?.[empId], prevPlanningState.trailingRestDays?.[empId], prevPlanningState.lastWorkBandBeforeRest?.[empId], cycle);
        if (slot !== null)
            out[empId] = slot;
    }
    return out;
}
//# sourceMappingURL=vplan.cycle-templates.js.map