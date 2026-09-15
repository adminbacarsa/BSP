import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { PLANNING_ENGINE_VERSION } from '@/lib/planificacion/planificacionGridVisuals';
import { getDateKey, getDayLetter } from '@/lib/planificacion/utils';
import { isPosActiveOnDay } from '@/lib/planificacion/planificacionPositionEngine';
import { turnoCuentaParaCronoPlanificado } from '@/lib/planificacion/planificacionPlanningShiftRules';
import { PLANNING_NON_BILLABLE_CODES } from '@/lib/planificacion/positionCoverageUnits';
import { resolveCronogramPlanningRules } from '@/lib/planificacion/cronogramPlanningRules';
import { buildObjectiveScheduleProfile } from '@/lib/planificacion/objectiveServiceModel';
import { resolveAutoPlanningBrain, type AutoPlanningBrainResult } from '@/lib/planificacion/autoPlanningBrain';
import { buildObjectiveCoveragePreflight, type ObjectiveCoveragePreflight } from '@/lib/planificacion/objectiveCoverageDemand';
import { resolveObjectiveScheduleFlags } from '@/lib/planificacion/scheduleObjectiveFlags';
import {
    type V2Assignment,
    type V2EngineContext,
    type V2FeasibilityReport,
    type V2GenerateStats,
} from '@/lib/planificacion/autoScheduleEngineV2';
import type { PlanificacionAbsencesByEmp } from '@/lib/planificacion/loadPlanificacionAbsencesForRange';
import { bumpPlanificacionAutoV2Progress } from '@/lib/planificacion/generatePlanificacionAutoScheduleV2';
import { fetchCoverageWisdomHistory, DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS } from '@/lib/planificacion/fetchPlanningCoverageWisdomHistory';
import type { PlanningCoverageWisdom } from '@/lib/planificacion/planningCoverageWisdom';
import { fetchPlanningMonthShifts } from '@/lib/planificacion/loadPlanningMonthShifts';
import { dominantDotacionFromPlanningCells } from '@/lib/planificacion/seedDotacionFromPrevMonth';
import { applySlaContractDotacion, buildPositionAssignmentsByEmp, buildSlaRotationByDate } from '@/lib/planificacion/slaContractPlanning';
import { runPlanningGeneration, resolvePlanningGenerationRoute } from '@/lib/planificacion/planningGenerationRouter';
import { applyAbsenceCoverage, type CoverageGap } from '@/lib/planificacion/coverageEngine';
import { applyServiceExcludedDays } from '@/lib/planificacion/absenceFrancoUtils';
import { verifyScheduleCoverage, type CoverageVerificationReport } from '@/lib/planificacion/coverageVerification';
import { analyzeCoveragePolicyBalance } from '@/lib/planificacion/coveragePolicyBalance';
import { evaluateScheduleClosure } from '@/lib/planificacion/scheduleClosureGate';
import { fixScheduleIssues } from '@/lib/planificacion/coverageFixer';
import { buildScheduleOptimizationSuggestions, type ScheduleChangeSuggestion } from '@/lib/planificacion/scheduleOptimizationSuggestions';
import { verifyScheduleForm, type ScheduleFormValidationReport } from '@/lib/planificacion/scheduleFormValidator';
import { rebalanceScheduleForm, type FormRebalanceLogEntry } from '@/lib/planificacion/scheduleFormRebalancer';
import { calcShiftHours } from '@/lib/planificacion/planificacionBandHours';
import {
    compareObjectiveMonthSchedules,
    formatCompareObjectiveMonthsReport,
} from '@/lib/planificacion/compareObjectiveMonthSchedules';

export type LastGenOpeningSnapshot = {
    year: number;
    month: number;
    objectiveId: string;
    openingSlotByEmp: Record<string, number>;
    daysCount: number;
};

export type AutoV2TrailDiagRow = {
    id: string;
    nombre: string;
    puesto: string;
    puestoQty: number;
    lastBand: string;
    trailWork: number;
    trailRest: number;
    julioSlot?: number;
    julioBand?: string;
    diasFranco?: number;
};

export type AutoV2GenStats = {
    employeeMonthlyHours: Record<string, number>;
    employeeCycleHours: { current: Record<string, number>; next: Record<string, number> };
    targetHours: number;
    totalBillableHours: number;
    gridBillableHours?: number;
    cellsSkippedOverwrite?: number;
    uncoveredSlots: number;
    idleEmployeeIds?: string[];
    strandedEmployeeIds?: string[];
    relocatedEmployeeIds?: string[];
    primaryShiftByEmp?: Record<string, string | null>;
    positionGroups?: Record<string, string[]>;
    employeeRetCount?: Record<string, number>;
    employeeRetHoursPotential?: Record<string, number>;
    totalRetCount?: number;
    totalRetHoursPotential?: number;
    overCoverageRetDays?: number;
    maxRetConcurrent?: number;
    ajustarCrono?: boolean;
    apretarCronoDays?: string[];
    uncoveredSlotsByDay?: Record<string, { positionName: string; code: string; missing: number }[]>;
    excessPositionEmployees?: { positionName: string; assigned: number; needed: number; excess: number }[];
    slaDeficitRemaining?: number;
    slaHoursClosed?: boolean;
};

export type AutoV2LastRun = {
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    ctx: V2EngineContext;
};

export type ApplyPlanificacionAutoScheduleV2GeminiFn = (
    finalAssignments: V2Assignment[],
    coverage: CoverageVerificationReport,
    verifyCtx: V2EngineContext,
    stats: V2GenerateStats,
    newChanges: Record<string, any>,
    force: boolean,
    partOfGenerate: boolean,
) => Promise<{
    assignments: V2Assignment[];
    changes: Record<string, any>;
    coverage: CoverageVerificationReport;
}>;

