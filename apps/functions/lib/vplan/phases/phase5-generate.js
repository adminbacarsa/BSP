"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanGeneration = runVplanGeneration;
const planning_rules_service_1 = require("../../planning/planning-rules.service");
const autoScheduleEngine_1 = require("../../scheduling/autoScheduleEngine");
const vplan_cct_enforce_1 = require("../vplan.cct-enforce");
const vplan_coverage_guard_1 = require("../vplan.coverage-guard");
const vplan_cycle_continuity_1 = require("../vplan.cycle-continuity");
const vplan_cycle_generate_1 = require("../vplan.cycle-generate");
const vplan_calendar_1 = require("../vplan.calendar");
const vplan_coverage_ladder_1 = require("../vplan.coverage-ladder");
const phase5_cover_slots_1 = require("./phase5-cover-slots");
const vplan_coverage_manifest_1 = require("../vplan.coverage-manifest");
const vplan_coverage_audit_1 = require("../vplan.coverage-audit");
const vplan_hour_rebalance_1 = require("../vplan.hour-rebalance");
const vplan_custom_schedule_1 = require("../vplan.custom-schedule");
const vplan_sla_enforce_1 = require("../vplan.sla-enforce");
const vplan_positions_1 = require("../vplan.positions");
const vplan_assigned_positions_1 = require("../vplan.assigned-positions");
const vplan_engine_bridge_1 = require("../vplan.engine-bridge");
const vplan_assignment_hours_1 = require("../vplan.assignment-hours");
const vplan_cycle_templates_1 = require("../vplan.cycle-templates");
function runVplanGeneration(opts) {
    const cycle = opts.strategy.cycle;
    const is4x2 = (0, vplan_cycle_templates_1.is4x2Cycle)(cycle);
    const fixLog = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.planningRules ?? null);
    const cyclePositions = (0, vplan_positions_1.positionsForCycle)(opts.snapshot.positions, cycle);
    const mergedDefaultPositionByEmp = (0, vplan_sla_enforce_1.capDefaultPositionByEmp)(cyclePositions, {
        ...opts.prevPlanningState.defaultPositionByEmp,
        ...opts.planningState.defaultPositionByEmp,
    }, cycle);
    const mergedDefaultShiftByEmp = {
        ...opts.prevPlanningState.defaultShiftByEmp,
        ...opts.planningState.defaultShiftByEmp,
    };
    const ctx = (0, vplan_engine_bridge_1.buildEngineContext)({
        snapshot: opts.snapshot,
        planningState: opts.planningState,
        prevPlanningState: opts.prevPlanningState,
        strategy: opts.strategy,
    });
    const result = (0, autoScheduleEngine_1.generateSchedule)(ctx);
    const dateStrs = opts.snapshot.days.map((d) => d.dateStr);
    const monthFirstDate = dateStrs[0] ?? '';
    const positionGroups = result.stats.positionGroups ?? {};
    const prevMonthDateStrs = opts.snapshot.previousMonthAssignments.length > 0
        ? [...new Set(opts.snapshot.previousMonthAssignments.map((a) => a.dateStr))].sort()
        : [];
    let assignments = (0, vplan_engine_bridge_1.engineToVplanAssignments)(result.assignments);
    const resolved = (0, vplan_cycle_generate_1.resolveOpeningSlotsForVplan)({
        cycle,
        prevPlanningState: opts.prevPlanningState,
        prevAssignments: opts.snapshot.previousMonthAssignments,
        prevMonthDateStrs,
        monthFirstDate,
        engineSlots: result.stats.openingSlotByEmp ?? {},
        useTrailing: opts.strategy.modes.useTrailing,
        positionGroups,
        positions: opts.snapshot.positions,
    });
    const openingSlotByEmp = resolved.slots;
    const trailingEmployeeIds = Object.keys(opts.prevPlanningState.lastShiftByEmp || {});
    const ladderCycleOpts = {
        openingSlotByEmp,
        defaultShiftByEmp: mergedDefaultShiftByEmp,
        useTrailing: opts.strategy.modes.useTrailing,
        trailingEmployeeIds,
    };
    const sourceEngineBase = `vplan:${opts.strategy.engine}:${cycle}`;
    const coverageGuard = opts.demand && rules.protectCoverageOnEnforce
        ? (0, vplan_coverage_guard_1.buildCoverageGuard)({
            protect: true,
            demand: opts.demand,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            dateStrList: dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        })
        : undefined;
    const runCctEnforce = (assignmentsIn, useCoverageGuard = false) => (0, vplan_cct_enforce_1.enforceCctWorkRestPattern)({
        draft: { assignments: assignmentsIn, sourceEngine: `${sourceEngineBase}:motor+ladder` },
        dateStrs,
        cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        protectedCells,
        rules,
        coverageGuard: useCoverageGuard ? coverageGuard : undefined,
    });
    if (opts.strategy.modes.preserveExisting && opts.snapshot.existingAssignments.length > 0) {
        const existingMap = new Map();
        for (const a of opts.snapshot.existingAssignments) {
            existingMap.set(`${a.employeeId}_${a.dateStr}`, a);
        }
        const generatedMap = new Map();
        for (const a of assignments) {
            generatedMap.set(`${a.employeeId}_${a.dateStr}`, a);
        }
        const mergedKeys = new Set([...existingMap.keys(), ...generatedMap.keys()]);
        assignments = [];
        for (const key of mergedKeys) {
            assignments.push(existingMap.get(key) ?? generatedMap.get(key));
        }
    }
    const runYear = opts.snapshot.days[0]?.dateStr
        ? Number(opts.snapshot.days[0].dateStr.slice(0, 4))
        : 0;
    const runMonth = opts.snapshot.days[0]?.dateStr
        ? Number(opts.snapshot.days[0].dateStr.slice(5, 7))
        : 0;
    const prevCal = runYear && runMonth ? (0, vplan_calendar_1.previousMonth)(runYear, runMonth) : null;
    const prevCalLast = prevCal
        ? (0, vplan_calendar_1.buildMonthDays)(prevCal.year, prevCal.month).at(-1)?.dateStr
        : undefined;
    const prevMonthLastDate = prevCalLast
        ?? (prevMonthDateStrs.length > 0 ? prevMonthDateStrs[prevMonthDateStrs.length - 1] : '');
    let protectedCells;
    if (opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate) {
        const patched = (0, vplan_cycle_continuity_1.patchMonthOpeningContinuity)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate,
            monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            cycle,
            useTrailing: true,
        });
        assignments = patched.draft.assignments;
        fixLog.push(...patched.log);
        protectedCells = new Set([
            ...(0, vplan_cycle_continuity_1.computeOpeningProtectedCells)({
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                prevMonthLastDate,
                monthFirstDate,
                prevPlanningState: opts.prevPlanningState,
                positions: opts.snapshot.positions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                defaultShiftByEmp: mergedDefaultShiftByEmp,
                cycle,
                useTrailing: true,
                draftAssignments: assignments,
            }),
            ...(0, vplan_cycle_continuity_1.computeOpeningRestProtectedCells)({
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                prevMonthLastDate,
                monthFirstDate,
                prevPlanningState: opts.prevPlanningState,
                positions: opts.snapshot.positions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                defaultShiftByEmp: mergedDefaultShiftByEmp,
                cycle,
                useTrailing: true,
                draftAssignments: assignments,
            }),
        ]);
        const strippedSla = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            protectedCells,
        });
        assignments = strippedSla.draft.assignments;
        fixLog.push(...strippedSla.log);
        const realigned = (0, vplan_cycle_continuity_1.realignVplanDraftToCycle)({
            draft: { assignments, sourceEngine: `${sourceEngineBase}:motor+ladder` },
            dateStrs,
            openingSlotByEmp,
            prevPlanningState: opts.prevPlanningState,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            useTrailing: opts.strategy.modes.useTrailing,
            cycle,
            protectedCells,
        });
        assignments = realigned.draft.assignments;
        fixLog.push(...realigned.log);
        const mandatoryRest = (0, vplan_cct_enforce_1.computeMandatoryRestCells)({
            assignments,
            dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
        });
        const mandatoryFixed = (0, vplan_cct_enforce_1.enforceMandatoryRestCells)({
            draft: { assignments, sourceEngine: `${sourceEngineBase}:motor+ladder` },
            mandatoryCells: mandatoryRest,
            dateStrs,
            cycle,
            protectedCells,
        });
        assignments = mandatoryFixed.draft.assignments;
        fixLog.push(...mandatoryFixed.log);
        if (mandatoryRest.size > 0) {
            protectedCells = new Set([...(protectedCells ?? []), ...mandatoryRest]);
        }
        const earlyBandRest = (0, vplan_cycle_continuity_1.enforceIllegalBandRest)({
            draft: { assignments, sourceEngine: `${sourceEngineBase}:motor+ladder` },
            dateStrs,
            minRestHours: rules.minRestHoursBetweenBands ?? 12,
            protectedCells,
        });
        assignments = earlyBandRest.draft.assignments;
        fixLog.push(...earlyBandRest.log);
    }
    else {
        const strippedSla = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
        });
        assignments = strippedSla.draft.assignments;
        fixLog.push(...strippedSla.log);
    }
    const customFixed = (0, vplan_custom_schedule_1.enforceCustomPositionSchedules)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        absences: opts.snapshot.absences,
        openingSlotByEmp,
    });
    assignments = customFixed.draft.assignments;
    fixLog.push(...customFixed.log);
    const positionFixed = (0, vplan_assigned_positions_1.enforceAssigned24hsPositions)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
    });
    assignments = positionFixed.draft.assignments;
    fixLog.push(...positionFixed.log);
    const cctEnforced = runCctEnforce(assignments);
    assignments = cctEnforced.draft.assignments;
    fixLog.push(...cctEnforced.log);
    const offerHours = opts.snapshot.employees.length * (rules.targetAvgHoursPerEmployee ?? 192);
    let slotCoverageResult;
    if (opts.demand?.coverageManifest) {
        slotCoverageResult = (0, phase5_cover_slots_1.runVplanSlotCoverage)({
            draft: { assignments, sourceEngine: `${sourceEngineBase}:motor+cover` },
            demand: opts.demand,
            manifest: opts.demand.coverageManifest,
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells,
            openingSlotByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            useTrailing: opts.strategy.modes.useTrailing,
            trailingEmployeeIds,
            excludeCustomCrossPool: true,
            allowFrancoTrabajado: true,
        });
        assignments = slotCoverageResult.draft.assignments;
        fixLog.push(...slotCoverageResult.log);
    }
    const gapFilled = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        slaVendidas: opts.snapshot.slaVendidas,
        offerHours,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        rules,
        protectedCells,
    });
    assignments = gapFilled.draft.assignments;
    fixLog.push(...gapFilled.log);
    const rebalanced = (0, vplan_hour_rebalance_1.rebalanceHoursTowardSla)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        slaVendidas: opts.snapshot.slaVendidas,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
        protectedCells,
    });
    assignments = rebalanced.draft.assignments;
    fixLog.push(...rebalanced.log);
    const cctFinal = runCctEnforce(assignments);
    assignments = cctFinal.draft.assignments;
    fixLog.push(...cctFinal.log);
    if (cctFinal.log.length > 0) {
        const gapRefill = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells,
        });
        assignments = gapRefill.draft.assignments;
        fixLog.push(...gapRefill.log);
        gapFilled.ladderStats.subgrupo6x2 += gapRefill.ladderStats.subgrupo6x2;
        gapFilled.ladderStats.refuerzo4x2 += gapRefill.ladderStats.refuerzo4x2;
        gapFilled.ladderStats.sinTurno += gapRefill.ladderStats.sinTurno;
        gapFilled.ladderStats.ret += gapRefill.ladderStats.ret;
        gapFilled.ladderStats.ft += gapRefill.ladderStats.ft;
        gapFilled.ladderStats.needsReinforcement += gapRefill.ladderStats.needsReinforcement;
        gapFilled.ladderStats.bandSwap += gapRefill.ladderStats.bandSwap;
        const rebalance2 = (0, vplan_hour_rebalance_1.rebalanceHoursTowardSla)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            slaVendidas: opts.snapshot.slaVendidas,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells,
        });
        assignments = rebalance2.draft.assignments;
        fixLog.push(...rebalance2.log);
        rebalanced.hoursAdded += rebalance2.hoursAdded;
        const cctAfterRebalance = runCctEnforce(assignments);
        assignments = cctAfterRebalance.draft.assignments;
        fixLog.push(...cctAfterRebalance.log);
        const gapRefill2 = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells,
        });
        assignments = gapRefill2.draft.assignments;
        fixLog.push(...gapRefill2.log);
        gapFilled.ladderStats.subgrupo6x2 += gapRefill2.ladderStats.subgrupo6x2;
        gapFilled.ladderStats.refuerzo4x2 += gapRefill2.ladderStats.refuerzo4x2;
        gapFilled.ladderStats.sinTurno += gapRefill2.ladderStats.sinTurno;
        gapFilled.ladderStats.ret += gapRefill2.ladderStats.ret;
        gapFilled.ladderStats.ft += gapRefill2.ladderStats.ft;
        gapFilled.ladderStats.needsReinforcement += gapRefill2.ladderStats.needsReinforcement;
        gapFilled.ladderStats.bandSwap += gapRefill2.ladderStats.bandSwap;
        const rebalance3 = (0, vplan_hour_rebalance_1.rebalanceHoursTowardSla)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            slaVendidas: opts.snapshot.slaVendidas,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells,
        });
        assignments = rebalance3.draft.assignments;
        fixLog.push(...rebalance3.log);
        rebalanced.hoursAdded += rebalance3.hoursAdded;
        const cctFinal2 = runCctEnforce(assignments);
        assignments = cctFinal2.draft.assignments;
        fixLog.push(...cctFinal2.log);
    }
    for (let closePass = 0; closePass < 2; closePass += 1) {
        const closeLadder = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells,
        });
        assignments = closeLadder.draft.assignments;
        fixLog.push(...closeLadder.log);
        gapFilled.ladderStats.subgrupo6x2 += closeLadder.ladderStats.subgrupo6x2;
        gapFilled.ladderStats.refuerzo4x2 += closeLadder.ladderStats.refuerzo4x2;
        gapFilled.ladderStats.sinTurno += closeLadder.ladderStats.sinTurno;
        gapFilled.ladderStats.ret += closeLadder.ladderStats.ret;
        gapFilled.ladderStats.ft += closeLadder.ladderStats.ft;
        gapFilled.ladderStats.needsReinforcement += closeLadder.ladderStats.needsReinforcement;
        gapFilled.ladderStats.bandSwap += closeLadder.ladderStats.bandSwap;
        gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + (closeLadder.ladderStats.auditGap ?? 0);
        const closeCct = runCctEnforce(assignments, true);
        assignments = closeCct.draft.assignments;
        fixLog.push(...closeCct.log);
        let auditFilledThisPass = 0;
        if (opts.demand) {
            const auditFill = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                demand: opts.demand,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                dateStrList: dateStrs,
                cycle,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                rules,
                protectedCells,
                ...ladderCycleOpts,
            });
            assignments = auditFill.draft.assignments;
            fixLog.push(...auditFill.log);
            gapFilled.ladderStats.subgrupo6x2 += auditFill.ladderStats.subgrupo6x2;
            auditFilledThisPass = auditFill.ladderStats.auditGap;
            gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + auditFilledThisPass;
        }
        if (closeCct.log.length === 0 && auditFilledThisPass === 0)
            break;
    }
    if (opts.demand) {
        for (let finalPass = 0; finalPass < 6; finalPass += 1) {
            const finalCct = runCctEnforce(assignments);
            assignments = finalCct.draft.assignments;
            fixLog.push(...finalCct.log);
            const finalAuditFill = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                demand: opts.demand,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                dateStrList: dateStrs,
                cycle,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                rules,
                protectedCells,
                ...ladderCycleOpts,
            });
            assignments = finalAuditFill.draft.assignments;
            fixLog.push(...finalAuditFill.log);
            gapFilled.ladderStats.subgrupo6x2 += finalAuditFill.ladderStats.subgrupo6x2;
            gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + finalAuditFill.ladderStats.auditGap;
            const ladderClose = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs: opts.snapshot.days,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                cycle,
                dateStrList: dateStrs,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                slaVendidas: opts.snapshot.slaVendidas,
                offerHours,
                employeeIds: opts.snapshot.employees.map((e) => e.id),
                rules,
                protectedCells,
                ...ladderCycleOpts,
            });
            assignments = ladderClose.draft.assignments;
            fixLog.push(...ladderClose.log);
            gapFilled.ladderStats.subgrupo6x2 += ladderClose.ladderStats.subgrupo6x2;
            gapFilled.ladderStats.refuerzo4x2 += ladderClose.ladderStats.refuerzo4x2;
            gapFilled.ladderStats.sinTurno += ladderClose.ladderStats.sinTurno;
            gapFilled.ladderStats.ret += ladderClose.ladderStats.ret;
            gapFilled.ladderStats.ft += ladderClose.ladderStats.ft;
            gapFilled.ladderStats.needsReinforcement += ladderClose.ladderStats.needsReinforcement;
            gapFilled.ladderStats.bandSwap += ladderClose.ladderStats.bandSwap;
            const ladderMoved = ladderClose.ladderStats.subgrupo6x2
                + ladderClose.ladderStats.refuerzo4x2
                + ladderClose.ladderStats.sinTurno
                + ladderClose.ladderStats.ret
                + ladderClose.ladderStats.ft
                + ladderClose.ladderStats.bandSwap;
            if (finalCct.log.length === 0
                && finalAuditFill.ladderStats.auditGap === 0
                && ladderMoved === 0) {
                break;
            }
        }
        for (let bandPass = 0; bandPass < 3; bandPass += 1) {
            const bandFix = (0, vplan_cycle_continuity_1.enforceIllegalBandRest)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs,
                minRestHours: rules.minRestHoursBetweenBands ?? 12,
                protectedCells,
            });
            if (bandFix.log.length === 0)
                break;
            assignments = bandFix.draft.assignments;
            fixLog.push(...bandFix.log);
            const postBandCct = runCctEnforce(assignments);
            assignments = postBandCct.draft.assignments;
            fixLog.push(...postBandCct.log);
            const postBandAudit = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                demand: opts.demand,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                dateStrList: dateStrs,
                cycle,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                rules,
                protectedCells,
                ...ladderCycleOpts,
            });
            assignments = postBandAudit.draft.assignments;
            fixLog.push(...postBandAudit.log);
            gapFilled.ladderStats.subgrupo6x2 += postBandAudit.ladderStats.subgrupo6x2;
            gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + postBandAudit.ladderStats.auditGap;
            const postBandLadder = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs: opts.snapshot.days,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                cycle,
                dateStrList: dateStrs,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                slaVendidas: opts.snapshot.slaVendidas,
                offerHours,
                employeeIds: opts.snapshot.employees.map((e) => e.id),
                rules,
                protectedCells,
                ...ladderCycleOpts,
            });
            assignments = postBandLadder.draft.assignments;
            fixLog.push(...postBandLadder.log);
            gapFilled.ladderStats.subgrupo6x2 += postBandLadder.ladderStats.subgrupo6x2;
            gapFilled.ladderStats.sinTurno += postBandLadder.ladderStats.sinTurno;
            gapFilled.ladderStats.bandSwap += postBandLadder.ladderStats.bandSwap;
        }
    }
    const customFinal = (0, vplan_custom_schedule_1.enforceCustomPositionSchedules)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        absences: opts.snapshot.absences,
        openingSlotByEmp,
    });
    assignments = customFinal.draft.assignments;
    fixLog.push(...customFinal.log);
    if (opts.demand) {
        const customWeekendProtected = (0, vplan_custom_schedule_1.computeCustomScheduleProtectedCells)({
            dateStrs: opts.snapshot.days,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            draftAssignments: assignments,
        });
        const weekendProtected = customWeekendProtected.size > 0
            ? new Set([...(protectedCells ?? []), ...customWeekendProtected])
            : protectedCells;
        const postCustomRest = (0, vplan_custom_schedule_1.enforceMaxRestStreak)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells: weekendProtected,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
        });
        assignments = postCustomRest.draft.assignments;
        fixLog.push(...postCustomRest.log);
        const postCustomLadder = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells: weekendProtected,
            excludeCustomCrossPool: true,
            allowFrancoTrabajado: true,
            ...ladderCycleOpts,
        });
        assignments = postCustomLadder.draft.assignments;
        fixLog.push(...postCustomLadder.log);
        gapFilled.ladderStats.subgrupo6x2 += postCustomLadder.ladderStats.subgrupo6x2;
        gapFilled.ladderStats.sinTurno += postCustomLadder.ladderStats.sinTurno;
        gapFilled.ladderStats.ft += postCustomLadder.ladderStats.ft;
        gapFilled.ladderStats.needsReinforcement += postCustomLadder.ladderStats.needsReinforcement;
        const postCustomAudit = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            demand: opts.demand,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            dateStrList: dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells: weekendProtected,
            allowFrancoTrabajado: true,
            ...ladderCycleOpts,
        });
        assignments = postCustomAudit.draft.assignments;
        fixLog.push(...postCustomAudit.log);
        gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + postCustomAudit.ladderStats.auditGap;
        gapFilled.ladderStats.bandSwap = (gapFilled.ladderStats.bandSwap ?? 0)
            + (postCustomLadder.ladderStats.bandSwap ?? 0);
        const postCustomCct = runCctEnforce(assignments, true);
        assignments = postCustomCct.draft.assignments;
        fixLog.push(...postCustomCct.log);
        if (postCustomCct.log.some((e) => e.code === 'CCT_REST_BLOCK' || e.code === 'CCT_MAX_WORK')) {
            const refill = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs: opts.snapshot.days,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                cycle,
                dateStrList: dateStrs,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                slaVendidas: opts.snapshot.slaVendidas,
                offerHours,
                employeeIds: opts.snapshot.employees.map((e) => e.id),
                rules,
                protectedCells: weekendProtected,
                excludeCustomCrossPool: true,
                allowFrancoTrabajado: true,
                ...ladderCycleOpts,
            });
            assignments = refill.draft.assignments;
            fixLog.push(...refill.log);
            gapFilled.ladderStats.ft += refill.ladderStats.ft;
            gapFilled.ladderStats.bandSwap += refill.ladderStats.bandSwap;
            gapFilled.ladderStats.subgrupo6x2 += refill.ladderStats.subgrupo6x2;
        }
        const postCustomRest2 = (0, vplan_custom_schedule_1.enforceMaxRestStreak)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells: weekendProtected,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
        });
        assignments = postCustomRest2.draft.assignments;
        fixLog.push(...postCustomRest2.log);
        const customFinal2 = (0, vplan_custom_schedule_1.enforceCustomPositionSchedules)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            absences: opts.snapshot.absences,
            openingSlotByEmp,
        });
        assignments = customFinal2.draft.assignments;
        fixLog.push(...customFinal2.log);
        const cycleProtectedCells = new Set([
            ...(weekendProtected ?? []),
            ...(protectedCells ?? []),
            ...(opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate
                ? [
                    ...(0, vplan_cycle_continuity_1.computeOpeningProtectedCells)({
                        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                        prevMonthLastDate,
                        monthFirstDate,
                        prevPlanningState: opts.prevPlanningState,
                        positions: opts.snapshot.positions,
                        defaultPositionByEmp: mergedDefaultPositionByEmp,
                        defaultShiftByEmp: mergedDefaultShiftByEmp,
                        cycle,
                        useTrailing: true,
                        draftAssignments: assignments,
                    }),
                    ...(0, vplan_cycle_continuity_1.computeOpeningRestProtectedCells)({
                        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                        prevMonthLastDate,
                        monthFirstDate,
                        prevPlanningState: opts.prevPlanningState,
                        positions: opts.snapshot.positions,
                        defaultPositionByEmp: mergedDefaultPositionByEmp,
                        defaultShiftByEmp: mergedDefaultShiftByEmp,
                        cycle,
                        useTrailing: true,
                        draftAssignments: assignments,
                    }),
                ]
                : []),
        ]);
        const postCustomBandRest = (0, vplan_cycle_continuity_1.enforceIllegalBandRest)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs,
            minRestHours: rules.minRestHoursBetweenBands ?? 12,
            protectedCells: cycleProtectedCells,
        });
        assignments = postCustomBandRest.draft.assignments;
        fixLog.push(...postCustomBandRest.log);
        if (postCustomBandRest.log.length > 0) {
            const bandRestRefill = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs: opts.snapshot.days,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                cycle,
                dateStrList: dateStrs,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                slaVendidas: opts.snapshot.slaVendidas,
                offerHours,
                employeeIds: opts.snapshot.employees.map((e) => e.id),
                rules,
                protectedCells: cycleProtectedCells,
                excludeCustomCrossPool: true,
                allowFrancoTrabajado: false,
                ...ladderCycleOpts,
            });
            assignments = bandRestRefill.draft.assignments;
            fixLog.push(...bandRestRefill.log);
            gapFilled.ladderStats.subgrupo6x2 += bandRestRefill.ladderStats.subgrupo6x2;
            gapFilled.ladderStats.bandSwap += bandRestRefill.ladderStats.bandSwap;
            gapFilled.ladderStats.sinTurno += bandRestRefill.ladderStats.sinTurno;
            const bandRestAudit = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                demand: opts.demand,
                positions: cyclePositions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                dateStrList: dateStrs,
                cycle,
                previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                rules,
                protectedCells: cycleProtectedCells,
                allowFrancoTrabajado: false,
                ...ladderCycleOpts,
            });
            assignments = bandRestAudit.draft.assignments;
            fixLog.push(...bandRestAudit.log);
            gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + bandRestAudit.ladderStats.auditGap;
            const customFinal3 = (0, vplan_custom_schedule_1.enforceCustomPositionSchedules)({
                draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
                dateStrs: opts.snapshot.days,
                positions: opts.snapshot.positions,
                defaultPositionByEmp: mergedDefaultPositionByEmp,
                absences: opts.snapshot.absences,
                openingSlotByEmp,
            });
            assignments = customFinal3.draft.assignments;
            fixLog.push(...customFinal3.log);
        }
        const hourNormalizePre = (0, vplan_assignment_hours_1.normalizeAssignmentBillableHours)(assignments, {
            cycle,
            positions: opts.snapshot.positions,
        });
        assignments = hourNormalizePre.assignments;
        fixLog.push(...hourNormalizePre.log);
        const postHourClose = (0, vplan_hour_rebalance_1.rebalanceHoursTowardSla)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            slaVendidas: opts.snapshot.slaVendidas,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
            protectedCells: weekendProtected,
            tolerance: 0,
        });
        assignments = postHourClose.draft.assignments;
        fixLog.push(...postHourClose.log);
        rebalanced.hoursAdded += postHourClose.hoursAdded;
    }
    const stripFinal = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        protectedCells,
    });
    assignments = stripFinal.draft.assignments;
    fixLog.push(...stripFinal.log);
    for (let bandEndPass = 0; bandEndPass < 2; bandEndPass += 1) {
        const bandEnd = (0, vplan_cycle_continuity_1.enforceIllegalBandRest)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs,
            minRestHours: rules.minRestHoursBetweenBands ?? 12,
            protectedCells,
        });
        if (bandEnd.log.length === 0)
            break;
        assignments = bandEnd.draft.assignments;
        fixLog.push(...bandEnd.log);
        const stripAfterBand = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            protectedCells,
        });
        assignments = stripAfterBand.draft.assignments;
        fixLog.push(...stripAfterBand.log);
        if (!opts.demand)
            continue;
        const endRefill = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle,
            dateStrList: dateStrs,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            slaVendidas: opts.snapshot.slaVendidas,
            offerHours,
            employeeIds: opts.snapshot.employees.map((e) => e.id),
            rules,
            protectedCells,
            excludeCustomCrossPool: true,
            allowFrancoTrabajado: false,
            ...ladderCycleOpts,
        });
        assignments = endRefill.draft.assignments;
        fixLog.push(...endRefill.log);
        gapFilled.ladderStats.subgrupo6x2 += endRefill.ladderStats.subgrupo6x2;
        gapFilled.ladderStats.bandSwap += endRefill.ladderStats.bandSwap;
        gapFilled.ladderStats.sinTurno += endRefill.ladderStats.sinTurno;
        const stripAfterRefill = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
            draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
            dateStrs: opts.snapshot.days,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            protectedCells,
        });
        assignments = stripAfterRefill.draft.assignments;
        fixLog.push(...stripAfterRefill.log);
    }
    const hourNormalizeFinal = (0, vplan_assignment_hours_1.normalizeAssignmentBillableHours)(assignments, {
        cycle,
        positions: opts.snapshot.positions,
    });
    assignments = hourNormalizeFinal.assignments;
    fixLog.push(...hourNormalizeFinal.log);
    const openingProtectedCells = protectedCells
        ? [...protectedCells]
        : (opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate
            ? [...new Set([
                    ...(0, vplan_cycle_continuity_1.computeOpeningProtectedCells)({
                        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                        prevMonthLastDate,
                        monthFirstDate,
                        prevPlanningState: opts.prevPlanningState,
                        positions: opts.snapshot.positions,
                        defaultPositionByEmp: mergedDefaultPositionByEmp,
                        defaultShiftByEmp: mergedDefaultShiftByEmp,
                        cycle,
                        useTrailing: true,
                        draftAssignments: assignments,
                    }),
                    ...(0, vplan_cycle_continuity_1.computeOpeningRestProtectedCells)({
                        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
                        prevMonthLastDate,
                        monthFirstDate,
                        prevPlanningState: opts.prevPlanningState,
                        positions: opts.snapshot.positions,
                        defaultPositionByEmp: mergedDefaultPositionByEmp,
                        defaultShiftByEmp: mergedDefaultShiftByEmp,
                        cycle,
                        useTrailing: true,
                        draftAssignments: assignments,
                    }),
                ])]
            : undefined);
    const billableAfterPipeline = (0, vplan_assignment_hours_1.countDraftBillableHours)(assignments, {
        cycle,
        positions: opts.snapshot.positions,
    });
    let slotCoverageStats;
    if (opts.demand?.coverageManifest) {
        const auditFinal = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: { assignments, sourceEngine: `${sourceEngineBase}:motor+ladder` },
            demand: opts.demand,
            positions: cyclePositions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            dateStrs,
            cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            rules,
        });
        const progress = (0, vplan_coverage_manifest_1.countFilledSlotsFromAssignments)({
            assignments,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            manifest: opts.demand.coverageManifest,
        });
        const ok = auditFinal.totalMissingSlots === 0 && auditFinal.totalExcessSlots === 0;
        slotCoverageStats = {
            ok,
            filledSlots: progress.filledSlots,
            missingSlots: auditFinal.totalMissingSlots,
            excessSlots: auditFinal.totalExcessSlots,
            totalRequired: opts.demand.coverageManifest.totalRequiredSlots,
            iterations: slotCoverageResult?.iterations ?? 0,
            byPosition: progress.byPosition,
            summaryLabel: ok
                ? `${progress.filledSlots}/${opts.demand.coverageManifest.totalRequiredSlots} turnos/slot cubiertos`
                : `${progress.filledSlots}/${opts.demand.coverageManifest.totalRequiredSlots} · faltan ${auditFinal.totalMissingSlots}`,
        };
    }
    return {
        assignments,
        sourceEngine: `vplan:${opts.strategy.engine}:${cycle}${is4x2 ? ':D12N12' : ''}:motor+ladder`,
        stats: {
            totalBillableHours: billableAfterPipeline,
            motorBillableHours: Math.round(result.stats.totalBillableHours),
            targetHours: result.stats.targetHours,
            slaHoursClosed: result.stats.slaHoursClosed,
            employeeCount: opts.snapshot.employees.length,
            continuityFixes: fixLog.length,
            openingSlotCount: Object.keys(openingSlotByEmp).length,
            openingSlotByEmp,
            openingProtectedCells,
            historySlotCount: resolved.historyCount,
            trailingSlotCount: resolved.trailingCount,
            needsReinforcementCount: gapFilled.ladderStats.needsReinforcement,
            coverageLadder: gapFilled.ladderStats,
            hourRebalanceAdded: rebalanced.hoursAdded,
            slotCoverage: slotCoverageStats,
        },
    };
}
//# sourceMappingURL=phase5-generate.js.map