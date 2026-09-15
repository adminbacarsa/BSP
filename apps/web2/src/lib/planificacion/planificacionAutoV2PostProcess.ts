import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { toast } from 'sonner';
import { fixScheduleIssues } from '@/lib/planificacion/coverageFixer';
import { buildScheduleOptimizationSuggestions, type ScheduleChangeSuggestion } from '@/lib/planificacion/scheduleOptimizationSuggestions';
import { verifyScheduleForm, type ScheduleFormValidationReport } from '@/lib/planificacion/scheduleFormValidator';
import { rebalanceScheduleForm, type FormRebalanceLogEntry } from '@/lib/planificacion/scheduleFormRebalancer';
import type { AutoPlanningBrainResult } from '@/lib/planificacion/autoPlanningBrain';
import type { CoverageVerificationReport } from '@/lib/planificacion/coverageVerification';
import type {
    AutoV2GenStats,
    AutoV2LastRun,
} from '@/lib/planificacion/applyPlanificacionAutoScheduleV2';

export type ReprocessPlanificacionAutoIssuesParams = {
    autoV2LastRun: AutoV2LastRun | null;
    autoV2Coverage: CoverageVerificationReport | null;
    autoOverwrite: boolean;
    pendingChanges: Record<string, any>;
    selectedObjective: string;
    positionStructure: any[];
    autoPlanningBrainRef: MutableRefObject<AutoPlanningBrainResult | null>;
    setAutoV2Fixing: (value: boolean) => void;
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>> | ((value: Record<string, any>) => void);
    setAutoV2Coverage: Dispatch<SetStateAction<CoverageVerificationReport | null>>;
    setAutoV2Suggestions: (value: ScheduleChangeSuggestion[] | null) => void;
    setAutoV2LastRun: Dispatch<SetStateAction<AutoV2LastRun | null>>;
    setAutoV2FormReport: (value: ScheduleFormValidationReport | null) => void;
};

