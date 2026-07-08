"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CYCLE_12_DN = exports.CYCLE_24_MTN = void 0;
exports.shiftEndMs = shiftEndMs;
exports.shiftStartMs = shiftStartMs;
exports.restHoursBetweenShiftAssignments = restHoursBetweenShiftAssignments;
exports.restHoursBetweenBands = restHoursBetweenBands;
exports.workBand = workBand;
exports.isFrancoCode = isFrancoCode;
exports.isIllegalBandTransition = isIllegalBandTransition;
exports.transitionIsLegal = transitionIsLegal;
exports.expectedCycleCodeForEmployeeDay = expectedCycleCodeForEmployeeDay;
exports.realignVplanDraftToCycle = realignVplanDraftToCycle;
exports.countFrancosBetweenAssignments = countFrancosBetweenAssignments;
exports.guardIllegalBandTransitions = guardIllegalBandTransitions;
exports.protectedCellKey = protectedCellKey;
exports.computeOpeningProtectedCells = computeOpeningProtectedCells;
exports.computeOpeningRestProtectedCells = computeOpeningRestProtectedCells;
exports.patchMonthOpeningContinuity = patchMonthOpeningContinuity;
exports.detectCrossMonthContinuityViolations = detectCrossMonthContinuityViolations;
exports.detectIllegalBandTransitions = detectIllegalBandTransitions;
exports.enforceIllegalBandRest = enforceIllegalBandRest;
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_positions_1 = require("./vplan.positions");
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const vplan_assignment_hours_1 = require("./vplan.assignment-hours");
const vplan_rotation_1 = require("./vplan.rotation");
const vplan_coverage_guard_1 = require("./vplan.coverage-guard");
var vplan_cycle_templates_2 = require("./vplan.cycle-templates");
Object.defineProperty(exports, "CYCLE_24_MTN", { enumerable: true, get: function () { return vplan_cycle_templates_2.CYCLE_24_MTN; } });
Object.defineProperty(exports, "CYCLE_12_DN", { enumerable: true, get: function () { return vplan_cycle_templates_2.CYCLE_12_DN; } });
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'AA', 'RET', 'R', 'ESC', 'REF']);
const DEFAULT_MIN_REST_HOURS = 12;
const BAND_SCHEDULE = {
    M: { startMin: 7 * 60, endMin: 15 * 60 },
    T: { startMin: 15 * 60, endMin: 23 * 60 },
    N: { startMin: 23 * 60, endMin: 7 * 60 },
};
function dateTimeMs(dateStr, minutesOfDay) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayOffset = Math.floor(minutesOfDay / (24 * 60));
    const modMin = ((minutesOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
    return new Date(y, m - 1, d + dayOffset, Math.floor(modMin / 60), modMin % 60, 0, 0).getTime();
}
function shiftEndMs(dateStr, band) {
    const sched = BAND_SCHEDULE[band];
    if (band === 'N') {
        return dateTimeMs(dateStr, sched.endMin + 24 * 60);
    }
    return dateTimeMs(dateStr, sched.endMin);
}
function shiftStartMs(dateStr, band) {
    return dateTimeMs(dateStr, BAND_SCHEDULE[band].startMin);
}
function restHoursBetweenShiftAssignments(prevDate, prev, nextDate, next) {
    return (shiftStartMs(nextDate, next) - shiftEndMs(prevDate, prev)) / 3_600_000;
}
function restHoursBetweenBands(prev, next) {
    return restHoursBetweenShiftAssignments('2000-01-01', prev, '2000-01-02', next);
}
function workBand(code) {
    const c = code.toUpperCase();
    if (c === 'D12')
        return 'M';
    if (c === 'N12')
        return 'N';
    if (WORK_BANDS.has(c))
        return c;
    return null;
}
function isFrancoCode(code) {
    return FRANCO_CODES.has(code.toUpperCase());
}
function isIllegalBandTransition(prev, next, minRestHours = DEFAULT_MIN_REST_HOURS, dates) {
    return !transitionIsLegal(prev, next, 0, minRestHours, dates);
}
function transitionIsLegal(prev, next, francosBetween, minRestHours = DEFAULT_MIN_REST_HOURS, dates) {
    if (francosBetween >= 1)
        return true;
    if (prev === next)
        return true;
    const rest = dates
        ? restHoursBetweenShiftAssignments(dates.prevDate, prev, dates.nextDate, next)
        : restHoursBetweenBands(prev, next);
    return rest >= minRestHours;
}
function assignmentKey(empId, dateStr) {
    return `${empId}_${dateStr}`;
}
function expectedCycleCodeForEmployeeDay(opening, dayIndex, cycle, fixedBand, skipFixedOverride = false) {
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)(cycle);
    const raw = template[(opening + dayIndex) % template.length];
    if ((0, vplan_cycle_templates_1.is4x2Cycle)(cycle))
        return raw;
    if (!skipFixedOverride
        && fixedBand
        && WORK_BANDS.has(fixedBand)
        && WORK_BANDS.has(raw)) {
        return fixedBand;
    }
    return raw;
}
function shouldSkipRealign(code) {
    const c = code.toUpperCase();
    return ABSENCE_CODES.has(c) || isFrancoCode(c);
}
function realignVplanDraftToCycle(opts) {
    const cycle = opts.cycle ?? '6+2';
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)(cycle);
    const log = [];
    const trailingEmpIds = new Set(Object.keys(opts.prevPlanningState.lastShiftByEmp || {}));
    const indexByKey = new Map();
    opts.draft.assignments.forEach((a, i) => {
        indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i);
    });
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    for (const [empId, opening] of Object.entries(opts.openingSlotByEmp)) {
        if (opening === undefined || opening === null)
            continue;
        const skipFixed = Boolean(opts.useTrailing && trailingEmpIds.has(empId));
        const fixedBand = opts.defaultShiftByEmp?.[empId]?.toUpperCase();
        opts.dateStrs.forEach((dateStr, di) => {
            const key = assignmentKey(empId, dateStr);
            if (opts.protectedCells?.has(key))
                return;
            const idx = indexByKey.get(key);
            if (idx === undefined)
                return;
            const current = assignments[idx];
            if (shouldSkipRealign(current.code))
                return;
            const expected = expectedCycleCodeForEmployeeDay(opening, di, cycle, fixedBand, skipFixed);
            if (current.code.toUpperCase() === expected)
                return;
            const prevCode = current.code;
            const hours = expected === 'F' ? 0 : (0, vplan_cycle_templates_1.billableHoursForCode)(expected, cycle);
            assignments[idx] = {
                ...current,
                code: expected,
                hours,
                positionName: expected === 'F' ? '' : current.positionName,
            };
            log.push({
                code: 'CYCLE_REALIGN',
                message: `${prevCode} → ${expected} (slot ${opening}, día ${di + 1})`,
                employeeId: empId,
                dateStr,
            });
        });
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
    };
}
function countFrancosBetween(byDate, fromDate, toDate) {
    let count = 0;
    for (const [dateStr, a] of byDate) {
        if (dateStr <= fromDate || dateStr >= toDate)
            continue;
        if (isFrancoCode(a.code))
            count += 1;
    }
    return count;
}
function countFrancosBetweenAssignments(assignments, empId, fromDate, toDate) {
    const byDate = new Map();
    for (const a of assignments) {
        if (a.employeeId === empId)
            byDate.set(a.dateStr, a);
    }
    return countFrancosBetween(byDate, fromDate, toDate);
}
function pickLegalBandReplacement(prev, illegalNext, prevDate, nextDate, francos, minRest) {
    const candidates = [illegalNext, prev, 'F', 'M', 'T', 'N'];
    for (const candidate of candidates) {
        const band = workBand(candidate);
        if (!band)
            return 'F';
        if (transitionIsLegal(prev, band, francos, minRest, { prevDate, nextDate })) {
            return candidate;
        }
    }
    return 'F';
}
function applyBandFix(assignments, indexByKey, byDate, empId, dateStr, replacement, log, reason, opts) {
    const key = assignmentKey(empId, dateStr);
    if (opts?.protectedCells?.has(key)) {
        log.push({
            code: 'BAND_SKIP_PROTECTED',
            message: `${reason}: celda protegida (continuidad mes)`,
            employeeId: empId,
            dateStr,
        });
        return;
    }
    const idx = indexByKey.get(key);
    if (idx === undefined)
        return;
    const rep = replacement.toUpperCase();
    if (rep === 'F'
        && opts?.coverageGuard?.protect
        && (0, vplan_coverage_guard_1.wouldReduceCoverageByForcingFranco)({
            assignments,
            draftMeta: opts.draftMeta,
            guard: opts.coverageGuard,
            empId,
            dateStr,
        })) {
        log.push({
            code: 'BAND_DEFER_COVERAGE',
            message: `${reason}: fix diferido (protege slot SLA)`,
            employeeId: empId,
            dateStr,
        });
        return;
    }
    const prev = assignments[idx].code;
    assignments[idx] = {
        ...assignments[idx],
        code: replacement,
        hours: replacement === 'F' ? 0 : (0, vplan_cycle_templates_1.billableHoursForCode)(replacement, opts?.cycle ?? '6+2'),
        positionName: replacement === 'F' ? '' : assignments[idx].positionName,
    };
    byDate.set(dateStr, assignments[idx]);
    log.push({
        code: 'BAND_SKIP_ILLEGAL',
        message: `${reason}: ${prev} → ${replacement}`,
        employeeId: empId,
        dateStr,
    });
}
function guardIllegalBandTransitions(opts) {
    const cycle = opts.cycle ?? '6+2';
    const template = (0, vplan_cycle_templates_1.getCycleTemplate)(cycle);
    const minRest = opts.minRestHoursBetweenBands ?? DEFAULT_MIN_REST_HOURS;
    const log = [];
    const byEmp = new Map();
    for (const a of opts.draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const indexByKey = new Map();
    assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));
    const prevByEmp = new Map();
    for (const a of opts.previousMonthAssignments ?? []) {
        if (!prevByEmp.has(a.employeeId))
            prevByEmp.set(a.employeeId, new Map());
        prevByEmp.get(a.employeeId).set(a.dateStr, a);
    }
    function seedLastWorkFromPrevMonth(empId) {
        const prevDays = prevByEmp.get(empId);
        if (!prevDays)
            return null;
        const dates = [...prevDays.keys()].sort().reverse();
        for (const d of dates) {
            const code = String(prevDays.get(d)?.code || '').toUpperCase();
            const band = workBand(code);
            if (band)
                return { dateStr: d, band, code };
        }
        return null;
    }
    for (const [empId, byDate] of byEmp) {
        let lastWork = null;
        const opening = opts.openingSlotByEmp?.[empId];
        const prevSeed = seedLastWorkFromPrevMonth(empId);
        for (const dateStr of opts.dateStrs) {
            const a = byDate.get(dateStr);
            if (!a)
                continue;
            const band = workBand(a.code);
            if (!band)
                continue;
            if (!lastWork && opts.monthFirstDate && dateStr === opts.monthFirstDate && prevSeed) {
                lastWork = prevSeed;
            }
            if (lastWork) {
                const isCrossMonth = Boolean(opts.monthFirstDate
                    && lastWork.dateStr < opts.monthFirstDate
                    && dateStr === opts.monthFirstDate);
                const francos = isCrossMonth
                    ? 0
                    : countFrancosBetween(byDate, lastWork.dateStr, dateStr);
                if (!transitionIsLegal(lastWork.band, band, francos, minRest, {
                    prevDate: lastWork.dateStr,
                    nextDate: dateStr,
                })) {
                    const di = opts.dateStrs.indexOf(dateStr);
                    let replacement = pickLegalBandReplacement(lastWork.band, band, lastWork.dateStr, dateStr, francos, minRest);
                    if (opening !== undefined && di >= 0) {
                        const fromTemplate = template[(opening + di) % template.length];
                        const templateBand = workBand(fromTemplate);
                        if (fromTemplate === 'F'
                            || (templateBand && transitionIsLegal(lastWork.band, templateBand, francos, minRest, {
                                prevDate: lastWork.dateStr,
                                nextDate: dateStr,
                            }))) {
                            replacement = fromTemplate;
                        }
                    }
                    applyBandFix(assignments, indexByKey, byDate, empId, dateStr, replacement, log, `${lastWork.band}→${band} ilegal (${lastWork.dateStr}→${dateStr}, ${francos}F)`, {
                        draftMeta: opts.draft,
                        coverageGuard: opts.coverageGuard,
                        protectedCells: opts.protectedCells,
                        cycle,
                    });
                    const fixedBand = workBand(replacement);
                    if (fixedBand) {
                        lastWork = { dateStr, band: fixedBand, code: replacement };
                    }
                    continue;
                }
            }
            lastWork = { dateStr, band, code: a.code };
        }
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
    };
}
function codeOnPrevDay(byDate, dateStr) {
    const c = byDate.get(dateStr)?.code;
    return c ? String(c).toUpperCase() : undefined;
}
function addCalendarDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d)
        return undefined;
    const dt = new Date(y, m - 1, d + 1, 12, 0, 0);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}
