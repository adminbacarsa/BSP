import type { AutoPlanningBrainResult } from './autoPlanningBrain';
import { generateScheduleV4 } from './autoScheduleEngineV4';
import type { V2EngineContext, V2GenerateResult, V2PositionDef, V2EmployeeDef } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition } from './autoLabCaseCatalog';
import { canUseFixedBandFloater } from './fixedBandFloaterScheduleEngine';
import { verifyScheduleCoverage, type CoverageVerificationReport } from './coverageVerification';
import { applyAbsenceCoverage, type CoverageGap } from './coverageEngine';
import { applyAbsenceSplitCoverage, type AbsenceSplitAction } from './absenceSplitCoverage';
import { ensureAbsenceCells, fillEmptyCellsWithRet } from './absenceFrancoUtils';
import { fixScheduleIssues, type FixerLogEntry, type FixerResult } from './coverageFixer';
import { planAbsenceCoverage, type AbsenceCoveragePlan } from './absenceCoveragePlanner';
import {
    applyExternalRetCoverage,
    computeModo8ExternalRetPlan,
    extendCtxWithExternalRet,
    type ExternalRetAction,
} from './externalRetCoverage';
import { runStrictSixTwoPipeline } from './planningPipeline';
import type { AutoLabRunResult } from './autoLabRuntime';
import { getAutoLabDateKey, getAutoLabDayLetter } from './autoLabRuntime';

export type AutoLabSchedulePipeline = 'none' | 'v4' | 'fixedBandFloater';

export interface AutoLabScheduleOutcome {
    pipeline: AutoLabSchedulePipeline;
    generation: V2GenerateResult | null;
    error?: string;
    coverageReport?: CoverageVerificationReport | null;
    absenceCoverageGaps?: CoverageGap[];
    absenceSplitActions?: AbsenceSplitAction[];
    absenceCoveragePlan?: AbsenceCoveragePlan;
    externalRetEmployees?: V2EmployeeDef[];
    externalRetActions?: ExternalRetAction[];
    fixerLog?: FixerLogEntry[];
    fixerSummary?: FixerResult['summary'];
}

function buildLabDefaultPositionByEmp(
    positions: V2PositionDef[],
    employees: { id: string }[],
): Record<string, string> {
    const map: Record<string, string> = {};
    if (positions.length === 1) {
        const name = positions[0].positionName;
        for (const emp of employees) map[emp.id] = name;
        return map;
    }
    let idx = 0;
    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        for (let i = 0; i < qty && idx < employees.length; i++) {
            map[employees[idx].id] = pos.positionName;
            idx++;
        }
    }
    for (const emp of employees) {
        if (!map[emp.id] && positions[0]) {
            map[emp.id] = positions[0].positionName;
        }
    }
    return map;
}

function postProcessAutoLabSchedule(
    ctx: V2EngineContext,
    pipeline: AutoLabSchedulePipeline,
    generation: V2GenerateResult,
): Pick<AutoLabScheduleOutcome, 'generation' | 'coverageReport' | 'absenceCoverageGaps' | 'absenceSplitActions' | 'absenceCoveragePlan' | 'externalRetEmployees' | 'externalRetActions' | 'fixerLog' | 'fixerSummary'> {
    let assignments = generation.assignments.map((a) => ({ ...a }));
    let absenceCoverageGaps: CoverageGap[] = [];

    if (pipeline === 'fixedBandFloater' && generation.stats.openingSlotByEmp) {
        const cov = applyAbsenceCoverage(
            assignments,
            ctx,
            generation.stats.openingSlotByEmp,
        );
        assignments = cov.assignments;
        absenceCoverageGaps = cov.gaps;
    }

    const openingSlotByEmp = generation.stats.openingSlotByEmp;

    assignments = ensureAbsenceCells(assignments, ctx);
    assignments = fillEmptyCellsWithRet(assignments, ctx, openingSlotByEmp);

    const modo8Plan = computeModo8ExternalRetPlan({
        ctx,
        assignments,
        openingSlotByEmp,
    });

    const split = applyAbsenceSplitCoverage(
        assignments,
        ctx,
        openingSlotByEmp,
        { skipModo12Days: modo8Plan.skipModo12Days },
    );
    assignments = split.assignments;

    const verifyCtx: V2EngineContext = {
        ...ctx,
        modo12Days: split.effectiveModo12Days,
        apretarCronoDays: split.effectiveModo12Days,
        allowFrancoWorkedRescue: false,
    };

    let coverageReport = verifyScheduleCoverage(
        verifyCtx,
        assignments,
        generation.stats,
        { inferModo12TCoverage: true },
    );

    const preliminaryPlan = planAbsenceCoverage({
        ctx: verifyCtx,
        assignments,
        stats: generation.stats,
        modo12Days: split.effectiveModo12Days,
        openingSlotByEmp,
        splitActions: split.actions,
        coverageGaps: absenceCoverageGaps,
        uncovered: coverageReport.uncovered,
        modo8Plan,
    });

    const externalRet = applyExternalRetCoverage({
        assignments,
        ctx: verifyCtx,
        modo8Plan,
        plan: preliminaryPlan,
        openingSlotByEmp,
    });
    assignments = externalRet.assignments;

    const extendedCtx = extendCtxWithExternalRet(verifyCtx, externalRet.externalEmployees);

    const fixer = fixScheduleIssues(
        extendedCtx,
        assignments,
        generation.stats,
        coverageReport,
    );
    assignments = fixer.assignments;

    coverageReport = verifyScheduleCoverage(
        extendedCtx,
        assignments,
        generation.stats,
        { inferModo12TCoverage: true },
    );

    const absenceCoveragePlan = planAbsenceCoverage({
        ctx: extendedCtx,
        assignments,
        stats: generation.stats,
        modo12Days: split.effectiveModo12Days,
        openingSlotByEmp,
        splitActions: split.actions,
        coverageGaps: absenceCoverageGaps,
        uncovered: coverageReport.uncovered,
        modo8Plan: externalRet.modo8Plan,
    });

    return {
        generation: { ...generation, assignments },
        coverageReport,
        absenceCoverageGaps,
        absenceSplitActions: split.actions,
        absenceCoveragePlan,
        externalRetEmployees: externalRet.externalEmployees,
        externalRetActions: externalRet.actions,
        fixerLog: fixer.log,
        fixerSummary: fixer.summary,
    };
}

