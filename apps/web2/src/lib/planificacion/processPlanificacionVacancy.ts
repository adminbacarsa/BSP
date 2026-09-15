import { toast } from 'sonner';
import { slaBlocksForPositionShift } from '@/lib/planificacion/splitShiftDisplay';
import {
    applyVacancyCoverageToChanges,
    collectVacancyFrancoConflicts,
    resolveVacancyDayCoverage,
    resolveTitularVacancyWorkShift,
    VACANCY_NON_WORK_CODES,
    type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import {
    listVacancyGapBandOptions,
    inferTitularGapBandFromHistory,
    resolveEffectiveVacancyGapTitular,
    buildTitularVacancyFromGapOption,
} from '@/lib/planificacion/vacancyGapBands';
import { defaultSplitForBandAtPosition, resolveEmployeeShift } from '@/lib/planificacion/planningRecompositionApply';

export type VacancyProcessDay = {
    dateStr: string;
    coverage: VacancyDayCoverage;
};

export type BuildVacancyProcessDaysParams = {
    activeDays: string[];
    vacancyData: { employeeId: string; startDate: string };
    vacancyDayCoverages: Record<string, VacancyDayCoverage>;
    selectedReplacement: string | null;
    employees: any[];
    shiftsMap: Record<string, any>;
    pendingChanges: Record<string, any>;
    effectivePosStructure: any[];
    activePosition: string | null;
    vacancyGapBandOverride: string | null;
    currentDate: Date;
};

export function buildTypicalShiftForMonth(
    empId: string,
    currentDate: Date,
    shiftsMap: Record<string, any>,
    pendingChanges: Record<string, any>,
) {
    const yr = currentDate.getFullYear();
    const mo = currentDate.getMonth();
    const days = new Date(yr, mo + 1, 0).getDate();
    const freq: Record<string, { count: number; shift: any }> = {};
    for (let d = 1; d <= days; d++) {
        const k = `${empId}_${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const pending = pendingChanges[k];
        const s = (pending && !pending.isDeleted) ? pending : shiftsMap[k];
        if (s?.code && !VACANCY_NON_WORK_CODES.has(String(s.code).toUpperCase())) {
            if (!freq[s.code]) freq[s.code] = { count: 0, shift: s };
            freq[s.code].count++;
        }
    }
    return Object.values(freq).sort((a, b) => b.count - a.count)[0]?.shift || null;
}

export function buildVacancyProcessDays({
    activeDays,
    vacancyData,
    vacancyDayCoverages,
    selectedReplacement,
    employees,
    shiftsMap,
    pendingChanges,
    effectivePosStructure,
    activePosition,
    vacancyGapBandOverride,
    currentDate,
}: BuildVacancyProcessDaysParams): VacancyProcessDay[] {
    const getTypicalShift = (empId: string) => buildTypicalShiftForMonth(empId, currentDate, shiftsMap, pendingChanges);

    return activeDays.map((dateStr) => {
        const resolved = resolveVacancyDayCoverage(dateStr, vacancyDayCoverages, selectedReplacement);
        if (resolved.mode === 'substitute') {
            const emp = employees.find((e: any) => e.id === resolved.employeeId);
            const rawTitular = resolveTitularVacancyWorkShift(
                vacancyData.employeeId,
                dateStr,
                shiftsMap,
                pendingChanges,
                getTypicalShift,
                (positionName, code) => slaBlocksForPositionShift(effectivePosStructure, positionName, code),
                { absenceBlockStart: vacancyData.startDate },
            );
            const prefPos = activePosition || rawTitular?.positionName || undefined;
            const gapOptions = listVacancyGapBandOptions(effectivePosStructure, prefPos || null);
            const hist = !rawTitular
                ? inferTitularGapBandFromHistory(
                    vacancyData.employeeId,
                    vacancyData.startDate,
                    effectivePosStructure,
                    prefPos || null,
                    shiftsMap,
                    pendingChanges,
                )
                : null;
            const inferred = hist
                ? buildTitularVacancyFromGapOption(
                    hist,
                    'history_inferred',
                    'Patrón previo al bloque (cronograma)',
                    undefined,
                )
                : rawTitular;
            const effectiveTitular = resolveEffectiveVacancyGapTitular(
                inferred,
                vacancyGapBandOverride,
                gapOptions,
                effectivePosStructure,
            );
            return {
                dateStr,
                coverage: {
                    mode: 'substitute' as const,
                    employeeId: resolved.employeeId,
                    employeeName: emp?.name ?? null,
                    gapBand: effectiveTitular?.code || undefined,
                    gapPosition: effectiveTitular?.positionName || activePosition || undefined,
                },
            };
        }
        if (resolved.mode === 'split') {
            const extShift = resolveEmployeeShift(resolved.extEmpId, dateStr, shiftsMap, pendingChanges);
            const adelShift = resolveEmployeeShift(resolved.adelEmpId, dateStr, shiftsMap, pendingChanges);
            return {
                dateStr,
                coverage: {
                    mode: 'split' as const,
                    extEmpId: resolved.extEmpId,
                    adelEmpId: resolved.adelEmpId,
                    gapBand: resolved.gapBand,
                    gapPosition: resolved.gapPosition,
                    extHomePosition: extShift?.positionName,
                    extBaseCode: extShift?.code,
                    adelBaseCode: adelShift?.code,
                    extExtraHours: resolved.extExtraHours,
                    secondExtExtraHours: resolved.secondExtExtraHours,
                },
            };
        }
        return { dateStr, coverage: { mode: 'none' as const } };
    });
}

export type ApplyPlanificacionVacancyParams = {
    pendingChanges: Record<string, any>;
    vacancyData: { employeeId: string; startDate: string };
    days: VacancyProcessDay[];
    selectedObjective: string;
    activePosition: string | null;
    shiftsMap: Record<string, any>;
    employees: any[];
    effectivePosStructure: any[];
    selectedClient: string;
    vacancyGapBandOverride: string | null;
    activeDays: string[];
    authorizeFrancoTrabajado: boolean;
    resolveSuggestedGapBandForPosition: (dateStr: string, positionName: string) => string | undefined;
    currentDate: Date;
};

export type ApplyPlanificacionVacancyResult = {
    changes: Record<string, any>;
    count: number;
    covered: number;
    splitCovered: number;
    cleared: number;
    absCode: string;
};

export function applyPlanificacionVacancyCoverage({
    pendingChanges,
    vacancyData,
    days,
    selectedObjective,
    activePosition,
    shiftsMap,
    employees,
    effectivePosStructure,
    selectedClient,
    vacancyGapBandOverride,
    activeDays,
    authorizeFrancoTrabajado,
    resolveSuggestedGapBandForPosition,
    currentDate,
}: ApplyPlanificacionVacancyParams): ApplyPlanificacionVacancyResult {
    const employeesById: Record<string, any> = {};
    employees.forEach((e: any) => { if (e.id) employeesById[e.id] = e; });
    const getTypicalShift = (empId: string) => buildTypicalShiftForMonth(empId, currentDate, shiftsMap, pendingChanges);

    const { changes, count, covered, splitCovered, cleared } = applyVacancyCoverageToChanges(pendingChanges, {
        vacancyData,
        days,
        selectedObjective,
        activePosition,
        shiftsMap,
        getTypicalShift,
        employeesById,
        clientId: selectedClient || undefined,
        defaultSplitForBand: (band, gapPosition) => {
            const times = defaultSplitForBandAtPosition(
                band,
                effectivePosStructure,
                gapPosition ?? null,
            );
            return { ext: times.ext, adel: times.adel };
        },
        positionStructure: effectivePosStructure,
        authorizeFrancoTrabajado,
        fallbackGapBand: (vacancyGapBandOverride ? vacancyGapBandOverride.split('__')[0] : null)
            || resolveSuggestedGapBandForPosition(activeDays[0] || '', activePosition || '')
            || undefined,
    });
    const absCode = days.length ? (changes[`${vacancyData.employeeId}_${days[0].dateStr}`]?.code || '—') : '—';
    return { changes, count, covered, splitCovered, cleared, absCode };
}

export function collectPlanificacionVacancyFrancoConflicts(
    days: VacancyProcessDay[],
    shiftsMap: Record<string, any>,
    pendingChanges: Record<string, any>,
    employees: any[],
) {
    const employeesById: Record<string, any> = {};
    employees.forEach((e: any) => { if (e.id) employeesById[e.id] = e; });
    return collectVacancyFrancoConflicts({ days, shiftsMap, employeesById }, pendingChanges);
}

export function toastVacancyApplyResult(
    absCode: string,
    count: number,
    covered: number,
    splitCovered: number,
    cleared: number,
) {
    const clearedMsg = cleared > 0 ? ` Se removieron ${cleared} turno(s) de cobertura anterior.` : '';
    const totalCovered = covered + splitCovered;
    if (totalCovered > 0) {
        const splitMsg = splitCovered > 0 ? ` (${covered} suplente, ${splitCovered} ext+adel)` : '';
        toast.success(`${absCode} en ${count} día(s) — ${totalCovered} con cobertura${splitMsg}.${clearedMsg} Guardá los cambios.`);
    } else {
        toast.success(`${absCode} en ${count} día(s) — sin cobertura asignada.${clearedMsg} Guardá los cambios.`);
    }
}

export function toastVacancyApplyError(e: unknown) {
    const msg = String((e as Error)?.message || '');
    if (msg.includes('FRANCO_COVERAGE')) {
        toast.error('Hay guardias en franco sin autorizar — revisá la cobertura o pedí PIN de supervisor.');
    } else {
        toast.error('Error al aplicar cobertura de licencia');
    }
}