function addCalendarDayOffset(dateStr, offset) {
    let cur = dateStr;
    for (let i = 0; i < offset; i++) {
        const next = addCalendarDay(cur);
        if (!next)
            return undefined;
        cur = next;
    }
    return cur;
}
function protectedCellKey(empId, dateStr) {
    return assignmentKey(empId, dateStr);
}
function buildOpeningContinuityTargets(opts) {
    if (!opts.useTrailing || !opts.prevMonthLastDate || !opts.monthFirstDate) {
        return [];
    }
    const cycle = opts.cycle ?? '6+2';
    const maxStreak = (0, vplan_cycle_templates_1.maxWorkStreak)(cycle);
    const targets = [];
    const prevByEmp = new Map();
    for (const a of opts.previousMonthAssignments) {
        if (!prevByEmp.has(a.employeeId))
            prevByEmp.set(a.employeeId, new Map());
        prevByEmp.get(a.employeeId).set(a.dateStr, a);
    }
    const draftAssignments = opts.draftAssignments ?? [];
    const indexByKey = new Map();
    draftAssignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));
    const empIds = new Set([
        ...Object.keys(opts.prevPlanningState.lastShiftByEmp || {}),
        ...prevByEmp.keys(),
    ]);
    const customPosNames = new Set(opts.positions.filter((p) => (0, vplan_positions_1.isCustomFixedShiftPosition)(p)).map((p) => p.positionName));
    const isCustomEmployee = (empId) => {
        const posName = opts.defaultPositionByEmp[empId];
        if (posName && customPosNames.has(posName))
            return true;
        const idx = indexByKey.get(assignmentKey(empId, opts.monthFirstDate));
        if (idx === undefined)
            return false;
        const c = draftAssignments[idx]?.code?.toUpperCase() ?? '';
        return c === 'EN' || c === 'RO' || c === 'RON';
    };
    for (const empId of empIds) {
        if ((0, vplan_positions_1.isVirtualEmployeeId)(empId))
            continue;
        if (isCustomEmployee(empId))
            continue;
        const prevDays = prevByEmp.get(empId);
        const prevEmpDates = prevDays ? [...prevDays.keys()].sort() : [];
        const lastAssignDate = prevEmpDates.length > 0
            ? prevEmpDates[prevEmpDates.length - 1]
            : opts.prevMonthLastDate;
        let lastJunCode = prevDays
            ? codeOnPrevDay(prevDays, lastAssignDate)
            : undefined;
        if (!lastJunCode) {
            lastJunCode = opts.prevPlanningState.lastShiftByEmp?.[empId]?.toUpperCase();
        }
        if (!lastJunCode)
            continue;
        const lastCode = (0, vplan_cycle_templates_1.is4x2Cycle)(cycle)
            ? (0, vplan_cycle_templates_1.normalizeCodeForCycle)(lastJunCode, cycle)
            : lastJunCode;
        const lastBand = workBand(lastCode);
        if (!lastBand)
            continue;
        let trailingWork = (0, vplan_cct_enforce_1.trailingWorkFromPrevMonth)(opts.previousMonthAssignments.filter((a) => a.employeeId === empId), empId, cycle);
        if (trailingWork <= 0) {
            trailingWork = opts.prevPlanningState.trailingWorkDays?.[empId] ?? 0;
        }
        if (trailingWork <= 0 || trailingWork >= maxStreak)
            continue;
        const fixedBandRaw = opts.defaultShiftByEmp[empId]?.toUpperCase();
        const fixedBand = fixedBandRaw && workBand(fixedBandRaw) ? fixedBandRaw : undefined;
        let expectedCode;
        if (fixedBand) {
            if (lastBand !== workBand(fixedBand))
                continue;
            expectedCode = fixedBand;
        }
        else {
            expectedCode = lastCode;
        }
        if (!isCycleWorkCode(expectedCode, cycle))
            continue;
        const fixedPos = opts.defaultPositionByEmp[empId] || '';
        targets.push({
            empId,
            dateStr: opts.monthFirstDate,
            expectedCode,
            kind: 'continue',
            lastAssignDate,
            lastCode,
            trailingWork,
            fixedPos,
            lastBand,
            offset: 0,
            maxStreak,
            restDays: (0, vplan_rotation_1.maxRestStreak)(cycle),
        });
        const workAfterOpenDay = trailingWork + 1;
        if (workAfterOpenDay >= maxStreak) {
            const restDays = (0, vplan_rotation_1.maxRestStreak)(cycle);
            for (let restOffset = 0; restOffset < restDays; restOffset++) {
                const closeDateStr = addCalendarDayOffset(opts.monthFirstDate, 1 + restOffset);
                if (!closeDateStr)
                    break;
                targets.push({
                    empId,
                    dateStr: closeDateStr,
                    expectedCode: 'F',
                    kind: 'close',
                    lastAssignDate,
                    lastCode,
                    trailingWork,
                    fixedPos,
                    lastBand,
                    offset: 1 + restOffset,
                    restOffset,
                    maxStreak,
                    restDays,
                });
            }
        }
    }
    return targets;
}
function computeOpeningProtectedCells(opts) {
    return new Set(buildOpeningContinuityTargets(opts)
        .filter((t) => t.kind === 'continue' && t.offset === 0)
        .map((t) => assignmentKey(t.empId, t.dateStr)));
}
function computeOpeningRestProtectedCells(opts) {
    return new Set(buildOpeningContinuityTargets(opts)
        .filter((t) => t.kind === 'close')
        .map((t) => assignmentKey(t.empId, t.dateStr)));
}
function patchMonthOpeningContinuity(opts) {
    const log = [];
    const cycle = opts.cycle ?? '6+2';
    const targets = buildOpeningContinuityTargets({
        ...opts,
        draftAssignments: opts.draft.assignments,
    });
    if (targets.length === 0) {
        return { draft: opts.draft, log };
    }
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const indexByKey = new Map();
    assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));
    for (const t of targets) {
        const idx = indexByKey.get(assignmentKey(t.empId, t.dateStr));
        if (idx === undefined)
            continue;
        const current = assignments[idx];
        const currentNorm = (0, vplan_cycle_templates_1.is4x2Cycle)(cycle)
            ? (0, vplan_cycle_templates_1.normalizeCodeForCycle)(current.code, cycle)
            : current.code.toUpperCase();
        if (t.kind === 'continue') {
            if (currentNorm === t.expectedCode)
                continue;
            if (!isCycleWorkCode(currentNorm, cycle) && currentNorm !== 'F')
                continue;
            assignments[idx] = {
                ...current,
                code: t.expectedCode,
                hours: t.expectedCode === 'F'
                    ? 0
                    : (0, vplan_assignment_hours_1.resolveAssignmentBillableHours)({ ...current, code: t.expectedCode, positionName: t.fixedPos || current.positionName || '' }, { cycle, positions: opts.positions }),
                positionName: t.fixedPos || current.positionName || '',
            };
            log.push({
                code: 'MONTH_OPENING_STREAK_CONTINUE',
                message: `${t.lastAssignDate} ${t.lastCode} (racha ${t.trailingWork}+${t.offset + 1}) ${current.code} → ${t.expectedCode}`,
                employeeId: t.empId,
                dateStr: t.dateStr,
            });
            continue;
        }
        if (!isCycleWorkCode(currentNorm, cycle))
            continue;
        assignments[idx] = {
            ...current,
            code: 'F',
            hours: 0,
            positionName: '',
        };
        log.push({
            code: 'MONTH_OPENING_STREAK_CLOSE',
            message: `Cierre bloque ${t.lastBand}×${t.maxStreak} (${(t.restOffset ?? 0) + 1}/${t.restDays}F) ${current.code} → F`,
            employeeId: t.empId,
            dateStr: t.dateStr,
        });
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
    };
}
function isCycleWorkCode(code, cycle) {
    const c = code.toUpperCase();
    if ((0, vplan_cycle_templates_1.is4x2Cycle)(cycle))
        return c === 'D12' || c === 'N12';
    return c === 'M' || c === 'T' || c === 'N';
}
function countTrailingWorkInBand(prevDays, lastDate, band) {
    if (!prevDays)
        return undefined;
    let work = 0;
    const dates = [...prevDays.keys()].filter((d) => d <= lastDate).sort().reverse();
    for (const d of dates) {
        const b = workBand(String(prevDays.get(d)?.code || ''));
        if (!b)
            break;
        if (b === band)
            work += 1;
        else if (work > 0)
            break;
    }
    return work > 0 ? work : undefined;
}
function detectCrossMonthContinuityViolations(opts) {
    const cycle = opts.cycle ?? '6+2';
    const maxStreak = (0, vplan_cycle_templates_1.maxWorkStreak)(cycle);
    const violations = [];
    const prevByEmp = new Map();
    for (const a of opts.previousMonthAssignments) {
        if (!prevByEmp.has(a.employeeId))
            prevByEmp.set(a.employeeId, new Map());
        prevByEmp.get(a.employeeId).set(a.dateStr, a);
    }
    const julByEmp = new Map();
    for (const a of opts.draft.assignments) {
        if (a.dateStr === opts.monthFirstDate)
            julByEmp.set(a.employeeId, a);
    }
    const customPosNames = new Set(opts.positions.filter((p) => (0, vplan_positions_1.isCustomFixedShiftPosition)(p)).map((p) => p.positionName));
    const empIds = new Set([
        ...prevByEmp.keys(),
        ...Object.keys(opts.prevPlanningState.lastShiftByEmp || {}),
    ]);
    for (const empId of empIds) {
        const prevDays = prevByEmp.get(empId);
        const prevEmpDates = prevDays ? [...prevDays.keys()].sort() : [];
        const lastAssignDate = prevEmpDates.length > 0
            ? prevEmpDates[prevEmpDates.length - 1]
            : opts.prevMonthLastDate;
        const posName = opts.defaultPositionByEmp[empId];
        if (posName && customPosNames.has(posName))
            continue;
        const jul1Row = julByEmp.get(empId);
        const julCodeCheck = jul1Row?.code?.toUpperCase() ?? '';
        if (julCodeCheck === 'EN' || julCodeCheck === 'RO' || julCodeCheck === 'RON')
            continue;
        let lastJun = prevDays?.get(lastAssignDate)?.code?.toUpperCase();
        if (!lastJun) {
            lastJun = opts.prevPlanningState.lastShiftByEmp?.[empId]?.toUpperCase();
        }
        if (!lastJun)
            continue;
        const lastCode = (0, vplan_cycle_templates_1.is4x2Cycle)(cycle) ? (0, vplan_cycle_templates_1.normalizeCodeForCycle)(lastJun, cycle) : lastJun;
        const lastBand = workBand(lastCode);
        if (!lastBand)
            continue;
        let trailingWork = (0, vplan_cct_enforce_1.trailingWorkFromPrevMonth)(opts.previousMonthAssignments.filter((a) => a.employeeId === empId), empId, cycle);
        if (trailingWork <= 0) {
            trailingWork = opts.prevPlanningState.trailingWorkDays?.[empId] ?? 0;
        }
        if (trailingWork <= 0 || trailingWork >= maxStreak)
            continue;
        const expectedCode = lastCode;
        if (!isCycleWorkCode(expectedCode, cycle))
            continue;
        const julRow = julByEmp.get(empId);
        if (!julRow)
            continue;
        const julCode = (0, vplan_cycle_templates_1.is4x2Cycle)(cycle)
            ? (0, vplan_cycle_templates_1.normalizeCodeForCycle)(julRow.code, cycle)
            : julRow.code.toUpperCase();
        if (julCode === expectedCode)
            continue;
        if (!isCycleWorkCode(julCode, cycle) && julCode !== 'F')
            continue;
        if (julCode === 'F') {
            const monthDateStrs = [...new Set(opts.draft.assignments.map((a) => a.dateStr))].sort();
            const cct = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
                assignments: opts.draft.assignments,
                dateStrs: monthDateStrs,
                empId,
                dateStr: opts.monthFirstDate,
                shiftCode: expectedCode,
                cycle,
                previousMonthAssignments: opts.previousMonthAssignments,
            });
            if (!cct.ok)
                continue;
        }
        violations.push({
            employeeId: empId,
            fromDate: lastAssignDate,
            toDate: opts.monthFirstDate,
            fromCode: lastJun,
            toCode: julRow.code,
            expectedCode,
        });
    }
    return violations;
}
function detectIllegalBandTransitions(draft, dateStrs, minRestHours = DEFAULT_MIN_REST_HOURS) {
    const violations = [];
    const byEmp = new Map();
    for (const a of draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    for (const [empId, byDate] of byEmp) {
        let lastWork = null;
        for (const dateStr of dateStrs) {
            const a = byDate.get(dateStr);
            if (!a)
                continue;
            const band = workBand(a.code);
            if (!band)
                continue;
            if (lastWork) {
                const francos = countFrancosBetween(byDate, lastWork.dateStr, dateStr);
                if (!transitionIsLegal(lastWork.band, band, francos, minRestHours, {
                    prevDate: lastWork.dateStr,
                    nextDate: dateStr,
                })) {
                    violations.push({
                        employeeId: empId,
                        fromDate: lastWork.dateStr,
                        toDate: dateStr,
                        fromCode: lastWork.code,
                        toCode: a.code,
                    });
                }
            }
            lastWork = { dateStr, band, code: a.code };
        }
    }
    return violations;
}
function enforceIllegalBandRest(opts) {
    const log = [];
    const minRest = opts.minRestHours ?? DEFAULT_MIN_REST_HOURS;
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const fixedKeys = new Set();
    let violations = detectIllegalBandTransitions({ ...opts.draft, assignments }, opts.dateStrs, minRest);
    while (violations.length > 0) {
        let progress = false;
        for (const v of violations) {
            const toKey = protectedCellKey(v.employeeId, v.toDate);
            if (fixedKeys.has(toKey))
                continue;
            const fromIdx = assignments.findIndex((a) => a.employeeId === v.employeeId && a.dateStr === v.fromDate);
            const fromKey = protectedCellKey(v.employeeId, v.fromDate);
            const canFixFrom = fromIdx >= 0
                && !opts.protectedCells?.has(fromKey)
                && !fixedKeys.has(fromKey)
                && workBand(String(assignments[fromIdx].code || '')) !== null;
            if (canFixFrom) {
                const trial = assignments.map((a) => ({ ...a }));
                trial[fromIdx] = {
                    ...trial[fromIdx],
                    code: 'F',
                    positionName: '',
                    hours: 0,
                };
                const stillBad = detectIllegalBandTransitions({ ...opts.draft, assignments: trial }, opts.dateStrs, minRest).some((x) => x.employeeId === v.employeeId && x.toDate === v.toDate);
                if (!stillBad) {
                    assignments[fromIdx] = trial[fromIdx];
                    log.push({
                        code: 'BAND_REST_FIX_PRIOR',
                        message: `${v.fromCode} → F (${v.fromCode} ${v.fromDate} → ${v.toCode} ${v.toDate} — libera ${v.toCode} ${v.toDate})`,
                        employeeId: v.employeeId,
                        dateStr: v.fromDate,
                    });
                    fixedKeys.add(fromKey);
                    progress = true;
                    continue;
                }
            }
            if (opts.protectedCells?.has(toKey))
                continue;
            const toIdx = assignments.findIndex((a) => a.employeeId === v.employeeId && a.dateStr === v.toDate);
            if (toIdx < 0)
                continue;
            assignments[toIdx] = {
                ...assignments[toIdx],
                code: 'F',
                positionName: '',
                hours: 0,
            };
            log.push({
                code: 'BAND_REST_FIX',
                message: `${v.toCode} → F (descanso insuficiente ${v.fromCode} ${v.fromDate} → ${v.toCode} ${v.toDate})`,
                employeeId: v.employeeId,
                dateStr: v.toDate,
            });
            fixedKeys.add(toKey);
            progress = true;
        }
        if (!progress)
            break;
        violations = detectIllegalBandTransitions({ ...opts.draft, assignments }, opts.dateStrs, minRest);
    }
    return { draft: { ...opts.draft, assignments }, log };
}
//# sourceMappingURL=vplan.cycle-continuity.js.map