export function buildAutoLabGenContext(
    caseDef: AutoLabCaseDefinition,
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'positions' | 'slaVendidas' | 'absences'>,
    brain: AutoPlanningBrainResult,
): V2EngineContext {
    const objectiveId = `auto-lab-${caseDef.id}`;
    const defaultPositionByEmp = buildLabDefaultPositionByEmp(run.positions, run.employees);
    return {
        positions: run.positions,
        employees: run.employees.map((e) => ({
            ...e,
            preferredObjectiveId: objectiveId,
        })),
        daysInMonth: run.daysInMonth,
        empMonthlyInitial: Object.fromEntries(run.employees.map((e) => [e.id, 0])),
        absences: run.absences,
        slaVendidas: run.slaVendidas,
        autoCycles: brain.cycles.length > 0 ? brain.cycles : [brain.pickedCycle],
        objectiveId,
        defaultPositionByEmp,
        budgetMode: 'cct',
        getDayLetter: getAutoLabDayLetter,
        getDateKey: getAutoLabDateKey,
        rotateShifts: brain.rotateShifts,
        ajustarCrono: brain.ajustarCrono,
        modo12Days: brain.modo12DaysEngine,
        contingencyApretarDays: brain.contingencyOk ? brain.contingencyDaysManual : [],
        apretarCronoDays: brain.modo12DaysEngine,
        strictSixTwo: brain.strictSixTwo,
        noFlexSchemeEmployees: true,
        allowFrancoWorkedRescue: false,
    };
}

export function generateAutoLabSchedule(
    caseDef: AutoLabCaseDefinition,
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'positions' | 'slaVendidas' | 'absences'>,
): AutoLabScheduleOutcome {
    const { brain } = run;

    if (!brain.feasibility.ok) {
        const detail = brain.feasibility.reasons[0]
            || brain.feasibility.warnings[0]
            || 'El cerebro marcó NO VIABLE — no se genera cronograma.';
        return {
            pipeline: 'none',
            generation: null,
            error: detail,
        };
    }
    if (!brain.contingencyOk) {
        return {
            pipeline: 'none',
            generation: null,
            error: brain.contingencyMessages[0] || 'Contingencia no viable.',
        };
    }

    // Modo 12 por ausencias: no bloquea generación; si la plantilla no alcanza, el post-proceso
    // deja huecos para RET externo (ver brain.absenceModo12Messages en panel cerebro).

    const ctx = buildAutoLabGenContext(caseDef, run, brain);

    try {
        if (brain.strictSixTwo && canUseFixedBandFloater(ctx)) {
            const piped = runStrictSixTwoPipeline({
                ...ctx,
                rotateShifts: false,
                demandDriven: false,
            });
            const post = postProcessAutoLabSchedule(ctx, 'fixedBandFloater', piped.generation);
            return { pipeline: 'fixedBandFloater', ...post };
        }

        const generation = generateScheduleV4(ctx);
        const post = postProcessAutoLabSchedule(ctx, 'v4', generation);
        return { pipeline: 'v4', ...post };
    } catch (err) {
        return {
            pipeline: 'none',
            generation: null,
            error: err instanceof Error ? err.message : 'Error al generar cronograma',
        };
    }
}

