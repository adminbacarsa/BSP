import type { AutoPlanningBrainResult } from './autoPlanningBrain';
import { generateScheduleV4 } from './autoScheduleEngineV4';
import type { V2EngineContext, V2GenerateResult, V2GenerateStats, V2PositionDef, V2EmployeeDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition, normalize24hsPositionCalendars } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition } from './autoLabCaseCatalog';
import { canUseFixedBandFloater } from './fixedBandFloaterScheduleEngine';
import { verifyScheduleCoverage, type CoverageVerificationReport } from './coverageVerification';
import { applyAbsenceCoverage, type CoverageGap } from './coverageEngine';
import { applyAbsenceSplitCoverage, type AbsenceSplitAction } from './absenceSplitCoverage';
import { ensureAbsenceCells, fillEmptyCellsWithRet, pickRetDesignee, consolidateRetToDesignee, applyServiceExcludedDays } from './absenceFrancoUtils';
import {
    buildGuardCapacityConfig,
    scanAssignmentsCapacityRisks,
    type GuardCapacityRisk,
} from './guardCapacityEvaluator';
import { fixScheduleIssues, type FixerLogEntry, type FixerResult } from './coverageFixer';
import { planAbsenceCoverage, type AbsenceCoveragePlan } from './absenceCoveragePlanner';
import {
    applyExternalRetCoverage,
    applyResidualExternalRetForGaps,
    computeModo8ExternalRetPlan,
    extendCtxWithExternalRet,
    type ExternalRetAction,
} from './externalRetCoverage';
import { applySurplusRetAbsentSubstitution, buildSurplusEmployeePool } from './surplusAbsentSubstitution';
import { resolveOpeningSlotByEmpForPostProcess } from './openingSlotResolver';
import { finalizeAutoLabSurplusSchedule, recomputeScheduleStatsFromAssignments } from './autoLabSurplusFinalize';
import { resolveMonthStartGlobalDayIndex } from './surplusRetCycle';
import { runStrictSixTwoPipeline } from './planningPipeline';
import type { AutoLabRunResult } from './autoLabRuntime';
import { getAutoLabDateKey, getAutoLabDayLetter } from './autoLabRuntime';
import { enrichRosterSurplusWithSchedule, type RosterSurplusReport } from './rosterSurplus';
import {
    analyzeCoveragePolicyBalance,
    fillCoverageGapsFromSurplusPool,
    repairCoverageOverstaffFromSurplus,
    buildUncoveredSlotsByDayFromBalance,
    uncoveredSlotCountFromBalance,
    type CoveragePolicyBalanceReport,
    type CoverageBalanceRepairAction,
    type CoverageGapFillAction,
} from './coveragePolicyBalance';
import { fillCustomGapsFromVolantes, type VolanteCoverageAction } from './volanteCustomCoverage';
import type { SurplusAbsentSubstitutionAction } from './surplusAbsentSubstitution';

export type AutoLabSchedulePipeline = 'none' | 'v4' | 'fixedBandFloater';

export interface AutoLabScheduleOutcome {
    pipeline: AutoLabSchedulePipeline;
    generation: V2GenerateResult | null;
    error?: string;
    coverageReport?: CoverageVerificationReport | null;
    absenceCoverageGaps?: CoverageGap[];
    absenceSplitActions?: AbsenceSplitAction[];
    surplusSubstitutionActions?: import('./surplusAbsentSubstitution').SurplusAbsentSubstitutionAction[];
    absenceCoveragePlan?: AbsenceCoveragePlan;
    externalRetEmployees?: V2EmployeeDef[];
    externalRetActions?: ExternalRetAction[];
    fixerLog?: FixerLogEntry[];
    fixerSummary?: FixerResult['summary'];
    /** Dotación en exceso tras generar (incluye excessByPosition e idle). */
    rosterSurplus?: RosterSurplusReport;
    /** Alertas de capacidad (racha, semana, RET activable). */
    capacityRisks?: GuardCapacityRisk[];
    /** Equilibrio día×puesto×banda (falta / sobrecobertura). */
    coveragePolicyBalance?: CoveragePolicyBalanceReport;
    coverageBalanceRepairs?: CoverageBalanceRepairAction[];
    coverageGapFillActions?: CoverageGapFillAction[];
}