export async function reprocessPlanificacionAutoIssues({
    autoV2LastRun,
    autoV2Coverage,
    autoOverwrite,
    pendingChanges,
    selectedObjective,
    positionStructure,
    autoPlanningBrainRef,
    setAutoV2Fixing,
    setPendingChanges,
    setAutoV2Coverage,
    setAutoV2Suggestions,
    setAutoV2LastRun,
    setAutoV2FormReport,
}: ReprocessPlanificacionAutoIssuesParams): Promise<void> {
    if (!autoV2LastRun || !autoV2Coverage) {
        toast.error('No hay una generación reciente para reprocesar.');
        return;
    }
    setAutoV2Fixing(true);
    try {
        const result = fixScheduleIssues(
            autoV2LastRun.ctx,
            autoV2LastRun.assignments,
            autoV2LastRun.stats,
            autoV2Coverage,
            5,
        );

        const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
        const NON_BILLABLE = new Set(['RET', 'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'PG', 'AA']);
        let written = 0;
        for (const a of result.assignments) {
            const key = `${a.empId}_${a.dateStr}`;
            const existing = pendingChanges[key];
            if (existing && !existing.isDeleted && !NON_BILLABLE.has(String(existing.code || '').toUpperCase())
                && NON_BILLABLE.has(String(a.code || '').toUpperCase())) continue;
            newChanges[key] = {
                isTemp: true,
                employeeId: a.empId,
                objectiveId: selectedObjective,
                positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                code: a.code,
                name: a.name,
                hours: a.hours,
                startTime: a.startTime,
                ...(a.endTime ? { endTime: a.endTime } : {}),
                ...(a.isFranco ? { isFranco: true } : {}),
                ...(a.isReten ? { isReten: true } : {}),
            };
            written++;
        }
        setPendingChanges(newChanges);
        setAutoV2Coverage(result.report);
        setAutoV2Suggestions(
            buildScheduleOptimizationSuggestions(autoV2LastRun.ctx, result.assignments, autoV2LastRun.stats),
        );
        setAutoV2LastRun({ ...autoV2LastRun, assignments: result.assignments });
        setAutoV2FormReport(verifyScheduleForm(
            autoV2LastRun.ctx,
            result.assignments,
            autoV2LastRun.stats,
            {
                strictSixTwo: autoPlanningBrainRef.current?.strictSixTwo,
                rotateShifts: autoPlanningBrainRef.current?.rotateShifts,
            },
        ));

        const s = result.summary;
        const baseMsg = `Reproceso en ${result.iterations} iteración(es). Descansos: -${s.restViolationsFixed}, licencias: -${s.licenseConflictsFixed}, slots: -${s.uncoveredFixed}.`;
        if (result.converged) {
            toast.success(`✓ Cobertura OK. ${baseMsg}`, { duration: 7000 });
        } else if (s.restViolationsFixed + s.licenseConflictsFixed + s.uncoveredFixed === 0) {
            toast.warning(
                `Sin progreso: ${result.report.restViolations.length} descansos, ${result.report.licenseConflicts.length} licencias y ${s.uncoveredRemaining} slots siguen sin resolverse. Revisalos a mano.`,
                { duration: 8000 },
            );
        } else {
            toast.warning(
                `${baseMsg} Quedan ${result.report.restViolations.length} descansos, ${result.report.licenseConflicts.length} licencias y ${s.uncoveredRemaining} slots.`,
                { duration: 8000 },
            );
        }
        console.info('[reprocessAutoIssues] log:', result.log);
        void written;
    } catch (e) {
        console.error('[reprocessAutoIssues]', e);
        toast.error('Error al reprocesar los errores.');
    } finally {
        setAutoV2Fixing(false);
    }
}

export type RebalancePlanificacionAutoFormParams = {
    autoV2LastRun: AutoV2LastRun | null;
    autoV2Coverage: CoverageVerificationReport | null;
    selectedObjective: string;
    autoOverwrite: boolean;
    pendingChanges: Record<string, any>;
    positionStructure: any[];
    autoPlanningBrainRef: MutableRefObject<AutoPlanningBrainResult | null>;
    setAutoV2Rebalancing: (value: boolean) => void;
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>> | ((value: Record<string, any>) => void);
    setAutoV2Coverage: Dispatch<SetStateAction<CoverageVerificationReport | null>>;
    setAutoV2FormReport: (value: ScheduleFormValidationReport | null) => void;
    setAutoV2RebalanceLog: (value: FormRebalanceLogEntry[]) => void;
    setAutoV2LastRun: Dispatch<SetStateAction<AutoV2LastRun | null>>;
    setAutoV2Suggestions: (value: ScheduleChangeSuggestion[] | null) => void;
    setAutoV2GenStats: Dispatch<SetStateAction<AutoV2GenStats | null>>;
};

export async function rebalancePlanificacionAutoForm({
    autoV2LastRun,
    autoV2Coverage,
    selectedObjective,
    autoOverwrite,
    pendingChanges,
    positionStructure,
    autoPlanningBrainRef,
    setAutoV2Rebalancing,
    setPendingChanges,
    setAutoV2Coverage,
    setAutoV2FormReport,
    setAutoV2RebalanceLog,
    setAutoV2LastRun,
    setAutoV2Suggestions,
    setAutoV2GenStats,
}: RebalancePlanificacionAutoFormParams): Promise<void> {
    if (!autoV2LastRun || !autoV2Coverage || !selectedObjective) {
        toast.error('No hay una generación reciente para rebalancear.');
        return;
    }
    if (autoV2Coverage.coverage.uncoveredSlots > 0) {
        toast.error('Cerrá la cobertura antes de rebalancear forma.');
        return;
    }
    setAutoV2Rebalancing(true);
    try {
        const reb = rebalanceScheduleForm(
            autoV2LastRun.ctx,
            autoV2LastRun.assignments,
            autoV2LastRun.stats,
            autoV2Coverage,
            {
                strictSixTwo: autoPlanningBrainRef.current?.strictSixTwo,
                rotateShifts: autoPlanningBrainRef.current?.rotateShifts,
            },
        );
        if (!reb.improved || reb.swapsApplied === 0) {
            toast.info('No se encontraron swaps que mejoren el balance horario sin romper cobertura.');
            return;
        }

        const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
        const touched = new Set<string>();
        for (const entry of reb.log) {
            touched.add(`${entry.fromEmpId}__${entry.dateStr}`);
            touched.add(`${entry.toEmpId}__${entry.dateStr}`);
        }
        for (const touchKey of touched) {
            const sep = touchKey.indexOf('__');
            const empId = touchKey.slice(0, sep);
            const dateStr = touchKey.slice(sep + 2);
            const a = reb.assignments.find(x => x.empId === empId && x.dateStr === dateStr);
            if (!a) continue;
            newChanges[`${empId}_${dateStr}`] = {
                isTemp: true,
                employeeId: empId,
                objectiveId: selectedObjective,
                positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                code: a.code,
                name: a.name,
                hours: a.hours,
                startTime: a.startTime,
                ...(a.endTime ? { endTime: a.endTime } : {}),
                ...(a.isFranco ? { isFranco: true } : {}),
                ...(a.isReten ? { isReten: true } : {}),
            };
        }

        setPendingChanges(newChanges);
        setAutoV2Coverage(reb.coverageReport);
        setAutoV2FormReport(reb.formReport);
        setAutoV2RebalanceLog(reb.log);
        setAutoV2LastRun({ ...autoV2LastRun, assignments: reb.assignments, stats: reb.stats });
        setAutoV2Suggestions(buildScheduleOptimizationSuggestions(autoV2LastRun.ctx, reb.assignments, reb.stats));
        setAutoV2GenStats((prev) => prev ? {
            ...prev,
            employeeMonthlyHours: reb.stats.employeeMonthlyHours,
        } : prev);

        toast.success(
            `Rebalanceo: ${reb.swapsApplied} swap(s). Δ ${reb.formReport.metrics.hoursSpread}h · prom ${reb.formReport.metrics.avgBillableHours}h`,
            { duration: 7000 },
        );
        console.info('[rebalanceAutoForm] log:', reb.log);
    } catch (e) {
        console.error('[rebalanceAutoForm]', e);
        toast.error('Error al rebalancear forma.');
    } finally {
        setAutoV2Rebalancing(false);
    }
}

export type ApplyPlanificacionCoverageToStatsParams = {
    coveredCount: number;
    extraHours?: number;
    slaVendidas: number;
    setAutoV2Coverage: Dispatch<SetStateAction<CoverageVerificationReport | null>>;
    setAutoV2GenStats: Dispatch<SetStateAction<AutoV2GenStats | null>>;
};

export function applyPlanificacionCoverageToStats({
    coveredCount,
    extraHours = 0,
    slaVendidas,
    setAutoV2Coverage,
    setAutoV2GenStats,
}: ApplyPlanificacionCoverageToStatsParams): void {
    setAutoV2Coverage(prev => {
        if (!prev) return prev;
        const newUncovered = Math.max(0, prev.coverage.uncoveredSlots - coveredCount);
        const newCovered = prev.coverage.coveredSlots + coveredCount;
        return {
            ...prev,
            coverage: {
                ...prev.coverage,
                uncoveredSlots: newUncovered,
                coveredSlots: newCovered,
                coverageRatio: prev.coverage.totalSlots > 0 ? newCovered / prev.coverage.totalSlots : 1,
            },
            ok: newUncovered === 0 && !prev.restViolations?.length && !prev.licenseConflicts?.length,
        };
    });
    setAutoV2GenStats(prev => {
        if (!prev) return prev;
        const newUncovered = Math.max(0, (prev.uncoveredSlots ?? 0) - coveredCount);
        const newBillable = prev.totalBillableHours + extraHours;
        const slaClosed = newUncovered === 0
            && (slaVendidas <= 0 || newBillable >= slaVendidas - 0.5);
        return { ...prev, uncoveredSlots: newUncovered, totalBillableHours: newBillable, slaHoursClosed: slaClosed };
    });
}