export function buildAssignmentIndex(
    assignments: V2GenerateResult['assignments'],
): Map<string, Map<string, V2GenerateResult['assignments'][number][]>> {
    const byEmp = new Map<string, Map<string, V2GenerateResult['assignments'][number][]>>();
    for (const a of assignments) {
        if (!byEmp.has(a.empId)) byEmp.set(a.empId, new Map());
        const byDay = byEmp.get(a.empId)!;
        if (!byDay.has(a.dateStr)) byDay.set(a.dateStr, []);
        byDay.get(a.dateStr)!.push(a);
    }
    return byEmp;
}

/** Puesto principal por guardia (motor positionGroups o mayoría en asignaciones). */
export function buildEmployeePositionMap(
    employees: { id: string }[],
    assignments: V2GenerateResult['assignments'],
    positionGroups?: Record<string, string[]>,
): Record<string, string> {
    const map: Record<string, string> = {};

    if (positionGroups) {
        for (const [posName, ids] of Object.entries(positionGroups)) {
            for (const id of ids) map[id] = posName;
        }
    }

    const counts: Record<string, Record<string, number>> = {};
    for (const a of assignments) {
        if (!a.positionName || (a.hours ?? 0) <= 0) continue;
        if (!counts[a.empId]) counts[a.empId] = {};
        counts[a.empId][a.positionName] = (counts[a.empId][a.positionName] || 0) + 1;
    }
    for (const emp of employees) {
        if (map[emp.id]) continue;
        const tallies = counts[emp.id];
        if (!tallies) continue;
        const top = Object.entries(tallies).sort(([, a], [, b]) => b - a)[0];
        if (top) map[emp.id] = top[0];
    }

    return map;
}

export function shortPositionLabel(
    positionName: string,
    positions: Array<{ positionName: string }>,
): string {
    const idx = positions.findIndex((p) => p.positionName === positionName);
    if (idx >= 0) return `P${idx + 1}`;
    const m = positionName.match(/(\d+)/);
    return m ? `P${m[1]}` : positionName.slice(0, 6);
}

const POSITION_BADGE_CLASSES = [
    'bg-indigo-100 text-indigo-800 border-indigo-200',
    'bg-emerald-100 text-emerald-800 border-emerald-200',
    'bg-amber-100 text-amber-900 border-amber-200',
    'bg-violet-100 text-violet-800 border-violet-200',
    'bg-sky-100 text-sky-800 border-sky-200',
    'bg-rose-100 text-rose-800 border-rose-200',
] as const;

export function positionBadgeClass(positionName: string, positions: Array<{ positionName: string }>): string {
    const idx = positions.findIndex((p) => p.positionName === positionName);
    return POSITION_BADGE_CLASSES[(idx >= 0 ? idx : 0) % POSITION_BADGE_CLASSES.length];
}

export function shiftCodeCellClass(code: string): string {
    const c = String(code || '').toUpperCase();
    if (c === 'M') return 'bg-sky-500 text-white border-sky-600';
    if (c === 'T') return 'bg-amber-500 text-white border-amber-600';
    if (c === 'N') return 'bg-indigo-700 text-white border-indigo-800';
    if (c === 'D12') return 'bg-sky-600 text-white border-sky-700';
    if (c === 'N12') return 'bg-indigo-900 text-white border-indigo-950';
    if (c === 'RET') return 'bg-violet-100 text-violet-800 border-violet-300';
    if (c === 'F' || c === 'FF' || c === 'FP') return 'bg-slate-200 text-slate-600 border-slate-300';
    if (c === 'FT') return 'bg-orange-200 text-orange-900 border-orange-400';
    if (['V', 'L', 'E', 'A', 'PG', 'AA'].includes(c)) return 'bg-rose-100 text-rose-800 border-rose-300';
    return 'bg-slate-100 text-slate-700 border-slate-300';
}

export function verifyAutoLabCoverage(
    caseDef: AutoLabCaseDefinition,
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'positions' | 'slaVendidas' | 'absences'>,
    scheduleOutcome: AutoLabScheduleOutcome,
): CoverageVerificationReport | null {
    if (scheduleOutcome.coverageReport) return scheduleOutcome.coverageReport;
    if (!scheduleOutcome.generation) return null;
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    return verifyScheduleCoverage(
        ctx,
        scheduleOutcome.generation.assignments,
        scheduleOutcome.generation.stats,
        { inferModo12TCoverage: false },
    );
}
