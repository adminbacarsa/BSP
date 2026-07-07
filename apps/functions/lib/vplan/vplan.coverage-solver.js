"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCoverageSolverLoop = runCoverageSolverLoop;
exports.runMandateCoverageRepair = runMandateCoverageRepair;
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_coverage_audit_1 = require("./vplan.coverage-audit");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_positions_1 = require("./vplan.positions");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const FRANCO = new Set(['F', 'FF', 'FP']);
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function assignmentIndex(assignments, empId, dateStr) {
    return assignments.findIndex((a) => a.employeeId === empId && a.dateStr === dateStr);
}
function isWorkCode(code) {
    const c = String(code || '').toUpperCase();
    return !!c && !FRANCO.has(c) && c !== 'RET' && c !== 'R';
}
function sumBillableHours(assignments) {
    let total = 0;
    for (const a of assignments) {
        const code = String(a.code || '').toUpperCase();
        if (!BILLABLE.has(code))
            continue;
        total += a.hours ?? 8;
    }
    return total;
}
function isProtectedCell(empId, dateStr, protectedCells) {
    return protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(empId, dateStr)) === true;
}
function candidatePassesCct(opts) {
    const cct = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
        assignments: opts.assignments,
        dateStrs: opts.dateStrList,
        empId: opts.empId,
        dateStr: opts.dateStr,
        shiftCode: opts.shiftCode,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
    });
    return cct.ok;
}
function buildCoverageGuard(opts) {
    return {
        protect: opts.protect,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
    };
}
function fillGapOpts(opts) {
    return {
        draft: { ...opts.draft, assignments: opts.assignments },
        dateStrs: opts.dateStrs,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        cycle: opts.cycle,
        dateStrList: opts.dateStrList,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
        protectedCells: opts.protectedCells,
    };
}
function runCoverageClosurePass(opts) {
    const log = [];
    let assignments = [...opts.assignments];
    let audit = {
        ok: false,
        totalGaps: 0,
        totalMissingSlots: 0,
        totalExcessSlots: 0,
        gaps: [],
    };
    let iter = 0;
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    for (; iter < opts.maxIterations; iter++) {
        audit = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: { ...opts.draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrs: opts.dateStrList,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            employeeNames: opts.employeeNames,
            rules: opts.rules,
        });
        if (audit.ok)
            break;
        let applied = false;
        for (const gap of audit.gaps) {
            if (gap.missing <= 0)
                continue;
            const pos = posByName.get(gap.positionName);
            const shift = pos?.shifts?.find((s) => String(s.code || '').toUpperCase() === gap.shiftCode);
            const hours = shift ? (0, vplan_positions_1.shiftBandHours)(shift) : 8;
            const sortedCandidates = [...gap.candidates].sort((a, b) => {
                const aProt = isProtectedCell(a.employeeId, gap.dateStr, opts.protectedCells) ? 1 : 0;
                const bProt = isProtectedCell(b.employeeId, gap.dateStr, opts.protectedCells) ? 1 : 0;
                if (aProt !== bProt)
                    return aProt - bProt;
                const aCct = candidatePassesCct({
                    assignments,
                    empId: a.employeeId,
                    dateStr: gap.dateStr,
                    shiftCode: gap.shiftCode,
                    dateStrList: opts.dateStrList,
                    cycle: opts.cycle,
                    previousMonthAssignments: opts.previousMonthAssignments,
                    rules: opts.rules,
                }) ? 0 : 1;
                const bCct = candidatePassesCct({
                    assignments,
                    empId: b.employeeId,
                    dateStr: gap.dateStr,
                    shiftCode: gap.shiftCode,
                    dateStrList: opts.dateStrList,
                    cycle: opts.cycle,
                    previousMonthAssignments: opts.previousMonthAssignments,
                    rules: opts.rules,
                }) ? 0 : 1;
                return aCct - bCct;
            });
            for (const cand of sortedCandidates) {
                if (!cand.canAssign)
                    continue;
                if ((0, vplan_positions_1.isVirtualEmployeeId)(cand.employeeId))
                    continue;
                if (isProtectedCell(cand.employeeId, gap.dateStr, opts.protectedCells))
                    continue;
                if (!candidatePassesCct({
                    assignments,
                    empId: cand.employeeId,
                    dateStr: gap.dateStr,
                    shiftCode: gap.shiftCode,
                    dateStrList: opts.dateStrList,
                    cycle: opts.cycle,
                    previousMonthAssignments: opts.previousMonthAssignments,
                    rules: opts.rules,
                })) {
                    continue;
                }
                const idx = assignmentIndex(assignments, cand.employeeId, gap.dateStr);
                const currentCode = cand.currentCode.toUpperCase();
                const sameBand = isWorkCode(currentCode)
                    && (0, vplan_sla_enforce_1.normBandCode)(currentCode) === (0, vplan_sla_enforce_1.normBandCode)(gap.shiftCode);
                if (idx >= 0) {
                    const existing = assignments[idx];
                    const existingPos = String(existing.positionName || '').trim();
                    const existingCode = String(existing.code || '').toUpperCase();
                    if (sameBand
                        && existingPos === gap.positionName
                        && (0, vplan_sla_enforce_1.normBandCode)(existingCode) === (0, vplan_sla_enforce_1.normBandCode)(gap.shiftCode)) {
                        continue;
                    }
                    if (sameBand && FRANCO.has(existingCode)) {
                        assignments[idx] = {
                            ...existing,
                            code: gap.shiftCode,
                            positionName: gap.positionName,
                            hours,
                        };
                        log.push({
                            code: 'COVERAGE_SOLVE',
                            message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
                            employeeId: cand.employeeId,
                            dateStr: gap.dateStr,
                        });
                    }
                    else if (sameBand) {
                        assignments[idx] = {
                            ...existing,
                            positionName: gap.positionName,
                            hours: existing.hours ?? hours,
                        };
                        log.push({
                            code: 'POSITION_TAG',
                            message: `Tag ${gap.shiftCode} → ${gap.positionName} (${gap.dateStr})`,
                            employeeId: cand.employeeId,
                            dateStr: gap.dateStr,
                        });
                    }
                    else {
                        assignments[idx] = {
                            ...existing,
                            code: gap.shiftCode,
                            positionName: gap.positionName,
                            hours,
                        };
                        log.push({
                            code: 'COVERAGE_SOLVE',
                            message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
                            employeeId: cand.employeeId,
                            dateStr: gap.dateStr,
                        });
                    }
                }
                else {
                    assignments.push({
                        employeeId: cand.employeeId,
                        dateStr: gap.dateStr,
                        code: gap.shiftCode,
                        positionName: gap.positionName,
                        hours,
                    });
                    log.push({
                        code: 'COVERAGE_SOLVE',
                        message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
                        employeeId: cand.employeeId,
                        dateStr: gap.dateStr,
                    });
                }
                applied = true;
                break;
            }
        }
        if (!applied) {
            const filled = (0, vplan_sla_enforce_1.fillCoverageGaps)(fillGapOpts({
                draft: opts.draft,
                assignments,
                dateStrs: opts.dateStrs,
                dateStrList: opts.dateStrList,
                positions: opts.positions,
                defaultPositionByEmp: opts.defaultPositionByEmp,
                cycle: opts.cycle,
                previousMonthAssignments: opts.previousMonthAssignments,
                rules: opts.rules,
                protectedCells: opts.protectedCells,
            }));
            if (filled.log.length > 0) {
                assignments = filled.draft.assignments;
                log.push(...filled.log);
                continue;
            }
            const stripped = (0, vplan_sla_enforce_1.stripExcessSlaAssignments)({
                draft: { ...opts.draft, assignments },
                dateStrs: opts.dateStrs,
                positions: opts.positions,
                defaultPositionByEmp: opts.defaultPositionByEmp,
                protectedCells: opts.protectedCells,
            });
            if (stripped.log.length > 0) {
                assignments = stripped.draft.assignments;
                log.push(...stripped.log);
                continue;
            }
            break;
        }
    }
    audit.iterationsUsed = iter;
    return { assignments, log, audit, iterations: iter };
}
function runSafeCctRebound(opts) {
    const rebound = runCoverageClosurePass({
        draft: opts.draft,
        assignments: opts.assignments,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrs: opts.dateStrs,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        employeeNames: opts.employeeNames,
        maxIterations: opts.maxIterations,
        rules: opts.rules,
        protectedCells: opts.protectedCells,
    });
    return {
        assignments: rebound.assignments,
        log: rebound.log,
        iterations: rebound.iterations,
    };
}
function runCoverageSolverLoop(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const log = [];
    const maxIter = opts.maxIterations ?? rules.solverMaxIterations;
    const hoursBaseline = sumBillableHours(opts.draft.assignments);
    const tolerance = rules.slaHoursTolerance ?? 8;
    const coverageGuard = buildCoverageGuard({
        protect: rules.protectCoverageOnEnforce,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
    });
    let assignments = [...opts.draft.assignments];
    let iter = 0;
    const bandGuard = (0, vplan_cycle_continuity_1.guardIllegalBandTransitions)({
        draft: { ...opts.draft, assignments },
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        monthFirstDate: opts.dateStrList[0],
        minRestHoursBetweenBands: rules.minRestHoursBetweenBands,
        coverageGuard: rules.protectCoverageOnEnforce ? coverageGuard : undefined,
        protectedCells: opts.protectedCells,
    });
    assignments = bandGuard.draft.assignments;
    log.push(...bandGuard.log);
    const cctPass = (0, vplan_cct_enforce_1.enforceCctWorkRestPattern)({
        draft: { ...opts.draft, assignments },
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules,
        protectedCells: opts.protectedCells,
    });
    assignments = cctPass.draft.assignments;
    log.push(...cctPass.log);
    const rebound = runSafeCctRebound({
        draft: opts.draft,
        assignments,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrs: opts.dateStrs,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        employeeNames: opts.employeeNames,
        rules,
        protectedCells: opts.protectedCells,
        maxIterations: maxIter,
    });
    assignments = rebound.assignments;
    log.push(...rebound.log);
    iter += rebound.iterations;
    const hoursAfterRebound = sumBillableHours(assignments);
    if (hoursAfterRebound < hoursBaseline - tolerance) {
        const filled = (0, vplan_sla_enforce_1.fillCoverageGaps)(fillGapOpts({
            draft: opts.draft,
            assignments,
            dateStrs: opts.dateStrs,
            dateStrList: opts.dateStrList,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules,
            protectedCells: opts.protectedCells,
        }));
        if (filled.log.length > 0) {
            assignments = filled.draft.assignments;
            log.push(...filled.log);
            const rebound2 = runSafeCctRebound({
                draft: opts.draft,
                assignments,
                demand: opts.demand,
                positions: opts.positions,
                defaultPositionByEmp: opts.defaultPositionByEmp,
                dateStrs: opts.dateStrs,
                dateStrList: opts.dateStrList,
                cycle: opts.cycle,
                previousMonthAssignments: opts.previousMonthAssignments,
                employeeNames: opts.employeeNames,
                rules,
                protectedCells: opts.protectedCells,
                maxIterations: Math.min(12, maxIter),
            });
            assignments = rebound2.assignments;
            log.push(...rebound2.log);
            iter += rebound2.iterations;
        }
        const recovered = sumBillableHours(assignments);
        if (recovered > hoursAfterRebound) {
            log.push({
                code: 'BILLABLE_RECOVERY',
                message: `Recuperadas ${Math.round(recovered - hoursAfterRebound)}h facturables (${Math.round(hoursAfterRebound)}→${Math.round(recovered)}h)`,
            });
        }
    }
    let audit = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
        draft: { ...opts.draft, assignments },
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        employeeNames: opts.employeeNames,
        rules,
    });
    audit.iterationsUsed = iter;
    return {
        draft: { ...opts.draft, assignments },
        log,
        audit,
        iterations: iter,
        ok: audit.ok,
    };
}
function runMandateCoverageRepair(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const closure = runCoverageClosurePass({
        draft: opts.draft,
        assignments: [...opts.draft.assignments],
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrs: opts.dateStrs,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        employeeNames: opts.employeeNames,
        maxIterations: opts.maxIterations ?? rules.solverMaxIterations,
        rules,
        protectedCells: opts.protectedCells,
    });
    return {
        draft: { ...opts.draft, assignments: closure.assignments },
        log: closure.log,
        audit: closure.audit,
    };
}
//# sourceMappingURL=vplan.coverage-solver.js.map