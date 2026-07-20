"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanVerification = runVplanVerification;
const autoScheduleEngine_1 = require("../../scheduling/autoScheduleEngine");
const vplan_cycle_continuity_1 = require("../vplan.cycle-continuity");
const vplan_cct_enforce_1 = require("../vplan.cct-enforce");
const vplan_coverage_audit_1 = require("../vplan.coverage-audit");
const vplan_fixed_band_1 = require("../vplan.fixed-band");
const vplan_assigned_positions_1 = require("../vplan.assigned-positions");
const vplan_custom_schedule_1 = require("../vplan.custom-schedule");
const planning_rules_defaults_1 = require("../../planning/planning-rules.defaults");
const planning_rules_service_1 = require("../../planning/planning-rules.service");
const vplan_engine_bridge_1 = require("../vplan.engine-bridge");
const vplan_positions_1 = require("../vplan.positions");
const vplan_sla_enforce_1 = require("../vplan.sla-enforce");
const vplan_coverage_views_1 = require("../vplan.coverage-views");
function runVplanVerification(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.planningRules ?? null);
    const mergedDefaultPositionByEmp = (0, vplan_sla_enforce_1.capDefaultPositionByEmp)(opts.snapshot.positions, {
        ...opts.prevPlanningState.defaultPositionByEmp,
        ...opts.planningState.defaultPositionByEmp,
    }, opts.strategy.cycle);
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
    const engineAssignments = (0, vplan_coverage_views_1.engineAssignmentsFromDraft)(opts.draft.assignments);
    const coverage = (0, autoScheduleEngine_1.verifyCoverage)(ctx, engineAssignments);
    const issues = [];
    const dateStrs = opts.snapshot.days.map((d) => d.dateStr);
    const structuralHours = opts.monthDemandHours ?? 0;
    const coverageBundle = (0, vplan_coverage_views_1.buildVplanCoverageBundle)({
        ctx,
        draftAssignments: opts.draft.assignments,
        coverage,
        employees: opts.snapshot.employees,
        monthDemandHours: structuralHours,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        dateStrs,
    });
    const nrMarkers = opts.draft.assignments.filter((a) => String(a.code || '').toUpperCase() === 'NR');
    if (nrMarkers.length > 0) {
        issues.push({
            severity: 'warning',
            code: 'NEEDS_REINFORCEMENT',
            message: `${nrMarkers.length} celda(s) NR — requiere refuerzo manual (escalera agotada)`,
        });
        for (const nr of nrMarkers.slice(0, 8)) {
            issues.push({
                severity: 'warning',
                code: 'NR_SLOT',
                message: `Refuerzo: ${nr.positionName} (${nr.dateStr})`,
                dateStr: nr.dateStr,
                positionName: nr.positionName,
            });
        }
    }
    if (coverage.uncoveredSlots > 0) {
        issues.push({
            severity: 'blocking',
            code: 'COVERAGE_GAP',
            message: `${coverage.uncoveredSlots} slots sin cubrir (${coverage.coveredSlots}/${coverage.totalSlots})`,
        });
        for (const [dateStr, gaps] of Object.entries(coverage.uncoveredByDay)) {
            for (const g of gaps.slice(0, 5)) {
                issues.push({
                    severity: 'blocking',
                    code: 'SLOT_MISSING',
                    message: `Faltan ${g.missing}×${g.shiftCode} en ${g.positionName}`,
                    dateStr,
                    positionName: g.positionName,
                });
            }
        }
    }
    if (coverageBundle.overCoveredSlots > 0) {
        issues.push({
            severity: 'blocking',
            code: 'COVERAGE_EXCESS',
            message: `${coverageBundle.overCoveredSlots} slot(s) de más vs SLA (sobre-asignación)`,
        });
        for (const row of coverageBundle.positionSlots.filter((r) => (r.excessSlots ?? 0) > 0)) {
            issues.push({
                severity: 'blocking',
                code: 'SLOT_EXCESS',
                message: `${row.positionName} ${row.shiftCode}: ${row.assignedSlots}/${row.requiredSlots} asignados (+${row.excessSlots})`,
                positionName: row.positionName,
            });
        }
        for (const [dateStr, gaps] of Object.entries(coverageBundle.overCoveredByDay).slice(0, 7)) {
            for (const g of gaps.slice(0, 3)) {
                const who = g.employeeIds.filter((id) => id !== 'VACANTE').join(', ') || g.employeeIds.join(', ');
                issues.push({
                    severity: 'info',
                    code: 'SLOT_EXCESS_DAY',
                    message: `+${g.excess}×${g.shiftCode} ${g.positionName} (${who || '—'})`,
                    dateStr,
                    positionName: g.positionName,
                });
            }
        }
    }
    const hoursGap = Math.round(coverage.slaVendidas - coverage.billableHours);
    const hoursTolerance = rules.slaHoursTolerance;
    if (coverage.slaVendidas > 0 && hoursGap > 0) {
        issues.push({
            severity: hoursGap > hoursTolerance ? 'blocking' : 'warning',
            code: 'HOURS_UNDER_SLA',
            message: hoursGap <= hoursTolerance
                ? `Faltan ${hoursGap}h facturables vs SLA (${hoursGap}h = turno sin cubrir contable)`
                : `Faltan ~${hoursGap}h facturables vs SLA vendidas`,
        });
    }
    else if (coverage.slaVendidas > 0 && hoursGap < -hoursTolerance) {
        issues.push({
            severity: 'warning',
            code: 'HOURS_OVER_SLA',
            message: `Exceso ~${Math.abs(hoursGap)}h sobre SLA vendidas`,
        });
    }
    const structuralHoursCheck = opts.monthDemandHours ?? 0;
    if (structuralHoursCheck > 0 && coverage.slaVendidas > 0) {
        const structGap = Math.round(structuralHoursCheck - coverage.slaVendidas);
        if (Math.abs(structGap) > 8) {
            issues.push({
                severity: 'info',
                code: 'STRUCTURE_VS_SLA',
                message: structGap > 0
                    ? `Estructura de puestos ~${structGap}h por encima del SLA vendido`
                    : `SLA vendido ~${Math.abs(structGap)}h por encima de la estructura`,
            });
        }
    }
    const prevMonthDates = [...new Set(opts.snapshot.previousMonthAssignments.map((a) => a.dateStr))].sort();
    const prevMonthLastDate = prevMonthDates.length > 0 ? prevMonthDates[prevMonthDates.length - 1] : '';
    const monthFirstDate = dateStrs[0] ?? '';
    const bandViolations = (0, vplan_cycle_continuity_1.detectIllegalBandTransitions)(opts.draft, dateStrs, rules.minRestHoursBetweenBands);
    for (const v of bandViolations) {
        const prevBand = (0, vplan_cycle_continuity_1.workBand)(v.fromCode);
        const nextBand = (0, vplan_cycle_continuity_1.workBand)(v.toCode);
        const restDetail = prevBand && nextBand
            ? ` · ${Math.round((0, vplan_cycle_continuity_1.restHoursBetweenShiftAssignments)(v.fromDate, prevBand, v.toDate, nextBand) * 10) / 10}h descanso`
            : '';
        issues.push({
            severity: 'blocking',
            code: 'BAND_SKIP_ILLEGAL',
            message: `Descanso insuficiente ${v.fromCode}→${v.toCode} (${v.fromDate} → ${v.toDate}, mín ${rules.minRestHoursBetweenBands}h)${restDetail}`,
            employeeId: v.employeeId,
            dateStr: v.toDate,
        });
    }
    if (opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate) {
        const crossMonth = (0, vplan_cycle_continuity_1.detectCrossMonthContinuityViolations)({
            draft: opts.draft,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate,
            monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            cycle: opts.strategy.cycle,
        });
        for (const v of crossMonth) {
            issues.push({
                severity: 'blocking',
                code: 'CROSS_MONTH_STREAK_BREAK',
                message: `Racha cortada ${v.fromCode} (${v.fromDate}) → ${v.toCode} (${v.toDate}); esperado ${v.expectedCode}`,
                employeeId: v.employeeId,
                dateStr: v.toDate,
            });
        }
    }
    const maxStreak = (0, planning_rules_defaults_1.workDaysForCycle)(opts.strategy.cycle, rules);
    const cctStreakViolations = (0, vplan_cct_enforce_1.detectCctStreakViolations)({
        draft: opts.draft,
        dateStrs,
        cycle: opts.strategy.cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
    });
    for (const v of cctStreakViolations) {
        const isSoftFt = v.workDays === maxStreak + 1;
        issues.push({
            severity: isSoftFt ? 'warning' : 'blocking',
            code: 'WORK_STREAK_TOO_LONG',
            message: isSoftFt
                ? `Franco trabajado ×${v.workDays} (${v.fromDate} → ${v.toDate}, máx ${maxStreak} + FT en ${opts.strategy.cycle})`
                : `Racha CCT ×${v.workDays} sin descanso (${v.fromDate} → ${v.toDate}, máx ${maxStreak} en ${opts.strategy.cycle})`,
            employeeId: v.employeeId,
            dateStr: v.toDate,
        });
    }
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(opts.strategy.cycle, rules);
    const restStreakViolations = (0, vplan_custom_schedule_1.detectOverlongRestStreaks)(opts.draft, dateStrs, opts.strategy.cycle, opts.snapshot.previousMonthAssignments, rules);
    for (const v of restStreakViolations.slice(0, 20)) {
        issues.push({
            severity: 'warning',
            code: 'REST_STREAK_TOO_LONG',
            message: `Racha ${v.restDays}F consecutivos (${v.fromDate} → ${v.toDate}, máx ${v.maxRest} en ${opts.strategy.cycle})`,
            employeeId: v.employeeId,
            dateStr: v.toDate,
        });
    }
    if (restStreakViolations.length > 20) {
        issues.push({
            severity: 'info',
            code: 'REST_STREAK_TOO_LONG',
            message: `+${restStreakViolations.length - 20} rachas de descanso excesivo adicionales`,
        });
    }
    const customViolations = (0, vplan_custom_schedule_1.detectCustomScheduleViolations)({
        draft: opts.draft,
        dateStrs: opts.snapshot.days,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
    });
    for (const v of customViolations.slice(0, 20)) {
        issues.push({
            severity: 'blocking',
            code: 'CUSTOM_SCHEDULE_VIOLATION',
            message: `${v.positionName}: esperado ${v.expectedCode} pero ${v.actualCode} (${v.dateStr})`,
            employeeId: v.employeeId,
            dateStr: v.dateStr,
        });
    }
    if (customViolations.length > 20) {
        issues.push({
            severity: 'info',
            code: 'CUSTOM_SCHEDULE_VIOLATION',
            message: `+${customViolations.length - 20} desvíos de turno custom adicionales`,
        });
    }
    const consecutiveHoursViolations = (0, vplan_custom_schedule_1.detectConsecutiveBillableHoursViolations)(opts.draft, dateStrs, rules.maxConsecutiveWorkHours);
    for (const v of consecutiveHoursViolations.slice(0, 15)) {
        issues.push({
            severity: 'warning',
            code: 'CONSECUTIVE_WORK_HOURS',
            message: `Racha ${v.hours}h facturables sin descanso (${v.fromDate} → ${v.toDate}, máx ${rules.maxConsecutiveWorkHours}h)`,
            employeeId: v.employeeId,
            dateStr: v.toDate,
        });
    }
    if (consecutiveHoursViolations.length > 15) {
        issues.push({
            severity: 'info',
            code: 'CONSECUTIVE_WORK_HOURS',
            message: `+${consecutiveHoursViolations.length - 15} alertas de horas seguidas adicionales`,
        });
    }
    let coverageAudit = opts.demand
        ? (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
            draft: opts.draft,
            demand: opts.demand,
            positions: (0, vplan_positions_1.positionsForCycle)(opts.snapshot.positions, opts.strategy.cycle),
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            dateStrs,
            cycle: opts.strategy.cycle,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            employeeNames: opts.employeeNames,
            rules,
        })
        : undefined;
    if (coverageAudit && !coverageAudit.ok) {
        for (const gap of coverageAudit.gaps.slice(0, 20)) {
            const assignable = gap.candidates.filter((c) => c.canAssign).length;
            const blocked = gap.candidates.filter((c) => !c.canAssign && c.blockReason);
            issues.push({
                severity: 'blocking',
                code: 'COVERAGE_GAP_DETAIL',
                message: `Faltan ${gap.missing}×${gap.shiftCode} ${gap.positionName} · ${assignable} candidato(s) · ${blocked[0]?.blockReason ?? 'sin candidatos libres'}`,
                dateStr: gap.dateStr,
                positionName: gap.positionName,
            });
        }
    }
    const fixedBandViolations = (0, vplan_fixed_band_1.detectFixedBandViolations)(opts.draft, dateStrs, mergedDefaultShiftByEmp, mergedDefaultPositionByEmp);
    for (const v of fixedBandViolations.slice(0, 20)) {
        issues.push({
            severity: 'warning',
            code: 'FIXED_BAND_MISMATCH',
            message: `Banda fija ${v.expectedBand} en ${v.positionName || 'puesto'} pero asignado ${v.actualCode}`,
            employeeId: v.employeeId,
            dateStr: v.dateStr,
        });
    }
    if (fixedBandViolations.length > 20) {
        issues.push({
            severity: 'info',
            code: 'FIXED_BAND_MISMATCH',
            message: `+${fixedBandViolations.length - 20} desvíos de banda fija adicionales`,
        });
    }
    const positionViolations = (0, vplan_assigned_positions_1.detectAssignedPositionViolations)(opts.draft, mergedDefaultPositionByEmp, opts.snapshot.positions);
    for (const v of positionViolations.slice(0, 20)) {
        issues.push({
            severity: 'warning',
            code: 'FIXED_POSITION_MISMATCH',
            message: `Puesto asignado ${v.expectedPosition} pero en grilla ${v.actualPosition} (${v.code})`,
            employeeId: v.employeeId,
            dateStr: v.dateStr,
            positionName: v.expectedPosition,
        });
    }
    if (positionViolations.length > 20) {
        issues.push({
            severity: 'info',
            code: 'FIXED_POSITION_MISMATCH',
            message: `+${positionViolations.length - 20} desvíos de puesto asignado adicionales`,
        });
    }
    const blocking = issues.filter((i) => i.severity === 'blocking');
    return {
        ok: blocking.length === 0 && coverage.coverageRatio >= rules.coverageRatioMin,
        issues,
        billableHours: Math.round(coverage.billableHours),
        slaVendidas: coverage.slaVendidas,
        hoursGap,
        coverage: coverageBundle,
        coverageAudit,
    };
}
//# sourceMappingURL=phase7-verify.js.map