export type ApplyPlanificacionAutoScheduleV2Params = {
    selectedObjective: string;
    autoV2ReportRef: MutableRefObject<V2FeasibilityReport | null>;
    autoSelectedCyclesRef: MutableRefObject<string[]>;
    autoCycles: string[];
    setAutoV2Generating: (value: boolean) => void;
    setAutoV2Progress: Dispatch<SetStateAction<{ pct: number; label: string } | null>>;
    currentDate: Date;
    loadAbsencesForRange: (monthStart: Date, monthEnd: Date) => Promise<PlanificacionAbsencesByEmp>;
    mergeAbsencesFromLocalGrid: (
        absences: PlanificacionAbsencesByEmp,
        empIds: string[],
        monthStart: Date,
        monthEnd: Date,
    ) => void;
    planningDotacionEmployees: any[];
    setAutoAbsencesMap: (value: PlanificacionAbsencesByEmp) => void;
    empresaId: string | undefined | null;
    scopeEmpresa: boolean;
    migracionCompleta: boolean;
    setAutoContingenciaDias: Dispatch<SetStateAction<Set<string>>>;
    daysInMonth: Date[];
    setAutoV2CoveragePreflight: Dispatch<SetStateAction<ObjectiveCoveragePreflight | null>>;
    positionStructure: any[];
    slaVendidas: number;
    autoPlanningBrainRef: MutableRefObject<AutoPlanningBrainResult | null>;
    autoContingenciaDias: Set<string>;
    displayedEmployees: any[];
    clients: any[];
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
    activeSlaPositionAssignments: any;
    activeSlaServiceRotations: any;
    activeSlaServiceRules: any;
    employees: any[];
    autoV2BudgetMode: string;
    autoRotateForce: boolean | null;
    autoAjustarCrono: boolean;
    setAutoPlanningBrainReport: (value: AutoPlanningBrainResult | null) => void;
    lastGenOpeningRef: MutableRefObject<LastGenOpeningSnapshot | null>;
    slaCodeHoursHint: Record<string, number> | undefined;
    authorizedOver200IdsRef: MutableRefObject<Set<string>>;
    planningRules: { cctMaxBillableHours?: number; targetAvgHoursPerEmployee?: number };
    useSixPlusOne: boolean;
    autoCoverAbsences: boolean;
    setAutoCoverageGaps: (value: CoverageGap[]) => void;
    autoOverwrite: boolean;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    setCapOverflowEmps: (value: { empId: string; nombre: string }[]) => void;
    setOver200AuthChecked: (value: Record<string, boolean>) => void;
    setOver200AuthPin: (value: string) => void;
    setOver200AuthError: (value: string) => void;
    setAutoV2TrailDiag: (value: AutoV2TrailDiagRow[] | null) => void;
    setAutoV2GenStats: Dispatch<SetStateAction<AutoV2GenStats | null>>;
    setAutoV2Coverage: Dispatch<SetStateAction<CoverageVerificationReport | null>>;
    setAutoV2Suggestions: (value: ScheduleChangeSuggestion[] | null) => void;
    setAutoV2LastRun: Dispatch<SetStateAction<AutoV2LastRun | null>>;
    runAutoV2PlanningAgentGemini: ApplyPlanificacionAutoScheduleV2GeminiFn;
    setAutoV2RebalanceLog: (value: FormRebalanceLogEntry[]) => void;
    setAutoV2FormReport: (value: ScheduleFormValidationReport | null) => void;
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>> | ((value: Record<string, any>) => void);
    setAutoGeneratedReady: (value: boolean) => void;
    setAutoWizardStep: (value: 'configure' | 'detecting' | 'verified' | 'sla_open' | 'done') => void;
    setAutoV2Running: (value: boolean) => void;
};

