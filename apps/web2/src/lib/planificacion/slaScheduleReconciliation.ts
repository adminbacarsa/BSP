/**
 * Cierre SLA — reprocesa turnos (variantes M/T/N, RET, rebalanceo) hasta alinear:
 *   · verifyScheduleCoverage (huecos por banda × puesto × día)
 *   · analyzeCoveragePolicyBalance (misma demanda SLA, sin desvío entre fuentes)
 *
 * Modo rotativeSafe: solo gap-fill y rebalance desde pool excedente (no rompe ciclo 24d).
 * Modo completo: además fixScheduleIssues por iteración.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { fixScheduleIssues } from './coverageFixer';
import {
    analyzeCoveragePolicyBalance,
    fillCoverageGapsFromSurplusPool,
    repairCoverageOverstaffFromSurplus,
    type CoveragePolicyBalanceReport,
} from './coveragePolicyBalance';
import { verifyScheduleCoverage, type CoverageVerificationReport } from './coverageVerification';
import { isLabPaddingEmpId } from './objectiveHeadcount';

export type SlaReconciliationResult = {
    assignments: V2Assignment[];
    coverageReport: CoverageVerificationReport;
    balanceReport: CoveragePolicyBalanceReport;
    rounds: number;
    converged: boolean;
    messages: string[];
};

function gapUnitsFromVerify(report: CoverageVerificationReport): number {
    return report.uncovered.reduce(
        (s, u) => s + Math.max(0, u.qtyRequested - u.qtyAssigned),
        0,
    );
}

function reportsAligned(
    balance: CoveragePolicyBalanceReport,
    verify: CoverageVerificationReport,
): boolean {
    const verifyGaps = gapUnitsFromVerify(verify);
    return balance.underSlotCount === verifyGaps;
}

/** Pool efectivo: excedentes explícitos + lab-pad + idle/stranded del motor. */
export function expandSlaGapFillPool(
    ctx: V2EngineContext,
    stats: V2GenerateStats,
    explicitPool: string[],
): string[] {
    const set = new Set(explicitPool);
    for (const e of ctx.employees) {
        if (isLabPaddingEmpId(e.id)) set.add(e.id);
    }
    for (const id of stats.idleEmployeeIds ?? []) set.add(id);
    for (const id of stats.strandedEmployeeIds ?? []) set.add(id);
    for (const id of stats.retFloaterEmpIds ?? []) set.add(id);
    for (const id of ctx.idleSurplusEmpIds ?? []) set.add(id);
    return [...set];
}

/**
 * Itera hasta maxRounds o convergencia (huecos SLA = 0 y balance OK).
 */
export function reconcileScheduleToSlaTargets(params: {
    ctx: V2EngineContext;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    surplusPool?: string[];
    maxRounds?: number;
    rotativeSafe?: boolean;
}): SlaReconciliationResult {
    const maxRounds = params.maxRounds ?? 8;
    const rotativeSafe = params.rotativeSafe ?? params.ctx.preserveRotativeIntegrity === true;
    const surplusPool = expandSlaGapFillPool(
        params.ctx,
        params.stats,
        params.surplusPool ?? params.ctx.idleSurplusEmpIds ?? [],
    );

    let assignments = params.assignments.map((a) => ({ ...a }));
    const messages: string[] = [];

    let coverageReport = verifyScheduleCoverage(params.ctx, assignments, params.stats, {
        inferModo12TCoverage: true,
    });
    let balanceReport = analyzeCoveragePolicyBalance(params.ctx, assignments, {
        inferModo12TCoverage: true,
    });

    let converged = balanceReport.ok
        && coverageReport.ok
        && reportsAligned(balanceReport, coverageReport);
    let rounds = 0;

    for (rounds = 1; rounds <= maxRounds && !converged; rounds++) {
        const beforeGaps = balanceReport.underSlotCount + gapUnitsFromVerify(coverageReport);
        let progressed = false;

        const gapPass = fillCoverageGapsFromSurplusPool({
            assignments,
            ctx: params.ctx,
            surplusPool,
            stats: params.stats,
            inferModo12TCoverage: true,
        });
        if (gapPass.actions.length > 0) {
            assignments = gapPass.assignments;
            progressed = true;
            messages.push(`R${rounds}: cierre hueco ×${gapPass.actions.length}`);
        }

        const repair = repairCoverageOverstaffFromSurplus({
            assignments,
            ctx: params.ctx,
            surplusPool,
        });
        if (repair.actions.length > 0) {
            assignments = repair.assignments;
            progressed = true;
            messages.push(`R${rounds}: rebalance sobrecobertura ×${repair.actions.length}`);
        }

        if (!rotativeSafe && !progressed) {
            const fixer = fixScheduleIssues(
                params.ctx,
                assignments,
                params.stats,
                coverageReport,
                1,
            );
            assignments = fixer.assignments;
            coverageReport = fixer.report;
            if (
                fixer.summary.uncoveredFixed > 0
                || fixer.summary.restViolationsFixed > 0
                || fixer.summary.licenseConflictsFixed > 0
            ) {
                progressed = true;
                messages.push(`R${rounds}: fixer mecánico`);
            }
        }

        coverageReport = verifyScheduleCoverage(params.ctx, assignments, params.stats, {
            inferModo12TCoverage: true,
        });
        balanceReport = analyzeCoveragePolicyBalance(params.ctx, assignments, {
            inferModo12TCoverage: true,
        });

        converged = balanceReport.ok
            && coverageReport.ok
            && reportsAligned(balanceReport, coverageReport);

        const afterGaps = balanceReport.underSlotCount + gapUnitsFromVerify(coverageReport);
        if (!progressed || afterGaps >= beforeGaps) {
            if (!converged) {
                messages.push(
                    `R${rounds}: sin progreso (huecos verify=${gapUnitsFromVerify(coverageReport)}, `
                    + `balance=${balanceReport.underSlotCount})`,
                );
            }
            break;
        }
    }

    return {
        assignments,
        coverageReport,
        balanceReport,
        rounds,
        converged,
        messages,
    };
}
