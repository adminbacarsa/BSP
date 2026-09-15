import { isPlanificacionPublished } from '@/lib/planificacion/planificacionPlanningShiftRules';
import { planificacionPublishLookupKey } from '@/lib/multiempresa';

export type PublishConfirmModalState = {
    isRepublish: boolean;
    warnings: string[];
    superAdminOverride: boolean;
    objectiveName: string;
    periodLabel: string;
};

export type PublishSlaEvaluation = {
    plannedRounded: number;
    slaRounded: number;
    slaHoursMismatch: boolean;
    coverageGapDays: number;
    hasCoverageGaps: boolean;
    delta: number;
};

export function evaluatePublishSlaState(
    objectiveMonthSlaBaseHours: number,
    slaVendidas: number,
    objectiveCoverageGapReport: { daysPartial: number; daysEmpty: number } | null | undefined,
): PublishSlaEvaluation {
    const plannedRounded = Math.round(objectiveMonthSlaBaseHours);
    const slaRounded = Math.round(slaVendidas);
    const slaHoursMismatch = slaVendidas > 0 && plannedRounded !== slaRounded;
    const coverageGapDays = objectiveCoverageGapReport
        ? objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty
        : 0;
    const hasCoverageGaps = coverageGapDays > 0;
    const delta = slaRounded - plannedRounded;
    return {
        plannedRounded,
        slaRounded,
        slaHoursMismatch,
        coverageGapDays,
        hasCoverageGaps,
        delta,
    };
}

export type BuildPublishConfirmModalParams = {
    selectedObjective: string;
    year: number;
    month: number;
    objectiveName: string;
    isSuperAdmin: boolean;
    publishStatusMap: Record<string, { publishedAt: unknown; publishedBy: string } | null>;
    sla: PublishSlaEvaluation;
};

export type BuildPublishConfirmModalResult =
    | { blocked: true; errorMessage: string; errorDuration?: number }
    | { blocked: false; modal: PublishConfirmModalState };

export function buildPublishConfirmModalState({
    selectedObjective,
    year,
    month,
    objectiveName,
    isSuperAdmin,
    publishStatusMap,
    sla,
}: BuildPublishConfirmModalParams): BuildPublishConfirmModalResult {
    const { plannedRounded, slaRounded, slaHoursMismatch, hasCoverageGaps, coverageGapDays, delta } = sla;

    if (!isSuperAdmin && slaHoursMismatch) {
        return {
            blocked: true,
            errorDuration: 9000,
            errorMessage: delta > 0
                ? `No se puede publicar: ${plannedRounded}h planificadas ≠ ${slaRounded}h vendidas (SLA). Faltan ${delta}h.`
                : `No se puede publicar: ${plannedRounded}h planificadas superan ${slaRounded}h vendidas (SLA) en ${-delta}h.`,
        };
    }

    const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
    const isAlreadyPublished = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
    const warnings: string[] = [];
    if (isSuperAdmin && slaHoursMismatch) {
        warnings.push(
            delta > 0
                ? `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (faltan ${delta}h).`
                : `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (excede ${-delta}h).`,
        );
    }
    if (isSuperAdmin && hasCoverageGaps) {
        warnings.push(`Cobertura: ${coverageGapDays} día(s) con huecos respecto al esquema SLA.`);
    }

    return {
        blocked: false,
        modal: {
            isRepublish: isAlreadyPublished,
            warnings,
            superAdminOverride: isSuperAdmin && (slaHoursMismatch || hasCoverageGaps),
            objectiveName,
            periodLabel: `${String(month).padStart(2, '0')}/${year}`,
        },
    };
}
