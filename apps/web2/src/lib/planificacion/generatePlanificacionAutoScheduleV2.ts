import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { getDateKey, getDayLetter } from '@/lib/planificacion/utils';
import { isPosActiveOnDay } from '@/lib/planificacion/planificacionPositionEngine';
import { turnoCuentaParaCronoPlanificado } from '@/lib/planificacion/planificacionPlanningShiftRules';
import { PLANNING_NON_BILLABLE_CODES } from '@/lib/planificacion/positionCoverageUnits';
import { resolveCronogramPlanningRules } from '@/lib/planificacion/cronogramPlanningRules';
import { buildObjectiveScheduleProfile } from '@/lib/planificacion/objectiveServiceModel';
import {
    resolveAutoPlanningBrain,
    type AutoPlanningBrainResult,
} from '@/lib/planificacion/autoPlanningBrain';
import {
    buildObjectiveCoveragePreflight,
    type ObjectiveCoveragePreflight,
} from '@/lib/planificacion/objectiveCoverageDemand';
import { resolveObjectiveScheduleFlags } from '@/lib/planificacion/scheduleObjectiveFlags';
import type { V2FeasibilityReport, V2PositionDef } from '@/lib/planificacion/autoScheduleEngineV2';
import type { PlanificacionAbsencesByEmp } from '@/lib/planificacion/loadPlanificacionAbsencesForRange';

const SHIFT_HRS_LOCAL: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };

export async function bumpPlanificacionAutoV2Progress(
    setAutoV2Progress: Dispatch<SetStateAction<{ pct: number; label: string } | null>>,
    pct: number,
    label: string,
): Promise<void> {
    setAutoV2Progress({ pct, label });
    await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
    });
}

export type GeneratePlanificacionAutoScheduleV2Params = {
    selectedObjective: string;
    positionStructure: any[];
    planningDotacionEmployees: any[];
    currentDate: Date;
    daysInMonth: Date[];
    clients: any[];
    slaVendidas: number;
    autoV2BudgetMode: string;
    autoContingenciaDias: Set<string>;
    autoRotateForce: boolean | null;
    autoAjustarCrono: boolean;
    loadAbsencesForRange: (monthStart: Date, monthEnd: Date) => Promise<PlanificacionAbsencesByEmp>;
    mergeAbsencesFromLocalGrid: (
        absences: PlanificacionAbsencesByEmp,
        empIds: string[],
        monthStart: Date,
        monthEnd: Date,
    ) => void;
    setAutoV2Loading: (value: boolean) => void;
    setAutoV2Progress: Dispatch<SetStateAction<{ pct: number; label: string } | null>>;
    setAutoAbsencesMap: (value: PlanificacionAbsencesByEmp) => void;
    setAutoContingenciaDias: Dispatch<SetStateAction<Set<string>>>;
    setAutoCycles: (value: string[]) => void;
    setAutoV2CoveragePreflight: (value: ObjectiveCoveragePreflight) => void;
    setAutoV2Report: (value: V2FeasibilityReport | null) => void;
    setAutoPlanningBrainReport: (value: AutoPlanningBrainResult | null) => void;
    autoPlanningBrainInputRef: MutableRefObject<Parameters<typeof resolveAutoPlanningBrain>[0] | null>;
    autoPlanningBrainRef: MutableRefObject<AutoPlanningBrainResult | null>;
    autoSelectedCyclesRef: MutableRefObject<string[]>;
    autoV2ReportRef: MutableRefObject<V2FeasibilityReport | null>;
};

