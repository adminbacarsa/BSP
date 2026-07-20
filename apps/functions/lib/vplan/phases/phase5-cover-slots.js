"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanSlotCoverage = runVplanSlotCoverage;
const planning_rules_service_1 = require("../../planning/planning-rules.service");
const vplan_coverage_audit_1 = require("../vplan.coverage-audit");
const vplan_coverage_ladder_1 = require("../vplan.coverage-ladder");
const vplan_coverage_manifest_1 = require("../vplan.coverage-manifest");
const vplan_sla_enforce_1 = require("../vplan.sla-enforce");
const MAX_COVERAGE_ITERATIONS = 10;
function runVplanSlotCoverage(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    let assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const ladderTotals = {
        subgrupo6x2: 0,
        refuerzo4x2: 0,
        sinTurno: 0,
        ret: 0,
        ft: 0,
        needsReinforcement: 0,
        bandSwap: 0,
        auditGap: 0,
    };
    let iterations = 0;
    let lastMissing = opts.manifest.totalRequiredSlots;
    let lastExcess = 0;
    for (let pass = 0; pass < MAX_COVERAGE_ITERATIONS; pass += 1) {
        iterations = pass + 1;
        const auditBefore = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: { ...opts.draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrs: opts.dateStrList,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
        });
        lastMissing = auditBefore.totalMissingSlots;
        lastExcess = auditBefore.totalExcessSlots;
        if (lastMissing === 0 && lastExcess === 0)
            break;
        const ladder = (0, vplan_coverage_ladder_1.fillCoverageGapsWithLadder)({
            draft: { ...opts.draft, assignments },
            dateStrs: opts.dateStrs,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            cycle: opts.cycle,
            dateStrList: opts.dateStrList,
            previousMonthAssignments: opts.previousMonthAssignments,
            slaVendidas: opts.slaVendidas,
            offerHours: opts.offerHours,
            employeeIds: opts.employeeIds,
            rules,
            protectedCells: opts.protectedCells,
            openingSlotByEmp: opts.openingSlotByEmp,
            defaultShiftByEmp: opts.defaultShiftByEmp,
            useTrailing: opts.useTrailing,
            trailingEmployeeIds: opts.trailingEmployeeIds,
            excludeCustomCrossPool: opts.excludeCustomCrossPool,
            allowFrancoTrabajado: opts.allowFrancoTrabajado ?? true,
        });
        assignments = ladder.draft.assignments;
        log.push(...ladder.log);
        ladderTotals.subgrupo6x2 += ladder.ladderStats.subgrupo6x2;
        ladderTotals.refuerzo4x2 += ladder.ladderStats.refuerzo4x2;
        ladderTotals.sinTurno += ladder.ladderStats.sinTurno;
        ladderTotals.ret += ladder.ladderStats.ret;
        ladderTotals.ft += ladder.ladderStats.ft;
        ladderTotals.needsReinforcement += ladder.ladderStats.needsReinforcement;
        ladderTotals.bandSwap += ladder.ladderStats.bandSwap ?? 0;
        ladderTotals.auditGap += ladder.ladderStats.auditGap ?? 0;
        const auditFill = (0, vplan_coverage_ladder_1.fillAssignableGapsFromAudit)({
            draft: { ...opts.draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrList: opts.dateStrList,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
            protectedCells: opts.protectedCells,
            allowFrancoTrabajado: opts.allowFrancoTrabajado ?? true,
        });
        assignments = auditFill.draft.assignments;
        log.push(...auditFill.log);
        ladderTotals.auditGap += auditFill.ladderStats.auditGap ?? 0;
        const stripped = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
            draft: { ...opts.draft, assignments },
            dateStrs: opts.dateStrs,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            protectedCells: opts.protectedCells,
        });
        assignments = stripped.draft.assignments;
        log.push(...stripped.log);
        const auditAfter = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: { ...opts.draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrs: opts.dateStrList,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
        });
        if (auditAfter.totalMissingSlots === lastMissing
            && auditAfter.totalExcessSlots === lastExcess
            && ladder.log.length === 0
            && auditFill.log.length === 0
            && stripped.log.length === 0) {
            lastMissing = auditAfter.totalMissingSlots;
            lastExcess = auditAfter.totalExcessSlots;
            break;
        }
        lastMissing = auditAfter.totalMissingSlots;
        lastExcess = auditAfter.totalExcessSlots;
        if (lastMissing === 0 && lastExcess === 0)
            break;
    }
    const progress = (0, vplan_coverage_manifest_1.countFilledSlotsFromAssignments)({
        assignments,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        manifest: opts.manifest,
    });
    const ok = lastMissing === 0 && lastExcess === 0;
    return {
        draft: { ...opts.draft, assignments },
        log,
        ok,
        iterations,
        totalRequired: opts.manifest.totalRequiredSlots,
        filledSlots: progress.filledSlots,
        missingSlots: lastMissing,
        excessSlots: lastExcess,
        byPosition: progress.byPosition,
        ladderStats: ladderTotals,
        summaryLabel: ok
            ? `${progress.filledSlots}/${opts.manifest.totalRequiredSlots} turnos/slot cubiertos`
            : `${progress.filledSlots}/${opts.manifest.totalRequiredSlots} cubiertos · faltan ${lastMissing}${lastExcess > 0 ? ` · sobran ${lastExcess}` : ''}`,
    };
}
//# sourceMappingURL=phase5-cover-slots.js.map