export async function applyPlanificacionAutoScheduleV2(
    p: ApplyPlanificacionAutoScheduleV2Params,
    cyclesOverride?: string[],
): Promise<void> {
    const {
        selectedObjective,
        autoV2ReportRef,
        autoSelectedCyclesRef,
        autoCycles,
        setAutoV2Generating,
        setAutoV2Progress,
        currentDate,
        loadAbsencesForRange,
        mergeAbsencesFromLocalGrid,
        planningDotacionEmployees,
        setAutoAbsencesMap,
        empresaId,
        scopeEmpresa,
        migracionCompleta,
        setAutoContingenciaDias,
        daysInMonth,
        setAutoV2CoveragePreflight,
        positionStructure,
        slaVendidas,
        autoPlanningBrainRef,
        autoContingenciaDias,
        displayedEmployees,
        clients,
        empDefaultPos,
        empDefaultShift,
        activeSlaPositionAssignments,
        activeSlaServiceRotations,
        activeSlaServiceRules,
        employees,
        autoV2BudgetMode,
        autoRotateForce,
        autoAjustarCrono,
        setAutoPlanningBrainReport,
        lastGenOpeningRef,
        slaCodeHoursHint,
        authorizedOver200IdsRef,
        planningRules,
        useSixPlusOne,
        autoCoverAbsences,
        setAutoCoverageGaps,
        autoOverwrite,
        pendingChanges,
        shiftsMap,
        setCapOverflowEmps,
        setOver200AuthChecked,
        setOver200AuthPin,
        setOver200AuthError,
        setAutoV2TrailDiag,
        setAutoV2GenStats,
        setAutoV2Coverage,
        setAutoV2Suggestions,
        setAutoV2LastRun,
        runAutoV2PlanningAgentGemini,
        setAutoV2RebalanceLog,
        setAutoV2FormReport,
        setPendingChanges,
        setAutoGeneratedReady,
        setAutoWizardStep,
        setAutoV2Running,
    } = p;
    const bumpAutoV2Progress = async (pct: number, label: string) => {
        await bumpPlanificacionAutoV2Progress(setAutoV2Progress, pct, label);
    };
        if (!selectedObjective) return;
        if (!autoV2ReportRef.current) { toast.error('Calculá viabilidad primero'); return; }
        const cyclesForGen = cyclesOverride ?? autoSelectedCyclesRef.current ?? autoCycles;
        if (!cyclesForGen.length) { toast.error('No se detectó esquema de ciclo'); return; }
        setAutoV2Generating(true);
        setAutoV2Progress({ pct: 4, label: 'Iniciando generación…' });
        try {
            const SHIFT_HRS_LOCAL: Record<string,number> = { M:8, T:8, N:8, D12:12, N12:12 };

            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0, 23, 59, 59);
            await bumpAutoV2Progress(10, 'Cargando ausencias y licencias del mes…');
            const absences = await loadAbsencesForRange(monthStart, monthEnd);
            mergeAbsencesFromLocalGrid(absences, planningDotacionEmployees.map((e: any) => e.id), monthStart, monthEnd);
            setAutoAbsencesMap(absences);

            let coverageWisdom: PlanningCoverageWisdom | null = null;
            if (empresaId && selectedObjective) {
                await bumpAutoV2Progress(14, `Consultando historial operativo (${DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS} meses)…`);
                const empNames: Record<string, string> = {};
                planningDotacionEmployees.forEach((e: any) => {
                    empNames[e.id] = e.nombre || e.name || e.id;
                });
                try {
                    coverageWisdom = await fetchCoverageWisdomHistory({
                        empresaId,
                        objectiveId: selectedObjective,
                        year: currentDate.getFullYear(),
                        month: currentDate.getMonth() + 1,
                        lookbackMonths: DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
                        scopeEmpresa,
                        migracionCompleta,
                        employeeNames: empNames,
                        rosterEmployeeIds: new Set(planningDotacionEmployees.map((e: any) => e.id)),
                    });
                    if (coverageWisdom.cellsAnalyzed > 0 || coverageWisdom.events.length > 0) {
                        toast.info(coverageWisdom.summary, { duration: 6000 });
                    }
                } catch (wisdomErr) {
                    console.warn('[auto] fetchCoverageWisdomHistory', wisdomErr);
                }
            }

            const autoModo12AbsDays = new Set<string>();
            for (const map of Object.values(absences)) {
                if (!map) continue;
                map.forEach((code, ds) => { if (['V','L','E'].includes(String(code).toUpperCase())) autoModo12AbsDays.add(ds); });
            }
            setAutoContingenciaDias(prev => {
                const next = new Set([...prev].filter(d => !autoModo12AbsDays.has(d)));
                return next.size !== prev.size ? next : prev;
            });

            const preflightDays = daysInMonth.map(day => {
                const dateStr = getDateKey(day);
                return { dateStr, dayLetter: getDayLetter(dateStr) };
            });
            setAutoV2CoveragePreflight(buildObjectiveCoveragePreflight({
                positions: positionStructure,
                days: preflightDays,
                employees: planningDotacionEmployees.map((e: any) => ({ id: e.id, nombre: e.nombre, name: e.name })),
                absences,
                slaVendidas,
                cycles: cyclesForGen,
                objectiveId: selectedObjective,
                isPosActiveOnDay,
                apretarCronoDays: autoPlanningBrainRef.current?.modo12DaysEngine ?? [...autoContingenciaDias],
            }));

            const empMonthlyInitial: Record<string,number> = {};
            displayedEmployees.forEach((emp: any) => { empMonthlyInitial[emp.id] = 0; });
            const cyclePreStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 26);
            const cyclePreEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
            await bumpAutoV2Progress(24, 'Leyendo cola CCT (26 → fin mes anterior)…');
            const prevTailSnap  = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(cyclePreStart)),
                where('startTime', '<=', Timestamp.fromDate(cyclePreEnd))
            ));
            prevTailSnap.docs.forEach(d => {
                const data = d.data() as any;
                if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
                const empId = data.employeeId; if (!empId) return;
                if (PLANNING_NON_BILLABLE_CODES.has(String(data.code||'').toUpperCase())) return;
                const h = Number(data.hours) || SHIFT_HRS_LOCAL[String(data.code||'').toUpperCase()] || 8;
                empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + h;
            });

            // ── Racha del mes anterior: calcula la fase de ciclo correcta para el día 1 ──
            // Consultamos los últimos 10 días del mes anterior (cubre 6+2 y 4+2).
            // Sin esto el motor asigna offsets ficticios y genera hasta 9 días seguidos (ej. trabajó
            // mayo 29-31 y el motor arranca el ciclo desde el día 1 de junio sin saberlo).
            const prevMonthEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0); // último día mes anterior
            const trailLookbackStart = new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), Math.max(1, prevMonthEndDate.getDate() - 9));
            const prevTrailSnap = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(trailLookbackStart)),
                where('startTime', '<=', Timestamp.fromDate(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), prevMonthEndDate.getDate(), 23, 59, 59)))
            ));
            const prevTrailByEmp: Record<string, Record<string, string>> = {};
            const FRANCO_CODES_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
            prevTrailSnap.docs.forEach(d => {
                const data = d.data() as any;
                if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
                if (!data.employeeId || !data.startTime) return;
                const dt: Date = (data.startTime as Timestamp).toDate();
                const dateStr = getDateKey(dt);
                const code = String(data.code || '').toUpperCase();
                if (!prevTrailByEmp[data.employeeId]) prevTrailByEmp[data.employeeId] = {};
                prevTrailByEmp[data.employeeId][dateStr] = code;
            });
            const prevMonthTrailingWorkDays: Record<string, number> = {};
            const prevMonthTrailingRestDays: Record<string, number> = {};
            const prevMonthLastShiftByEmp: Record<string, string> = {};
            const prevMonthLastWorkBandBeforeRest: Record<string, string> = {};
            const lastDayStr = getDateKey(prevMonthEndDate);
            displayedEmployees.forEach((emp: any) => {
                const empShifts = prevTrailByEmp[emp.id] || {};
                const lastCode = empShifts[lastDayStr];
                if (!lastCode) return; // sin datos, el motor usará offset distribuido
                // RET es día de trabajo en el ciclo CCT — contar como trabajo y buscar banda real
                if (lastCode === 'RET') {
                    prevMonthLastShiftByEmp[emp.id] = 'RET';
                    let workCount = 1;
                    let foundBand: string | null = null;
                    let consGap = 0;
                    for (let d = prevMonthEndDate.getDate() - 1; d >= 1; d--) {
                        const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                        const c = empShifts[ds];
                        if (!c) {
                            consGap++;
                            if (consGap > 1) break;
                            workCount++;
                            continue;
                        }
                        consGap = 0;
                        if (FRANCO_CODES_SET.has(c)) break;
                        if (c !== 'RET' && !foundBand) foundBand = c;
                        workCount++;
                    }
                    prevMonthTrailingWorkDays[emp.id] = workCount;
                    prevMonthTrailingRestDays[emp.id] = 0;
                    if (foundBand) prevMonthLastWorkBandBeforeRest[emp.id] = foundBand;
                    return;
                }
                prevMonthLastShiftByEmp[emp.id] = lastCode;
                if (FRANCO_CODES_SET.has(lastCode)) {
                    for (let d = prevMonthEndDate.getDate(); d >= 1; d--) {
                        const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                        const c = empShifts[ds];
                        if (!c) break;
                        if (!FRANCO_CODES_SET.has(c)) {
                            prevMonthLastWorkBandBeforeRest[emp.id] = c;
                            break;
                        }
                    }
                }
                const isFrancoLast = FRANCO_CODES_SET.has(lastCode);
                let count = 0;
                let consecutiveMissing = 0;
                for (let d = prevMonthEndDate.getDate(); d >= 1; d--) {
                    const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                    const c = empShifts[ds];
                    if (!c) {
                        // Día sin datos: probable RET en otro objetivo — puente de hasta 1 día consecutivo
                        consecutiveMissing++;
                        if (consecutiveMissing > 1) break;
                        count++;
                        continue;
                    }
                    consecutiveMissing = 0;
                    const isFranco = FRANCO_CODES_SET.has(c);
                    if (isFrancoLast && isFranco) { count++; }
                    else if (!isFrancoLast && !isFranco) { count++; }
                    else break;
                }
                if (isFrancoLast) prevMonthTrailingRestDays[emp.id] = count;
                else prevMonthTrailingWorkDays[emp.id] = count;
            });

            const client = clients.find((c:any) => c.objetivos?.some((o:any) => (o.id || o.name) === selectedObjective));
            const objMeta: any = client?.objetivos?.find((o:any) => (o.id || o.name) === selectedObjective);
            const defaultPositionByEmp: Record<string,string> = {};
            const defaultShiftByEmp: Record<string,string> = {};
            const plannerGridPositionByEmp: Record<string, string> = {};
            displayedEmployees.forEach((e:any) => {
                const pos = empDefaultPos[`${e.id}___${selectedObjective}`];
                if (pos) {
                    defaultPositionByEmp[e.id] = pos;
                    plannerGridPositionByEmp[e.id] = pos;
                }
                const shift = empDefaultShift[`${e.id}___${selectedObjective}`];
                if (shift) defaultShiftByEmp[e.id] = shift;
            });

            const rosterIdsForSeed = new Set(displayedEmployees.map((e: any) => e.id));
            const prevMonthCal = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
            if (empresaId && selectedObjective && rosterIdsForSeed.size > 0) {
                try {
                    const prevMonthCells = await fetchPlanningMonthShifts({
                        empresaId,
                        objectiveId: selectedObjective,
                        year: prevMonthCal.getFullYear(),
                        month: prevMonthCal.getMonth() + 1,
                        scopeEmpresa,
                        migracionCompleta,
                        publishedOnly: true,
                    });
                    const prevDom = dominantDotacionFromPlanningCells(
                        prevMonthCells,
                        selectedObjective,
                        rosterIdsForSeed,
                    );
                    let posFromPrev = 0;
                    let bandFromPrev = 0;
                    for (const [empId, pos] of Object.entries(prevDom.positionByEmp)) {
                        if (!defaultPositionByEmp[empId]) {
                            defaultPositionByEmp[empId] = pos;
                            posFromPrev++;
                        }
                    }
                    for (const [empId, band] of Object.entries(prevDom.shiftByEmp)) {
                        if (!defaultShiftByEmp[empId]) {
                            defaultShiftByEmp[empId] = band;
                            bandFromPrev++;
                        }
                    }
                    if (posFromPrev > 0 || bandFromPrev > 0) {
                        const prevLabel = `${String(prevMonthCal.getMonth() + 1).padStart(2, '0')}/${prevMonthCal.getFullYear()}`;
                        toast.info(
                            `Dotación base desde crono publicado ${prevLabel}: ${posFromPrev} puesto(s), ${bandFromPrev} banda(s).`,
                            { duration: 7000 },
                        );
                    }
                } catch (seedErr) {
                    console.warn('[auto] seed dotacion mes anterior', seedErr);
                }
            }

            applySlaContractDotacion({
                positionAssignments: activeSlaPositionAssignments ?? undefined,
                defaultPositionByEmp,
                defaultShiftByEmp,
            });
            const slaRotationByDate = buildSlaRotationByDate(
                activeSlaServiceRotations,
                daysInMonth.map((d) => getDateKey(d)),
                positionStructure,
            );
            const v2PosGen = positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[];
            const cronogramRules = resolveCronogramPlanningRules(v2PosGen);
            // Flotantes de empresa: empleados activos sin objetivo asignado.
            // El motor V3 los usa como refuerzo (Fase 3) cuando quedan slots sin cubrir
            // tras los regulares y los FLEX del objetivo en curso.
            const displayedIds = new Set(displayedEmployees.map((e: any) => e.id));
            const globalRetPool = employees
                .filter((e: any) =>
                    e.status !== 'inactivo' &&
                    !displayedIds.has(e.id) &&
                    (!e.preferredObjectiveId || e.preferredObjectiveId === '')
                )
                .map((e: any) => ({ id: e.id, nombre: e.nombre || e.name }));

            const objectiveScheduleFlags = resolveObjectiveScheduleFlags(positionStructure);

            const genBrain = autoPlanningBrainRef.current ?? resolveAutoPlanningBrain({
                positions: positionStructure,
                employees: planningDotacionEmployees.map((e:any) => ({
                    id: e.id,
                    nombre: e.nombre || e.name,
                    lat: typeof e.lat === 'number' ? e.lat : null,
                    lng: typeof e.lng === 'number' ? e.lng : null,
                    preferredObjectiveId: e.preferredObjectiveId,
                })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                getDayLetter,
                getDateKey,
                contingencyDaysManual: [...autoContingenciaDias].filter(d => !autoModo12AbsDays.has(d)),
                rotateShiftsOverride: autoRotateForce ?? (cronogramRules.generation.allowGlobalRotateShifts ? undefined : false),
                ajustarCronoOverride: autoAjustarCrono,
                cycleOverride: buildObjectiveScheduleProfile(v2PosGen).cyclePreference[0] ?? '6+2',
                headcountByPax: objectiveScheduleFlags.headcountByPax,
            });
            for (const padEmp of genBrain.dotacionPadding?.added ?? []) {
                empMonthlyInitial[padEmp.id] = 0;
                if (!absences[padEmp.id]) absences[padEmp.id] = new Map();
            }
            autoPlanningBrainRef.current = genBrain;
            setAutoPlanningBrainReport(genBrain);
            if (!genBrain.contingencyOk) {
                toast.error(genBrain.contingencyMessages[0] || 'Contingencia no viable');
                setAutoV2Generating(false);
                setAutoV2Progress(null);
                return;
            }

            // Si el mes anterior fue generado en esta sesión (no publicado), usar sus slots para continuar el ciclo.
            const prevMonthGenKey = lastGenOpeningRef.current;
            const isPrevMonthGen = prevMonthGenKey !== null
                && prevMonthGenKey.objectiveId === selectedObjective
                && prevMonthGenKey.year === prevMonthEndDate.getFullYear()
                && prevMonthGenKey.month === prevMonthEndDate.getMonth();

            const serviceExcludedDates = [...new Set(
                (positionStructure as any[]).flatMap((p: any) => p.excludedDates || []),
            )] as string[];

            const baseGenCtx = {
                positions: positionStructure,
                employees: (genBrain.effectiveEmployees?.length
                    ? genBrain.effectiveEmployees
                    : planningDotacionEmployees.map((e:any) => ({
                        id: e.id,
                        nombre: e.nombre || e.name,
                        lat: typeof e.lat === 'number' ? e.lat : null,
                        lng: typeof e.lng === 'number' ? e.lng : null,
                        preferredObjectiveId: e.preferredObjectiveId ?? selectedObjective,
                    }))),
                daysInMonth,
                calendarDaysInMonth: daysInMonth,
                serviceExcludedDates,
                empMonthlyInitial,
                absences,
                slaVendidas,
                autoCycles: cyclesForGen,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                defaultPositionByEmp,
                defaultShiftByEmp,
                getDayLetter,
                getDateKey,
                rotateShifts: genBrain.rotateShifts,
                codeHoursHint: slaCodeHoursHint,
                ajustarCrono: genBrain.ajustarCrono,
                modo12Days: genBrain.modo12DaysEngine,
                contingencyApretarDays: genBrain.contingencyOk ? genBrain.contingencyDaysManual : [],
                apretarCronoDays: genBrain.modo12DaysEngine,
                prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays,
                prevMonthLastShiftByEmp,
                prevMonthLastWorkBandBeforeRest,
                prevMonthOpeningSlotByEmp: isPrevMonthGen ? prevMonthGenKey!.openingSlotByEmp : undefined,
                prevMonthDaysCount: isPrevMonthGen ? prevMonthGenKey!.daysCount : undefined,
                globalRetPool,
                strictSixTwo: genBrain.strictSixTwo,
                noFlexSchemeEmployees: true,
                authorizedOver200Ids: authorizedOver200IdsRef.current.size > 0 ? authorizedOver200IdsRef.current : undefined,
                cctMaxBillableHours: planningRules.cctMaxBillableHours,
                targetAvgHoursPerEmployee: planningRules.targetAvgHoursPerEmployee,
                headcountByPax: objectiveScheduleFlags.headcountByPax,
                schedulePhasedRotativeFirst: objectiveScheduleFlags.schedulePhasedRotativeFirst,
                preserveRotativeIntegrity: objectiveScheduleFlags.preserveRotativeIntegrity,
                allowCustom24hsBackup: objectiveScheduleFlags.allowCustom24hsBackup,
                cronogramRules,
                coverageWisdom,
                plannerGridPositionByEmp,
                positionAssignmentsByEmp: buildPositionAssignmentsByEmp(activeSlaPositionAssignments),
                serviceRules: activeSlaServiceRules ?? undefined,
                serviceRotations: activeSlaServiceRotations ?? undefined,
                ...(slaRotationByDate ? { slaRotationByDate } : {}),
            } as import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext;

            const genRoutePreview = resolvePlanningGenerationRoute(baseGenCtx, {
                strictSixTwo: genBrain.strictSixTwo === true,
                preferSixPlusOne: useSixPlusOne,
            });
            await bumpAutoV2Progress(40, `Generando cronograma (motor v${PLANNING_ENGINE_VERSION} · ${genRoutePreview.labelEs})…`);
            await new Promise<void>((r) => setTimeout(r, 0));

            let gen: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateResult;
            let genCtx: typeof baseGenCtx;
            try {
                const runGen = runPlanningGeneration(baseGenCtx, {
                    strictSixTwo: genBrain.strictSixTwo === true,
                    preferSixPlusOne: useSixPlusOne,
                });
                gen = runGen.generation;
                genCtx = runGen.genCtx;
                if (runGen.prepareWarnings.length > 0) {
                    toast.message(runGen.prepareWarnings.join(' '), { duration: 8000 });
                }
            } catch (planErr) {
                await bumpAutoV2Progress(100, 'Error al generar');
                toast.error(planErr instanceof Error ? planErr.message : 'Error al generar cronograma', { duration: 12000 });
                setAutoWizardStep('sla_open');
                setAutoV2Running(false);
                return;
            }

            const useFloaterPipeline = genRoutePreview.postProcessPipeline === 'fixedBandFloater';

            // Guardar slots de apertura para que el siguiente mes pueda continuar el ciclo exactamente.
            if (gen.stats.openingSlotByEmp) {
                lastGenOpeningRef.current = {
                    year: currentDate.getFullYear(),
                    month: currentDate.getMonth(),
                    objectiveId: selectedObjective,
                    openingSlotByEmp: gen.stats.openingSlotByEmp,
                    daysCount: daysInMonth.length,
                };
            }
            // Diagnóstico de racha: trailing mes anterior + apertura mes generado por colaborador.
            {
                const _db = (s: number) => { const n=((s%24)+24)%24; if(n<=5)return'M'; if(n<=7)return'F'; if(n<=13)return'T'; if(n<=15)return'F'; if(n<=21)return'N'; return'F'; };
                const _dtf = (s: number) => { for(let d=0;d<24;d++){if(_db(s+d)==='F')return d;} return 0; };
                setAutoV2TrailDiag(displayedEmployees.map((emp: any) => {
                    const slot = gen.stats.openingSlotByEmp?.[emp.id];
                    const posName = defaultPositionByEmp[emp.id] ?? '—';
                    const posData = (positionStructure as any[]).find((p: any) => p.positionName === posName);
                    return {
                        id: emp.id,
                        nombre: (emp.nombre || emp.name || '').slice(0, 24),
                        puesto: posName,
                        puestoQty: Math.max(1, Number(posData?.qty) || 1),
                        lastBand: prevMonthLastShiftByEmp[emp.id] ?? '—',
                        trailWork: prevMonthTrailingWorkDays[emp.id] ?? 0,
                        trailRest: prevMonthTrailingRestDays[emp.id] ?? 0,
                        julioSlot: slot,
                        julioBand: slot !== undefined ? _db(slot) : undefined,
                        diasFranco: slot !== undefined ? _dtf(slot) : undefined,
                    };
                }));
            }

            // Análisis de cobertura de ausencias pre-declaradas (V/L/E/A/PG)
            // Siempre se analiza cuando el pipeline floater está disponible (para detectar francos
            // naturales incluidos en licencias y candidatos FT). La asignación solo modifica
            // el schedule si autoCoverAbsences está activo.
            let finalGenAssignments = gen.assignments;
            if (useFloaterPipeline && gen.stats.openingSlotByEmp) {
                await bumpAutoV2Progress(50, 'Analizando cobertura de ausencias…');
                const covResult = applyAbsenceCoverage(
                    gen.assignments,
                    genCtx,
                    gen.stats.openingSlotByEmp,
                );

                // Enriquecer gaps con nombres (los ftCandidates ya vienen del motor)
                const empNameMap: Record<string, string> = {};
                planningDotacionEmployees.forEach((e: any) => { empNameMap[e.id] = e.nombre || e.name || e.id; });

                const enrichedGaps = covResult.gaps.map(g => ({
                    ...g,
                    absentName: empNameMap[g.absentEmpId] || g.absentEmpId,
                    coveredByName: g.coveredBy ? (empNameMap[g.coveredBy] || g.coveredBy) : undefined,
                    ftCandidates: g.ftCandidates?.map(c => ({
                        ...c,
                        nombre: empNameMap[c.empId] || c.empId,
                    })),
                }));

                setAutoCoverageGaps(enrichedGaps);

                if (autoCoverAbsences) {
                    finalGenAssignments = covResult.assignments;
                    if (covResult.gaps.length > 0) {
                        const stCount  = covResult.gaps.filter(g => g.coverageType === 'sin_turno').length;
                        const retCount = covResult.gaps.filter(g => g.coverageType === 'ret').length;
                        const escCount = covResult.gaps.filter(g => g.coverageType === 'esc').length;
                        const msgs: string[] = [];
                        if (stCount > 0)  msgs.push(`${stCount} ST`);
                        if (retCount > 0) msgs.push(`${retCount} RET`);
                        if (escCount > 0) msgs.push(`${escCount} ESC`);
                        if (covResult.ftRequiredCount > 0) msgs.push(`${covResult.ftRequiredCount} requieren FT manual`);
                        if (msgs.length > 0) toast.success(`Cobertura automática: ${msgs.join(' · ')}`, { duration: 6000 });
                    }
                }
            } else {
                setAutoCoverageGaps([]);
            }

            finalGenAssignments = applyServiceExcludedDays(finalGenAssignments, genCtx);

            await bumpAutoV2Progress(58, 'Verificando cobertura…');
            // Volcamos a pendingChanges tras verificar; si SLA abierto = vista previa diagnóstica.
            const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
            let written = 0;
            let skipped = 0;
            for (const a of finalGenAssignments) {
                const primaryKey = `${a.empId}_${a.dateStr}`;
                const key = a.isSecondBlock ? `${primaryKey}_B2` : primaryKey;
                // No se bloquean días pasados en auto-generación: el borrador planifica el mes completo.
                // isDateLocked aplica solo a edición manual, no al motor automático.
                // Para bloques secundarios, verificar también si el primario fue omitido.
                if (!autoOverwrite && (pendingChanges[primaryKey] || shiftsMap[primaryKey])) { skipped++; continue; }
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
                    ...(a.shiftGroupId ? { shiftGroupId: a.shiftGroupId } : {}),
                    ...(a.isSecondBlock ? { isSecondBlock: true } : {}),
                };
                if (!a.isSecondBlock) written++;
            }

            // Si hay slots que solo podrían cubrirse superando las 200h → guardar para panel de autorización
            if (gen.capOverflowSlots.length > 0) {
                const overSlots = gen.capOverflowSlots;
                const seenIds = new Set<string>();
                const overEmps: { empId: string; nombre: string }[] = [];
                for (const s of overSlots) {
                    if (seenIds.has(s.empId)) continue;
                    seenIds.add(s.empId);
                    const emp = displayedEmployees.find((e: any) => e.id === s.empId);
                    overEmps.push({ empId: s.empId, nombre: emp?.nombre || emp?.name || s.empId });
                }
                setCapOverflowEmps(overEmps);
                // Pre-marcar todos como chequeados
                const checked: Record<string, boolean> = {};
                overEmps.forEach(e => { checked[e.empId] = true; });
                setOver200AuthChecked(checked);
                setOver200AuthPin('');
                setOver200AuthError('');
            }
            // Guardamos las stats post-generación para el panel "Capacidad CCT" (tras verify si pipeline ciclo)
            await bumpAutoV2Progress(78, 'Verificando cobertura y reglas (descansos, licencias)…');
            // ── Verificación de cobertura (slots, descansos, licencias, >200h) ──
            const verifyCtx = {
                positions: positionStructure,
                employees: planningDotacionEmployees.map((e:any) => ({ id: e.id, nombre: e.nombre || e.name })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                autoCycles: cyclesForGen,
                getDayLetter,
                getDateKey,
                prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays,
                prevMonthLastShiftByEmp,
                cctMaxBillableHours: planningRules.cctMaxBillableHours,
                targetAvgHoursPerEmployee: planningRules.targetAvgHoursPerEmployee,
                objectiveId: selectedObjective,
                coverageWisdom,
            } as any;
            let finalAssignments = gen.assignments;
            const strictPipeline: { verification?: CoverageVerificationReport } | undefined = undefined;
            let coverage = strictPipeline?.verification
                ?? verifyScheduleCoverage(verifyCtx, finalAssignments, gen.stats);

            setAutoV2GenStats({
                employeeMonthlyHours: gen.stats.employeeMonthlyHours,
                employeeCycleHours: gen.stats.employeeCycleHours,
                targetHours: gen.stats.targetHours,
                totalBillableHours: useFloaterPipeline
                    ? (coverage.hours?.billableHoursGenerated ?? gen.stats.totalBillableHours)
                    : gen.stats.totalBillableHours,
                uncoveredSlots: useFloaterPipeline
                    ? coverage.coverage.uncoveredSlots
                    : (gen.stats.uncoveredSlots ?? 0),
                idleEmployeeIds: gen.stats.idleEmployeeIds,
                strandedEmployeeIds: gen.stats.strandedEmployeeIds,
                relocatedEmployeeIds: gen.stats.relocatedEmployeeIds,
                primaryShiftByEmp: gen.stats.primaryShiftByEmp,
                positionGroups: gen.stats.positionGroups,
                employeeRetCount: gen.stats.employeeRetCount,
                employeeRetHoursPotential: gen.stats.employeeRetHoursPotential,
                totalRetCount: gen.stats.totalRetCount,
                totalRetHoursPotential: gen.stats.totalRetHoursPotential,
                overCoverageRetDays: gen.stats.overCoverageRetDays,
                maxRetConcurrent: gen.stats.maxRetConcurrent,
                ajustarCrono: gen.stats.ajustarCrono,
                apretarCronoDays: gen.stats.apretarCronoDays,
                uncoveredSlotsByDay: gen.stats.uncoveredSlotsByDay,
                excessPositionEmployees: gen.stats.excessPositionEmployees,
                slaDeficitRemaining: useFloaterPipeline
                    ? Math.max(0, Math.round((slaVendidas - (coverage.hours?.billableHoursGenerated ?? 0)) * 10) / 10)
                    : gen.stats.slaDeficitRemaining,
                slaHoursClosed: useFloaterPipeline
                    ? coverage.coverage.uncoveredSlots <= 0
                        && (slaVendidas <= 0 || (coverage.hours?.billableHoursGenerated ?? 0) >= slaVendidas - 0.5)
                    : gen.stats.slaHoursClosed,
            });

            // ── Auto-reproceso: solo en flujo legacy (demanda + parches). Etapa A+B: verify puro. ──
            const NON_BILLABLE_FIX = new Set(['RET', 'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'PG', 'AA']);
            const countIssues = (r: typeof coverage) =>
                r.coverage.uncoveredSlots + r.restViolations.length + r.licenseConflicts.length;

            let prevIssues = countIssues(coverage);
            const MAX_REPRO_PASSES = !useFloaterPipeline && coverage.coverage.uncoveredSlots > 0 ? 5 : 0;
            for (let pass = 0; pass < MAX_REPRO_PASSES && prevIssues > 0; pass++) {
                await bumpAutoV2Progress(
                    Math.min(97, 88 + pass * 2),
                    `Reprocesando (${pass + 1}/${MAX_REPRO_PASSES})…`,
                );
                await new Promise<void>((r) => setTimeout(r, 0));

                const fixResult = fixScheduleIssues(verifyCtx, finalAssignments, gen.stats, coverage, 5);
                finalAssignments = fixResult.assignments;
                coverage = fixResult.report;

                for (const a of fixResult.assignments) {
                    const primaryKey = `${a.empId}_${a.dateStr}`;
                    const key = a.isSecondBlock ? `${primaryKey}_B2` : primaryKey;
                    const existing = newChanges[key];
                    if (existing && !existing.isDeleted
                        && !NON_BILLABLE_FIX.has(String(existing.code || '').toUpperCase())
                        && NON_BILLABLE_FIX.has(String(a.code || '').toUpperCase())) continue;
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
                        ...(a.shiftGroupId ? { shiftGroupId: a.shiftGroupId } : {}),
                        ...(a.isSecondBlock ? { isSecondBlock: true } : {}),
                    };
                }
                // No volcar a grilla hasta confirmar SLA cerrado (ver más abajo).

                const newIssues = countIssues(coverage);
                if (newIssues >= prevIssues) break; // sin progreso: detener
                prevIssues = newIssues;
            }

            setAutoV2Coverage(coverage);
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(verifyCtx, finalAssignments, gen.stats));
            setAutoV2LastRun({ assignments: finalAssignments, stats: gen.stats, ctx: verifyCtx });

            let finalChanges = newChanges;
            if (!useFloaterPipeline) {
                const geminiOut = await runAutoV2PlanningAgentGemini(
                    finalAssignments,
                    coverage,
                    verifyCtx,
                    gen.stats,
                    newChanges,
                    false,
                    true,
                );
                finalAssignments = geminiOut.assignments;
                coverage = geminiOut.coverage;
                finalChanges = { ...geminiOut.changes };
            }

            let formReport = verifyScheduleForm(verifyCtx, finalAssignments, gen.stats, {
                strictSixTwo: genBrain.strictSixTwo,
                rotateShifts: genBrain.rotateShifts,
            });
            setAutoV2RebalanceLog([]);

            const verifiedBillable = coverage.hours?.billableHoursGenerated ?? gen.stats.totalBillableHours;
            const verifiedUncovered = coverage.coverage.uncoveredSlots;
            const policyBalanceForClosure = analyzeCoveragePolicyBalance(verifyCtx, finalAssignments, {
                inferModo12TCoverage: true,
            });
            const scheduleClosureGate = evaluateScheduleClosure(coverage, policyBalanceForClosure);
            const hrsDeficit = slaVendidas > 0
                ? Math.max(0, Math.round((slaVendidas - verifiedBillable) * 10) / 10)
                : 0;
            const slaClosed = scheduleClosureGate.ok;

            let statsAfterForm = gen.stats;
            const hourFormIssues = formReport.metrics.hoursSpread > 24
                || formReport.metrics.over192Count > 0
                || formReport.metrics.over200Count > 0
                || formReport.metrics.under168Count > 0;
            if (!useFloaterPipeline && slaClosed && hourFormIssues) {
                await bumpAutoV2Progress(94, 'Rebalanceando forma (swaps horas)…');
                await new Promise<void>((r) => setTimeout(r, 0));
                const reb = rebalanceScheduleForm(verifyCtx, finalAssignments, statsAfterForm, coverage, {
                    strictSixTwo: genBrain.strictSixTwo,
                    rotateShifts: genBrain.rotateShifts,
                });
                if (reb.improved && reb.swapsApplied > 0) {
                    finalAssignments = reb.assignments;
                    coverage = reb.coverageReport;
                    formReport = reb.formReport;
                    statsAfterForm = reb.stats;
                    setAutoV2RebalanceLog(reb.log);
                    const touched = new Set<string>();
                    for (const entry of reb.log) {
                        touched.add(`${entry.fromEmpId}__${entry.dateStr}`);
                        touched.add(`${entry.toEmpId}__${entry.dateStr}`);
                    }
                    for (const touchKey of touched) {
                        const sep = touchKey.indexOf('__');
                        const empId = touchKey.slice(0, sep);
                        const dateStr = touchKey.slice(sep + 2);
                        const a = finalAssignments.find(x => x.empId === empId && x.dateStr === dateStr);
                        if (!a) continue;
                        finalChanges[`${empId}_${dateStr}`] = {
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
                    setAutoV2GenStats((prev) => prev ? {
                        ...prev,
                        employeeMonthlyHours: reb.stats.employeeMonthlyHours,
                    } : prev);
                }
            }
            setAutoV2FormReport(formReport);

            const verifiedBillableFinal = coverage.hours?.billableHoursGenerated ?? statsAfterForm.totalBillableHours;
            const verifiedUncoveredFinal = coverage.coverage.uncoveredSlots;

            let gridBillableHours = 0;
            displayedEmployees.forEach((emp: any) => {
                daysInMonth.forEach((day) => {
                    const key = `${emp.id}_${getDateKey(day)}`;
                    const pending = finalChanges[key];
                    const existing = shiftsMap[key];
                    const activeShift = pending && !pending.isDeleted ? pending : existing;
                    if (!activeShift || activeShift.isDeleted) return;
                    if (pending && !pending.isDeleted) {
                        if (selectedObjective && activeShift.objectiveId != null && activeShift.objectiveId !== ''
                            && String(activeShift.objectiveId) !== String(selectedObjective)) return;
                    } else if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
                    if (PLANNING_NON_BILLABLE_CODES.has(String(activeShift.code || '').toUpperCase())) return;
                    gridBillableHours += calcShiftHours(activeShift, slaCodeHoursHint);
                });
            });

            setAutoV2GenStats((prev) => prev ? {
                ...prev,
                totalBillableHours: verifiedBillableFinal,
                gridBillableHours,
                cellsSkippedOverwrite: skipped,
                uncoveredSlots: verifiedUncoveredFinal,
                slaDeficitRemaining: hrsDeficit,
                slaHoursClosed: slaClosed,
            } : prev);
            setAutoV2Coverage(coverage);
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(verifyCtx, finalAssignments, statsAfterForm));
            setAutoV2LastRun({ assignments: finalAssignments, stats: statsAfterForm, ctx: verifyCtx });

            // Vista previa en grilla siempre (aunque el SLA quede abierto) para poder diagnosticar.
            setPendingChanges(finalChanges);
            setAutoGeneratedReady(true);

            await bumpAutoV2Progress(100, slaClosed ? 'Listo' : 'SLA sin cerrar — vista previa');
            await new Promise<void>((r) => setTimeout(r, 180));

            if (empresaId && selectedObjective && positionStructure.length > 0) {
                const prevMonthCal = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
                const compareDays = daysInMonth.map((day) => {
                    const dateStr = getDateKey(day);
                    return { dateStr, dayLetter: getDayLetter(dateStr) };
                });
                try {
                    const prevPublished = await fetchPlanningMonthShifts({
                        empresaId,
                        objectiveId: selectedObjective,
                        year: prevMonthCal.getFullYear(),
                        month: prevMonthCal.getMonth() + 1,
                        scopeEmpresa,
                        migracionCompleta,
                        publishedOnly: true,
                    });
                    if (prevPublished.length > 0) {
                        const generatedCells = finalAssignments
                            .filter((a) => (a.hours ?? 0) > 0 && a.positionName && a.code)
                            .map((a) => ({
                                id: `${a.empId}_${a.dateStr}`,
                                employeeId: a.empId,
                                objectiveId: selectedObjective,
                                dateStr: a.dateStr,
                                code: String(a.code || '').toUpperCase(),
                                positionName: a.positionName,
                            }));
                        const monthCmp = compareObjectiveMonthSchedules(
                            {
                                objectiveId: selectedObjective,
                                positions: positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[],
                                days: compareDays,
                                cells: prevPublished,
                                cycles: cyclesForGen,
                            },
                            {
                                objectiveId: selectedObjective,
                                positions: positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[],
                                days: compareDays,
                                cells: generatedCells,
                                cycles: cyclesForGen,
                            },
                        );
                        const prevLabel = `${String(prevMonthCal.getMonth() + 1).padStart(2, '0')}/${prevMonthCal.getFullYear()}`;
                        const gapDays = monthCmp.daysWithGapsInCompareOnly.length;
                        if (gapDays > 0) {
                            toast.warning(
                                `vs crono publicado ${prevLabel}: ${gapDays} día(s) con huecos · referencia ${monthCmp.reference.daysFull} día(s) OK`,
                                { duration: 11000 },
                            );
                        }
                        if (monthCmp.compare.nomenclatureViolations.length > 0) {
                            toast.warning(
                                `${monthCmp.compare.nomenclatureViolations.length} celda(s) con código no habilitado para el puesto (SLA)`,
                                { duration: 9000 },
                            );
                        }
                        console.info(
                            '[auto] compare vs mes anterior publicado',
                            formatCompareObjectiveMonthsReport(monthCmp, {
                                reference: `Publicado ${prevLabel}`,
                                compare: 'Generado',
                            }),
                        );
                    }
                } catch (cmpErr) {
                    console.warn('[auto] compareObjectiveMonthSchedules', cmpErr);
                }
            }

            const gridGap = Math.abs(verifiedBillableFinal - gridBillableHours);

            if (!slaClosed) {
                const parts: string[] = scheduleClosureGate.messages.length > 0
                    ? scheduleClosureGate.messages
                    : [];
                if (parts.length === 0) {
                    if (hrsDeficit > 0.5) parts.push(`${Math.round(hrsDeficit)}h faltantes`);
                    if (verifiedUncovered > 0) parts.push(`${verifiedUncovered} slots sin cubrir`);
                }
                toast.warning(
                    `Vista previa en grilla: SLA abierto (${parts.join(' · ')}). Revisá la grilla detrás del modal; no publiques hasta cerrar.`,
                    { duration: 12000 },
                );
                setAutoWizardStep('sla_open');
                return;
            }

            if (written === 0 && skipped > 0) {
                toast.error(
                    `No se generó nada: las ${skipped} celdas calculadas ya estaban ocupadas. ` +
                    `Activá "Sobreescribir" en Personalizar y ejecutá de nuevo.`,
                    { duration: 8000 }
                );
            } else if (written === 0) {
                toast.error('No se generó el cronograma. Revisá ciclos, ausencias y dotación.', { duration: 6000 });
            } else if (!autoOverwrite && skipped > 0) {
                toast.warning(
                    `Solo se volcaron ${written} celdas; ${skipped} quedaron con datos viejos. ` +
                    `La grilla muestra ~${Math.round(gridBillableHours)}h, no ${Math.round(verifiedBillableFinal)}h. Activá Sobreescribir.`,
                    { duration: 10000 },
                );
                setAutoWizardStep('done');
            } else if (gridGap > 16) {
                toast.warning(
                    `El cronograma calculó ${Math.round(verifiedBillableFinal)}h pero la grilla refleja ~${Math.round(gridBillableHours)}h. Revisá celdas mezcladas o guardá tras corregir.`,
                    { duration: 9000 },
                );
                setAutoWizardStep('done');
            } else if (slaVendidas > 0 && hrsDeficit <= 0.5 && verifiedUncoveredFinal <= 0) {
                toast.success(`Cronograma cerrado: ${Math.round(verifiedBillableFinal)}h = ${slaVendidas}h vendidas.`, { duration: 5000 });
                setAutoWizardStep('done');
            } else {
                setAutoWizardStep('done');
            }
        } catch (e:any) {
            toast.error('Error al generar el cronograma automático');
            console.error('[applyAutoScheduleCOSP]', e);
        } finally {
            setAutoV2Generating(false);
            setAutoV2Progress(null);
        }
}
