import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { toast } from 'sonner';
import { getDateKey, isDateLocked } from '@/lib/planificacion/utils';
import {
    buildPlannerContextFromAutoRun,
    runPlanningAgentOptimizeStep,
    shouldRunGeminiOptimizeStep,
} from '@/lib/planificacion/planningAgentPipeline';
import { bumpPlanificacionAutoV2Progress } from '@/lib/planificacion/generatePlanificacionAutoScheduleV2';
import { verifyScheduleCoverage, type CoverageVerificationReport } from '@/lib/planificacion/coverageVerification';
import type {
    V2Assignment,
    V2EngineContext,
    V2FeasibilityReport,
    V2GenerateStats,
} from '@/lib/planificacion/autoScheduleEngineV2';

export type PlanificacionAutoV2GeminiResult = {
    assignments: V2Assignment[];
    changes: Record<string, any>;
    coverage: CoverageVerificationReport;
};

export type ApplyPlanificacionAutoScheduleV2GeminiFn = (
    finalAssignments: V2Assignment[],
    coverage: CoverageVerificationReport,
    verifyCtx: V2EngineContext,
    stats: V2GenerateStats,
    newChanges: Record<string, any>,
    force: boolean,
    partOfGenerate: boolean,
) => Promise<PlanificacionAutoV2GeminiResult>;

export type RunPlanificacionAutoV2PlanningAgentGeminiParams = {
    selectedObjective: string;
    autoV2RunGemini: boolean;
    setAutoV2GeminiLoading: (value: boolean) => void;
    setAutoV2Progress: Dispatch<SetStateAction<{ pct: number; label: string } | null>>;
    currentDate: Date;
    autoV2ReportRef: MutableRefObject<V2FeasibilityReport | null>;
    daysInMonth: Date[];
    getObjectiveName: (objId: string) => string;
    slaVendidas: number;
    empresaId: string | undefined | null;
    setAutoV2GeminiSummary: (value: string | null) => void;
};

export async function runPlanificacionAutoV2PlanningAgentGemini(
    p: RunPlanificacionAutoV2PlanningAgentGeminiParams,
    finalAssignments: V2Assignment[],
    coverage: CoverageVerificationReport,
    verifyCtx: V2EngineContext,
    stats: V2GenerateStats,
    newChanges: Record<string, any>,
    force = false,
    partOfGenerate = false,
): Promise<PlanificacionAutoV2GeminiResult> {
    const {
        selectedObjective,
        autoV2RunGemini,
        setAutoV2GeminiLoading,
        setAutoV2Progress,
        currentDate,
        autoV2ReportRef,
        daysInMonth,
        getObjectiveName,
        slaVendidas,
        empresaId,
        setAutoV2GeminiSummary,
    } = p;

    if (!selectedObjective || (!autoV2RunGemini && !force)) {
        return { assignments: finalAssignments, changes: newChanges, coverage };
    }
    if (!force && !shouldRunGeminiOptimizeStep(coverage)) {
        return { assignments: finalAssignments, changes: newChanges, coverage };
    }
    setAutoV2GeminiLoading(true);
    try {
        if (partOfGenerate) {
            await bumpPlanificacionAutoV2Progress(setAutoV2Progress, 92, 'Ajuste fino IA (Gemini)…');
        } else {
            setAutoV2Progress({ pct: 8, label: 'Ajuste fino IA (Gemini)…' });
        }
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth();
        const mes = `${y}-${String(m + 1).padStart(2, '0')}`;
        const cutoff = autoV2ReportRef.current?.metrics?.cctCutoffDay ?? 25;
        const prevM = m === 0 ? 12 : m;
        const prevY = m === 0 ? y - 1 : y;
        const diasBloqueados = daysInMonth.map((d) => getDateKey(d)).filter((ds) => isDateLocked(ds));
        const plannerContext = buildPlannerContextFromAutoRun({
            mes,
            objetivo: getObjectiveName(selectedObjective),
            objectiveId: selectedObjective,
            slaVendidas,
            ctx: verifyCtx,
            assignments: finalAssignments,
            stats,
            diasBloqueados,
            cicloCCT: {
                cortePrev: `${prevY}-${String(prevM).padStart(2, '0')}-26`,
                corteActual: `${y}-${String(m + 1).padStart(2, '0')}-${String(cutoff).padStart(2, '0')}`,
                descripcion: `Ciclo CCT: 26/${prevM} → ${cutoff}/${m + 1}; control 200h por ciclo`,
            },
        });
        const result = await runPlanningAgentOptimizeStep({
            plannerContext,
            empresaId: empresaId || undefined,
            baseChanges: newChanges,
            objectiveId: selectedObjective,
            assignments: finalAssignments,
            isDateLocked,
        });
        setAutoV2GeminiSummary(result.gemini.resumen || null);
        const assignments = result.assignments;
        const changes = result.changes;
        if (result.gemini.correcciones?.length) {
            toast.info(`Ajuste fino IA: ${result.applied} corrección(es).`, { duration: 6000 });
        } else if (result.blocked) {
            toast.warning(result.gemini.razonBloqueo || 'IA: no puede cerrar el cronograma con la dotación actual.', { duration: 8000 });
        } else {
            toast.success('IA: cronograma sin cambios adicionales.', { duration: 4000 });
        }
        const coverageAfter = verifyScheduleCoverage(verifyCtx, assignments, stats);
        return { assignments, changes, coverage: coverageAfter };
    } catch (e: any) {
        console.error('[planningAgentGemini]', e);
        const msg = String(e?.message || e?.code || '');
        if (/deadline-exceeded|timeout|timed out/i.test(msg)) {
            toast.error(
                'Ajuste fino IA: tiempo agotado (~3 min). Se mantiene el cronograma ya generado. Podés desactivar Gemini y re-generar.',
                { duration: 10000 },
            );
        } else {
            toast.error(msg || 'Error en ajuste fino IA');
        }
        return { assignments: finalAssignments, changes: newChanges, coverage };
    } finally {
        setAutoV2GeminiLoading(false);
        if (!partOfGenerate) {
            setAutoV2Progress(null);
        }
    }
}