import {
    buildPositionRequiredHeadcountMap,
    computePositionRequiredHeadcount,
} from './objectiveHeadcount';
import { is24hsPosition, resolveObjectiveScheduleFlags, shouldBypassFixedBandFloater } from './scheduleObjectiveFlags';

function buildLabDefaultPositionByEmp(
    positions: V2PositionDef[],
    employees: { id: string }[],
    positionHeadcount?: Record<string, number>,
    cycleKey: string = '6+2',
): Record<string, string> {
    const map: Record<string, string> = {};
    const isPaddingLabEmp = (id: string) => id.startsWith('lab-pad-');

    const headcountFor = (pos: V2PositionDef) => {
        const fromMap = positionHeadcount?.[pos.positionName];
        if (fromMap != null && fromMap > 0) return fromMap;
        return computePositionRequiredHeadcount(pos, cycleKey);
    };

    if (positions.length === 1) {
        const pos = positions[0];
        const name = pos.positionName;
        const headcount = headcountFor(pos);
        let assigned = 0;
        for (const emp of employees) {
            if (isPaddingLabEmp(emp.id)) continue;
            if (assigned >= headcount) break;
            map[emp.id] = name;
            assigned += 1;
        }
        return map;
    }

    let idx = 0;
    for (const pos of positions) {
        const headcount = headcountFor(pos);
        let assignedToPos = 0;
        while (assignedToPos < headcount && idx < employees.length) {
            const emp = employees[idx];
            idx += 1;
            if (isPaddingLabEmp(emp.id)) continue;
            map[emp.id] = pos.positionName;
            assignedToPos += 1;
        }
    }
    return map;
}

function buildMotorPositionByEmp(
    stats: Pick<V2GenerateStats, 'positionGroups'>,
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [posName, empIds] of Object.entries(stats.positionGroups || {})) {
        for (const empId of empIds) map[empId] = posName;
    }
    return map;
}