export async function generatePlanificacionAutoScheduleV2({
    selectedObjective,
    positionStructure,
    planningDotacionEmployees,
    currentDate,
    daysInMonth,
    clients,
    slaVendidas,
    autoV2BudgetMode,
    autoContingenciaDias,
    autoRotateForce,
    autoAjustarCrono,
    loadAbsencesForRange,
    mergeAbsencesFromLocalGrid,
    setAutoV2Loading,
    setAutoV2Progress,
    setAutoAbsencesMap,
    setAutoContingenciaDias,
    setAutoCycles,
    setAutoV2CoveragePreflight,
    setAutoV2Report,
    setAutoPlanningBrainReport,
    autoPlanningBrainInputRef,
    autoPlanningBrainRef,
    autoSelectedCyclesRef,
    autoV2ReportRef,
}: GeneratePlanificacionAutoScheduleV2Params): Promise<{ ok: boolean; cycles: string[] }> {
    if (!selectedObjective) return { ok: false, cycles: [] };
    if (!positionStructure.length) {
        toast.error('No hay puestos/SLA configurados para este objetivo');
        return { ok: false, cycles: [] };
    }
    if (!planningDotacionEmployees.length) {
        toast.error('No hay empleados activos en la dotación (REF/ESC no cuentan)');
        return { ok: false, cycles: [] };
    }

    setAutoV2Loading(true);
    setAutoV2Progress({ pct: 4, label: 'Iniciando análisis…' });
    try {
        const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);
        await bumpPlanificacionAutoV2Progress(setAutoV2Progress, 12, 'Cargando ausencias y licencias del mes…');
        const absences = await loadAbsencesForRange(monthStart, monthEnd);
        mergeAbsencesFromLocalGrid(
            absences,
            planningDotacionEmployees.map((e: any) => e.id),
            monthStart,
            monthEnd,
        );
        setAutoAbsencesMap(absences);

        const autoModo12AbsDays = new Set<string>();
        for (const map of Object.values(absences)) {
            if (!map) continue;
            map.forEach((code, ds) => {
                if (['V', 'L', 'E'].includes(String(code).toUpperCase())) autoModo12AbsDays.add(ds);
            });
        }
        setAutoContingenciaDias(prev => {
            const next = new Set([...prev].filter(d => !autoModo12AbsDays.has(d)));
            return next.size !== prev.size ? next : prev;
        });

        const empMonthlyInitial: Record<string, number> = {};
        planningDotacionEmployees.forEach((emp: any) => { empMonthlyInitial[emp.id] = 0; });
        const cyclePreStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 26);
        const cyclePreEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
        await bumpPlanificacionAutoV2Progress(setAutoV2Progress, 32, 'Leyendo cola CCT (26 → fin mes anterior)…');
        const prevTailSnap = await getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', selectedObjective),
            where('startTime', '>=', Timestamp.fromDate(cyclePreStart)),
            where('startTime', '<=', Timestamp.fromDate(cyclePreEnd)),
        ));
        prevTailSnap.docs.forEach(d => {
            const data = d.data() as any;
            if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
            const empId = data.employeeId;
            if (!empId) return;
            if (PLANNING_NON_BILLABLE_CODES.has(String(data.code || '').toUpperCase())) return;
            const h = Number(data.hours) || SHIFT_HRS_LOCAL[String(data.code || '').toUpperCase()] || 8;
            empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + h;
        });

        const client = clients.find((c: any) => c.objetivos?.some((o: any) => (o.id || o.name) === selectedObjective));
        const objMeta: any = client?.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective);
        await bumpPlanificacionAutoV2Progress(setAutoV2Progress, 52, 'Cerebro Auto: esquema, dotación y Modo 12…');
        await new Promise<void>((r) => setTimeout(r, 0));
        const v2Pos = positionStructure as V2PositionDef[];
        const autoCronogramRulesFeas = resolveCronogramPlanningRules(v2Pos);
        const autoScheduleProfileFeas = buildObjectiveScheduleProfile(v2Pos);
        const autoCycleOverride = autoScheduleProfileFeas.cyclePreference[0] ?? '6+2';
        const brainInput = {
            positions: positionStructure,
            employees: planningDotacionEmployees.map((e: any) => ({
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
            rotateShiftsOverride: autoRotateForce ?? (autoCronogramRulesFeas.generation.allowGlobalRotateShifts ? undefined : false),
            ajustarCronoOverride: autoAjustarCrono,
            cycleOverride: autoCycleOverride,
            headcountByPax: resolveObjectiveScheduleFlags(v2Pos).headcountByPax,
        };
        autoPlanningBrainInputRef.current = brainInput;
        const brain = resolveAutoPlanningBrain(brainInput);
        autoPlanningBrainRef.current = brain;
        setAutoPlanningBrainReport(brain);

        if (!brain.contingencyOk) {
            brain.contingencyMessages.forEach(msg => toast.error(msg, { duration: 9000 }));
            autoV2ReportRef.current = brain.feasibility;
            setAutoV2Report(brain.feasibility);
            return { ok: false, cycles: brain.cycles };
        }

        autoSelectedCyclesRef.current = brain.cycles;
        setAutoCycles(brain.cycles);

        await bumpPlanificacionAutoV2Progress(setAutoV2Progress, 72, 'Leyendo demanda SLA del objetivo…');
        const preflightDays = daysInMonth.map(day => {
            const dateStr = getDateKey(day);
            return { dateStr, dayLetter: getDayLetter(dateStr) };
        });
        const preflight = buildObjectiveCoveragePreflight({
            positions: positionStructure,
            days: preflightDays,
            employees: planningDotacionEmployees.map((e: any) => ({ id: e.id, nombre: e.nombre, name: e.name })),
            absences,
            slaVendidas,
            cycles: brain.cycles,
            objectiveId: selectedObjective,
            isPosActiveOnDay,
            apretarCronoDays: brain.modo12DaysEngine,
        });
        setAutoV2CoveragePreflight(preflight);

        await bumpPlanificacionAutoV2Progress(
            setAutoV2Progress,
            100,
            `Esquema ${brain.pickedCycle} · ${brain.staffing.servicioDiarioModo8}+${brain.staffing.poolFrancos} · viabilidad`,
        );
        await new Promise<void>((r) => setTimeout(r, 150));
        autoV2ReportRef.current = brain.feasibility;
        setAutoV2Report(brain.feasibility);
        if (brain.pickedCycle === '4+2') {
            toast.warning('Esquema 4+2 (D12/N12): ningún ciclo M/T/N 8h cerró con la dotación actual.', { duration: 8000 });
        }
        brain.warnings.forEach(w => toast.message(w, { duration: 6000 }));
        return { ok: brain.cycles.length > 0, cycles: brain.cycles };
    } catch (e) {
        toast.error('Error al analizar viabilidad');
        console.error('[autoScheduleCOSP]', e);
        return { ok: false, cycles: [] };
    } finally {
        setAutoV2Loading(false);
        setAutoV2Progress(null);
    }
}