function postProcessAutoLabSchedule(
    baseCtx: V2EngineContext,
    pipeline: AutoLabSchedulePipeline,
    generation: V2GenerateResult,
    plantillaTotal?: number,
): Pick<AutoLabScheduleOutcome, 'generation' | 'coverageReport' | 'absenceCoverageGaps' | 'absenceSplitActions' | 'surplusSubstitutionActions' | 'absenceCoveragePlan' | 'externalRetEmployees' | 'externalRetActions' | 'fixerLog' | 'fixerSummary' | 'coveragePolicyBalance' | 'coverageBalanceRepairs' | 'coverageGapFillActions'> {
    const ctx: V2EngineContext = {
        ...baseCtx,
        positions: normalize24hsPositionCalendars(baseCtx.positions),
        defaultPositionByEmp: {
            ...(baseCtx.defaultPositionByEmp || {}),
            ...buildMotorPositionByEmp(generation.stats),
        },
    };

    let assignments = generation.assignments.map((a) => ({ ...a }));
    let absenceCoverageGaps: CoverageGap[] = [];

    const openingSlotByEmpEarly = resolveOpeningSlotByEmpForPostProcess({
        stats: generation.stats,
        assignments,
        daysInMonth: ctx.daysInMonth,
        getDateKey: ctx.getDateKey,
        employeeIds: ctx.employees.map((e) => e.id),
        positions: ctx.positions,
        monthStartGlobalDayIndex: resolveMonthStartGlobalDayIndex(ctx),
    }) ?? generation.stats.openingSlotByEmp;

    const surplusPoolOptions = {
        defaultShiftByEmp: ctx.defaultShiftByEmp,
        defaultPositionByEmp: ctx.defaultPositionByEmp,
        absences: ctx.absences,
    };
    const surplusPoolEarly = buildSurplusEmployeePool(
        generation.stats,
        ctx.employees.map((e) => e.id),
        ctx.positions,
        ctx.autoCycles?.[0] ?? '6+2',
        plantillaTotal,
        surplusPoolOptions,
    );
    const surplusStandbyMode = surplusPoolEarly.length > 0
        && (ctx.modo12Days?.length ?? 0) === 0;

    if (
        pipeline === 'fixedBandFloater'
        && generation.stats.openingSlotByEmp
        && !surplusStandbyMode
    ) {
        const cov = applyAbsenceCoverage(
            assignments,
            ctx,
            generation.stats.openingSlotByEmp,
        );
        assignments = cov.assignments;
        absenceCoverageGaps = cov.gaps;
    }

    const openingSlotByEmp = openingSlotByEmpEarly;
    const retDesignee = pickRetDesignee(ctx, generation.stats, assignments);
    const classicRotationPipeline = pipeline === 'fixedBandFloater';

    const statsWithSurplus = surplusPoolEarly.length > 0
        ? {
            ...generation.stats,
            idleEmployeeIds: surplusPoolEarly,
            retDesignateEmpIds: surplusPoolEarly,
        }
        : generation.stats;

    assignments = ensureAbsenceCells(assignments, ctx);
    assignments = fillEmptyCellsWithRet(assignments, ctx, openingSlotByEmp, {
        retDesignateId: retDesignee,
        stats: statsWithSurplus,
    });

    const surplusSubActions: SurplusAbsentSubstitutionAction[] = [];

    const surplusPool = surplusPoolEarly;
    const ctxWithSurplus: V2EngineContext = { ...ctx, idleSurplusEmpIds: surplusPool };

    const modo8Plan = computeModo8ExternalRetPlan({
        ctx: ctxWithSurplus,
        assignments,
        openingSlotByEmp,
    });

    const split = surplusStandbyMode
        ? {
            assignments,
            actions: [] as import('./absenceSplitCoverage').AbsenceSplitAction[],
            effectiveModo12Days: [] as string[],
        }
        : applyAbsenceSplitCoverage(
            assignments,
            ctxWithSurplus,
            openingSlotByEmp,
            { skipModo12Days: modo8Plan.skipModo12Days },
        );
    assignments = split.assignments;

    const verifyCtx: V2EngineContext = {
        ...ctxWithSurplus,
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

    const externalRet = surplusStandbyMode
        ? {
            assignments,
            externalEmployees: [] as V2EmployeeDef[],
            actions: [] as ExternalRetAction[],
        }
        : applyExternalRetCoverage({
            assignments,
            ctx: verifyCtx,
            modo8Plan,
            plan: preliminaryPlan,
            openingSlotByEmp,
        });
    assignments = externalRet.assignments;
    let externalRetEmployees = [...externalRet.externalEmployees];
    let externalRetActions = [...externalRet.actions];

    const extendedCtx = extendCtxWithExternalRet(verifyCtx, externalRet.externalEmployees);

    let fixerLog: FixerLogEntry[] = [];
    let fixerSummary: AutoLabScheduleOutcome['fixerSummary'] = {
        restViolationsFixed: 0,
        restViolationsRemaining: 0,
        licenseConflictsFixed: 0,
        licenseConflictsRemaining: 0,
        uncoveredFixed: 0,
        uncoveredRemaining: 0,
    };

    if (ctx.preserveRotativeIntegrity !== true && !surplusStandbyMode) {
        const fixer = fixScheduleIssues(
            extendedCtx,
            assignments,
            generation.stats,
            coverageReport,
        );
        assignments = fixer.assignments;
        fixerLog = fixer.log;
        fixerSummary = fixer.summary;
    }

    assignments = consolidateRetToDesignee(
        assignments,
        retDesignee,
        ctx,
        surplusPool.length > 0 ? surplusPool : generation.stats.retDesignateEmpIds,
    );

    if (surplusPool.length > 0) {
        assignments = fillEmptyCellsWithRet(assignments, ctx, openingSlotByEmp, {
            retDesignateId: retDesignee,
            stats: statsWithSurplus,
        });
    }

    let coverageBalanceRepairs: CoverageBalanceRepairAction[] = [];
    let coverageGapFillActions: CoverageGapFillAction[] = [];
    let volanteCoverageActions: VolanteCoverageAction[] = [];
    let usedVolanteByDay = new Map<string, Set<string>>();

    const volantePre = fillCustomGapsFromVolantes({
        assignments,
        ctx,
        stats: statsWithSurplus,
        usedVolanteByDay,
    });
    assignments = volantePre.assignments;
    volanteCoverageActions.push(...volantePre.actions);
    usedVolanteByDay = volantePre.usedVolanteByDay;

    if (surplusPool.length > 0 && !classicRotationPipeline) {
        const repaired = repairCoverageOverstaffFromSurplus({
            assignments,
            ctx,
            surplusPool,
            substitutionActions: surplusSubActions,
        });
        assignments = repaired.assignments;
        coverageBalanceRepairs = repaired.actions;

        const positionOrder = ctx.positions.map((p) => p.positionName);
        let usedSurplusByDay = new Map<string, Set<string>>();

        for (const posName of positionOrder) {
            const posOnlyGroups: Record<string, string[]> = {
                [posName]: statsWithSurplus.positionGroups?.[posName] ?? [],
            };

            const subPos = applySurplusRetAbsentSubstitution({
                assignments,
                ctx,
                stats: statsWithSurplus,
                openingSlotByEmp,
                positionFilter: posName,
                usedSurplusByDay,
                positionOrder,
            });
            assignments = subPos.assignments;
            usedSurplusByDay = subPos.usedSurplusByDay;
            surplusSubActions.push(...subPos.actions);

            const volantePos = fillCustomGapsFromVolantes({
                assignments,
                ctx,
                stats: statsWithSurplus,
                positionFilter: posName,
                usedVolanteByDay,
            });
            assignments = volantePos.assignments;
            volanteCoverageActions.push(...volantePos.actions);
            usedVolanteByDay = volantePos.usedVolanteByDay;

            const slaPos = fillCoverageGapsFromSurplusPool({
                assignments,
                ctx,
                surplusPool,
                stats: statsWithSurplus,
                positionFilter: posName,
            });
            assignments = slaPos.assignments;
            coverageGapFillActions.push(...slaPos.actions);
            for (const g of slaPos.actions) {
                surplusSubActions.push({
                    dateStr: g.dateStr,
                    absentEmpId: '',
                    surplusEmpId: g.empId,
                    positionName: g.positionName,
                    band: g.band,
                });
            }

            const repairPos = repairCoverageOverstaffFromSurplus({
                assignments,
                ctx,
                surplusPool,
                substitutionActions: surplusSubActions,
            });
            assignments = repairPos.assignments;
            coverageBalanceRepairs.push(...repairPos.actions);
        }

        const globalSub = applySurplusRetAbsentSubstitution({
            assignments,
            ctx,
            stats: statsWithSurplus,
            openingSlotByEmp,
            usedSurplusByDay,
            positionOrder,
        });
        assignments = globalSub.assignments;
        surplusSubActions.push(...globalSub.actions);

        const volanteGlobal = fillCustomGapsFromVolantes({
            assignments,
            ctx,
            stats: statsWithSurplus,
            usedVolanteByDay,
        });
        assignments = volanteGlobal.assignments;
        volanteCoverageActions.push(...volanteGlobal.actions);
        usedVolanteByDay = volanteGlobal.usedVolanteByDay;

        const globalGaps = fillCoverageGapsFromSurplusPool({
            assignments,
            ctx,
            surplusPool,
            stats: statsWithSurplus,
        });
        assignments = globalGaps.assignments;
        coverageGapFillActions.push(...globalGaps.actions);
        for (const g of globalGaps.actions) {
            surplusSubActions.push({
                dateStr: g.dateStr,
                absentEmpId: '',
                surplusEmpId: g.empId,
                positionName: g.positionName,
                band: g.band,
            });
        }
    }

    assignments = finalizeAutoLabSurplusSchedule({
        assignments,
        ctx,
        surplusPool,
        substitutionActions: surplusSubActions,
        openingSlotByEmp,
        positionGroups: statsWithSurplus.positionGroups,
    });

    let coveragePolicyBalance = analyzeCoveragePolicyBalance(ctx, assignments);

    if (!coveragePolicyBalance.ok && coveragePolicyBalance.underSlotCount > 0 && surplusPool.length > 0) {
        if (surplusStandbyMode) {
            const lastSub = applySurplusRetAbsentSubstitution({
                assignments,
                ctx,
                stats: statsWithSurplus,
                openingSlotByEmp,
            });
            assignments = lastSub.assignments;
            surplusSubActions.push(...lastSub.actions);

            const lastGap = fillCoverageGapsFromSurplusPool({
                assignments,
                ctx,
                surplusPool,
                stats: statsWithSurplus,
            });
            assignments = lastGap.assignments;
            coverageGapFillActions.push(...lastGap.actions);

            assignments = finalizeAutoLabSurplusSchedule({
                assignments,
                ctx,
                surplusPool,
                substitutionActions: surplusSubActions,
                openingSlotByEmp,
                positionGroups: statsWithSurplus.positionGroups,
            });

            const repairLate = repairCoverageOverstaffFromSurplus({
                assignments,
                ctx,
                surplusPool,
                substitutionActions: surplusSubActions,
            });
            assignments = repairLate.assignments;
            coverageBalanceRepairs.push(...repairLate.actions);

            coveragePolicyBalance = analyzeCoveragePolicyBalance(ctx, assignments);
        } else {
            const residualExt = applyResidualExternalRetForGaps({
                assignments,
                ctx,
                underGaps: coveragePolicyBalance.underCoverage,
                surplusPool,
            });
            if (residualExt.externalEmployees.length > 0) {
                assignments = residualExt.assignments;
                externalRetEmployees.push(...residualExt.externalEmployees);
                externalRetActions.push(...residualExt.actions);
                coveragePolicyBalance = analyzeCoveragePolicyBalance(ctx, assignments);
            }
        }
    }

    assignments = applyServiceExcludedDays(assignments, ctx);

    coveragePolicyBalance = analyzeCoveragePolicyBalance(ctx, assignments);
    const uncoveredSlotsByDay = buildUncoveredSlotsByDayFromBalance(coveragePolicyBalance);
    const uncoveredSlots = uncoveredSlotCountFromBalance(coveragePolicyBalance);

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

    const capacityCfg = buildGuardCapacityConfig(ctx.autoCycles || [], {
        modo12: (ctx.modo12Days?.length ?? 0) > 0,
        contingency: (ctx.contingencyApretarDays?.length ?? 0) > 0,
    });
    const capacityRisks = scanAssignmentsCapacityRisks(
        assignments,
        ctx.absences,
        ctx.employees.map((e) => e.id),
        ctx.daysInMonth.map((d) => ctx.getDateKey(d)),
        capacityCfg,
    );

    const recomputed = recomputeScheduleStatsFromAssignments(
        assignments,
        generation.stats,
        ctx.employees.map((e) => e.id),
    );

    return {
        generation: {
            ...generation,
            assignments,
            stats: {
                ...generation.stats,
                ...recomputed,
                idleEmployeeIds: surplusPool.length > 0
                    ? surplusPool
                    : generation.stats.idleEmployeeIds,
                uncoveredSlotsByDay,
                uncoveredSlots,
                slaHoursClosed: coveragePolicyBalance.ok,
            },
        },
        coverageReport,
        absenceCoverageGaps,
        absenceSplitActions: split.actions,
        surplusSubstitutionActions: surplusSubActions,
        absenceCoveragePlan,
        externalRetEmployees,
        externalRetActions,
        fixerLog,
        fixerSummary,
        capacityRisks,
        coveragePolicyBalance,
        coverageBalanceRepairs,
        coverageGapFillActions,
    };
}

export { is24hsPosition } from './scheduleObjectiveFlags';

export function buildAutoLabGenContext(
    caseDef: AutoLabCaseDefinition,
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'calendarDaysInVigencia' | 'serviceExcludedDates' | 'positions' | 'slaVendidas' | 'absences'>,
    brain: AutoPlanningBrainResult,
): V2EngineContext {
    const objectiveId = run.objectiveId;
    const cycleKey = brain.cycles[0] ?? brain.pickedCycle ?? '6+2';
    const positionHeadcount = buildPositionRequiredHeadcountMap(run.positions, cycleKey);
    const rosterSeedByEmp = caseDef.defaultPositionByEmp
        ? undefined
        : buildLabDefaultPositionByEmp(
            run.positions,
            run.employees,
            positionHeadcount,
            cycleKey,
        );
    const defaultPositionByEmp: Record<string, string> = {
        ...(rosterSeedByEmp || {}),
        ...(caseDef.defaultPositionByEmp || {}),
    };
    const defaultShiftByEmp: Record<string, string> = { ...(caseDef.defaultShiftByEmp || {}) };
    const scheduleFlags = resolveObjectiveScheduleFlags(run.positions);
    const monthStartGlobalDayIndex = resolveMonthStartGlobalDayIndex({
        daysInMonth: run.daysInMonth,
    } as V2EngineContext);
    return {
        positions: normalize24hsPositionCalendars(run.positions),
        employees: run.employees.map((e) => ({
            ...e,
            preferredObjectiveId: e.preferredObjectiveId?.trim()
                ? e.preferredObjectiveId
                : run.objectiveId,
        })),
        daysInMonth: run.daysInMonth,
        calendarDaysInMonth: run.calendarDaysInVigencia,
        serviceExcludedDates: run.serviceExcludedDates.length > 0
            ? run.serviceExcludedDates
            : caseDef.excludedDates,
        empMonthlyInitial: Object.fromEntries(run.employees.map((e) => [e.id, 0])),
        absences: run.absences,
        slaVendidas: run.slaVendidas,
        autoCycles: brain.cycles.length > 0 ? brain.cycles : [brain.pickedCycle],
        objectiveId: run.objectiveId,
        defaultPositionByEmp: Object.keys(defaultPositionByEmp).length > 0 ? defaultPositionByEmp : undefined,
        rosterSeedByEmp,
        defaultShiftByEmp: Object.keys(defaultShiftByEmp).length > 0 ? defaultShiftByEmp : undefined,
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
        allowCustom24hsBackup: scheduleFlags.allowCustom24hsBackup,
        schedulePhasedRotativeFirst: scheduleFlags.schedulePhasedRotativeFirst,
        preserveRotativeIntegrity: scheduleFlags.preserveRotativeIntegrity,
        allowFrancoWorkedRescue: false,
        headcountByPax: true,
        coverageWisdom: caseDef.coverageWisdom ?? null,
        monthStartGlobalDayIndex,
    };
}

export function generateAutoLabSchedule(
    caseDef: AutoLabCaseDefinition,
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'calendarDaysInVigencia' | 'serviceExcludedDates' | 'positions' | 'slaVendidas' | 'absences' | 'rosterSurplus'>,
): AutoLabScheduleOutcome {
    const { brain } = run;
    const plantillaTotal = brain.staffing?.plantillaTotal ?? run.rosterSurplus?.plantillaTotal;

    // Igual que Planificación real: déficit de horas/dotación no bloquea la generación.
    // El motor intenta cerrar; huecos residuales → RET externo en post-proceso.
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
        const bypassFloater = shouldBypassFixedBandFloater(run.positions);
        const useFixedBandFloater = canUseFixedBandFloater(ctx) && !bypassFloater;
        if (useFixedBandFloater) {
            const piped = runStrictSixTwoPipeline({
                ...ctx,
                rotateShifts: false,
                demandDriven: false,
            });
            const post = postProcessAutoLabSchedule(ctx, 'fixedBandFloater', piped.generation, plantillaTotal);
            const rosterSurplus = enrichRosterSurplusWithSchedule(run.rosterSurplus, {
                employees: run.employees,
                stats: post.generation!.stats,
                assignments: post.generation!.assignments,
                ctx,
            });
            return { pipeline: 'fixedBandFloater', ...post, rosterSurplus };
        }

        const generation = generateScheduleV4(ctx);
        const post = postProcessAutoLabSchedule(ctx, 'v4', generation, plantillaTotal);
        const rosterSurplus = enrichRosterSurplusWithSchedule(run.rosterSurplus, {
            employees: run.employees,
            stats: post.generation!.stats,
            assignments: post.generation!.assignments,
            ctx,
        });
        return { pipeline: 'v4', ...post, rosterSurplus };
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

/** Puesto principal por guardia (motor positionGroups; sin inferir puesto para ociosos). */
export function buildEmployeePositionMap(
    employees: { id: string }[],
    assignments: V2GenerateResult['assignments'],
    positionGroups?: Record<string, string[]>,
    idleEmployeeIds?: string[],
): Record<string, string> {
    const map: Record<string, string> = {};
    const idleSet = new Set(idleEmployeeIds ?? []);

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
        if (map[emp.id] || idleSet.has(emp.id)) continue;
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
    run: Pick<AutoLabRunResult, 'brain' | 'employees' | 'daysInMonth' | 'calendarDaysInVigencia' | 'serviceExcludedDates' | 'positions' | 'slaVendidas' | 'absences'>,
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
