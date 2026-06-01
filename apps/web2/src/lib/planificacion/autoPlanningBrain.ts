/**
 * Cerebro de planificación automática COSP.
 *
 * Capas:
 *  1. Sobre mensual (SLA horas)
 *  2. Día a día: servicio + pool franco + plantilla
 *  3. Modo 8 (M/T/N) vs Modo 12 (D12/N12)
 *  4. Modo 12 auto por ausencias · Contingencia manual (liberar RET)
 *
 * Reglas unificadas: planningCoveragePolicy.ts
 *  · Ausencias V/L/E → Modo 12, plantilla objetivo (no F→turno)
 *  · Contingencia → D12+N12, RET liberables (no F→turno)
 *  · Franco trabajado → solo manual, costo extra
 */

import {
    checkFeasibility,
    pickOptimalAutoCycles,
    type V2AbsenceMap,
    type V2EngineContext,
    type V2FeasibilityReport,
    type V2PositionDef,
} from './autoScheduleEngineV2';
import {
    buildPlanningOperationalDiagnosis,
    type PlanningOperationalDiagnosis,
} from './planningOperationalDiagnosis';
import {
    MODO12_ABSENCE_CODES,
    PLANNING_COVERAGE_RULES,
    validateAbsenceModo12Days,
    validateContingencyCoverage,
    type Modo12DayCheck,
    type PlanningCoverageRule,
    type StaffingSnapshot,
} from './planningCoveragePolicy';

export { MODO12_ABSENCE_CODES as MODO12_AUTO_ABSENCE_CODES, PLANNING_COVERAGE_RULES };
export type { Modo12DayCheck as ContingencyDayCheck, PlanningCoverageRule };
export type { PlanningOperationalDiagnosis, PlanningBalanceKind } from './planningOperationalDiagnosis';

const CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};

export interface DailyStaffingModel extends StaffingSnapshot {
    /** Pico en servicio simultáneo (pax en puesto). */
    picoEnServicio: number;
    /** Plantilla total = ceil(servicioModo8 × factor ciclo). */
    plantillaTotal: number;
    /** Colchón de francos ≈ plantilla − servicioModo8. */
    poolFrancos: number;
    /** Factor (L+F)/L del ciclo. */
    cycleFactor: number;
    /** Horas SLA / estructura del mes. */
    slaHoras: number;
    structuralHoras: number;
}

export interface AutoPlanningBrainResult {
    pickedCycle: string;
    cycles: string[];
    feasibility: V2FeasibilityReport;
    staffing: DailyStaffingModel;
    /** Modo 12 automático por V/L/E. */
    modo12DaysAuto: string[];
    /** Contingencia manual (fechas elegidas por operador). */
    contingencyDaysManual: string[];
    /** Unión para el motor (D12/N12 en crono). */
    modo12DaysEngine: string[];
    absenceModo12Ok: boolean;
    absenceModo12Checks: Modo12DayCheck[];
    absenceModo12Messages: string[];
    contingencyOk: boolean;
    contingencyChecks: Modo12DayCheck[];
    contingencyMessages: string[];
    rotateShifts: boolean;
    ajustarCrono: boolean;
    warnings: string[];
    /** Demanda → oferta → balance → resolución (F1). */
    diagnosis: PlanningOperationalDiagnosis;
    /** Si true: motor sin flex 5+1/6+1 ni F→turno agresivo. */
    strictSixTwo: boolean;
    /** Ciclo alternativo viable que el usuario puede elegir manualmente (ej. '5+1'). */
    recommendedAlternative?: string;
}

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/** Slots de servicio en un día tipo (suma puestos activos 7d). */
export function computeDailyServiceSlots(
    positions: V2PositionDef[],
    mode: '8' | '12',
): { slotsPerDay: number; peakConcurrent: number; structuralMonthHours: number } {
    let slotsPerDay = 0;
    let peakConcurrent = 0;
    let structuralMonthHours = 0;
    const bandsPerPos = mode === '12' ? 2 : 3;
    const shiftH = mode === '12' ? 12 : 8;

    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        if (is24hs(pos)) {
            slotsPerDay += qty * bandsPerPos;
            peakConcurrent += qty;
            structuralMonthHours += qty * bandsPerPos * 30 * shiftH;
        } else {
            const bands = (pos.shifts || []).length || 1;
            slotsPerDay += qty * bands;
            peakConcurrent += qty * bands;
            structuralMonthHours += qty * bands * 30 * shiftH;
        }
    }

    return { slotsPerDay, peakConcurrent, structuralMonthHours };
}

export function computeDailyStaffingModel(
    positions: V2PositionDef[],
    cycleKey: string,
    slaHoras: number,
): DailyStaffingModel {
    const [cL, cF] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const factor = (cL + cF) / cL;
    const modo8 = computeDailyServiceSlots(positions, '8');
    const modo12 = computeDailyServiceSlots(positions, '12');
    const servicioDiarioModo8 = modo8.slotsPerDay;
    const plantillaTotal = Math.max(
        Math.ceil(servicioDiarioModo8 * factor),
        Math.ceil(modo8.peakConcurrent * factor),
    );
    const poolFrancos = Math.max(0, plantillaTotal - servicioDiarioModo8);

    return {
        cycleKey,
        servicioDiarioModo8,
        servicioDiarioModo12: modo12.slotsPerDay,
        picoEnServicio: modo8.peakConcurrent,
        plantillaTotal,
        poolFrancos,
        cycleFactor: factor,
        slaHoras: Math.max(0, slaHoras),
        structuralHoras: modo8.structuralMonthHours,
    };
}

/** Fechas del mes con al menos una ausencia V/L/E en la dotación. */
export function deriveModo12DaysFromAbsences(
    absences: V2AbsenceMap,
    employeeIds: string[],
    monthDateStrs: string[],
): string[] {
    const out = new Set<string>();
    for (const empId of employeeIds) {
        const map = absences[empId];
        if (!map) continue;
        map.forEach((code, dateStr) => {
            if (!monthDateStrs.includes(dateStr)) return;
            if (MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) {
                out.add(dateStr);
            }
        });
    }
    return [...out].sort();
}

/** @deprecated Usar validateContingencyCoverage en planningCoveragePolicy */
export function validateContingencyDays(params: Parameters<typeof validateContingencyCoverage>[0]) {
    return validateContingencyCoverage(params);
}

function resolveRotateShifts(
    positions: V2PositionDef[],
    peopleAvailable: number,
    cycleKey: string,
    feasibilityOk: boolean,
): boolean {
    const has24 = positions.some(is24hs);
    if (!has24 || !feasibilityOk) return false;
    if (cycleKey === '4+2') return false;
    if (peopleAvailable < 4) return false;

    const slotsPerDay = computeDailyServiceSlots(positions, '8').slotsPerDay;
    const plantilla6x2 = Math.ceil(slotsPerDay * ((6 + 2) / 6));
    const all24Qty1 = positions.filter(is24hs).every(p => Math.max(1, Number(p.qty) || 1) === 1);

    // 16 = 12 servicio + 4 franco: bandas fijas + flotante (no péndulo M→T→N).
    if (cycleKey === '6+2' && all24Qty1 && peopleAvailable === plantilla6x2) {
        return false;
    }
    return true;
}

export function mergeModo12DaySets(...sets: string[][]): string[] {
    const u = new Set<string>();
    for (const s of sets) for (const d of s) u.add(d);
    return [...u].sort();
}

export type AutoPlanningBrainInput = Omit<
    V2EngineContext,
    'autoCycles' | 'ajustarCrono' | 'apretarCronoDays' | 'rotateShifts'
> & {
    contingencyDaysManual?: string[];
    /** Override manual (personalizar wizard); si undefined, decide el cerebro. */
    rotateShiftsOverride?: boolean;
    ajustarCronoOverride?: boolean;
    /** Forzar un ciclo específico (ej. '5+1') sin pasar por pickOptimalAutoCycles. */
    cycleOverride?: string;
};

/**
 * Punto de entrada del cerebro Auto: esquema, dotación diaria, Modo 12, Contingencia, rotativo.
 */
export function resolveAutoPlanningBrain(input: AutoPlanningBrainInput): AutoPlanningBrainResult {
    const warnings: string[] = [];
    const employeeIds = input.employees.map(e => e.id);
    const monthDateStrs = input.daysInMonth.map(d => input.getDateKey(d));

    const picked = pickOptimalAutoCycles({ ...input, autoCycles: input.cycleOverride ? [input.cycleOverride] : [] });
    let cycleKey = picked.pickedKey;
    let cycles = picked.cycles;
    let feasibility = picked.feasibility;

    const staffingRef6x2Model = computeDailyStaffingModel(
        input.positions,
        '6+2',
        input.slaVendidas,
    );
    const staffingRef6x2: import('./planningOperationalDiagnosis').PlanningStaffingRef = {
        servicioDiarioModo8: staffingRef6x2Model.servicioDiarioModo8,
        structuralHoras: staffingRef6x2Model.structuralHoras,
        cycleKey: '6+2',
    };

    const staffingPrelim = computeDailyStaffingModel(
        input.positions,
        cycleKey,
        input.slaVendidas,
    );

    // Excluir empleados con ausencia estructural (todo el mes) del cálculo de días Modo12.
    // Un empleado en EN/V/L todo el mes no "crea" un hueco inesperado: la dotación base
    // ya fue planificada sin ellos. Solo ausencias PARCIALES (imprevistos) activan D12/N12.
    const [cycLmap, cycFmap] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const maxExpectedWork = Math.ceil((cycLmap / (cycLmap + cycFmap)) * monthDateStrs.length);
    const modo12EmpIds = employeeIds.filter(id => {
        const map = input.absences[id];
        if (!map) return true;
        let absCount = 0;
        map.forEach((code, dateStr) => {
            if (monthDateStrs.includes(dateStr) && MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) absCount++;
        });
        return absCount <= maxExpectedWork;
    });
    const modo12DaysAuto = deriveModo12DaysFromAbsences(
        input.absences,
        modo12EmpIds,
        monthDateStrs,
    );
    const contingencyDaysManual = [...(input.contingencyDaysManual ?? [])].sort();

    const contingency = validateContingencyCoverage({
        staffing: staffingPrelim,
        contingencyDays: contingencyDaysManual,
        absences: input.absences,
        employeeIds,
        peopleAvailable: input.employees.length,
        modo12DaysAuto,
    });

    const absenceModo12 = validateAbsenceModo12Days({
        staffing: staffingPrelim,
        modo12DaysAuto,
        absences: input.absences,
        employeeIds,
        peopleAvailable: input.employees.length,
    });

    warnings.push(...absenceModo12.messages);

    const modo12DaysEngine = mergeModo12DaySets(modo12DaysAuto, contingency.ok ? contingencyDaysManual : []);

    const rotateShifts = input.rotateShiftsOverride !== undefined
        ? input.rotateShiftsOverride
        : resolveRotateShifts(
            input.positions,
            input.employees.length,
            cycleKey,
            feasibility.ok,
        );

    const ajustarCrono = input.ajustarCronoOverride === true;

    warnings.push(...contingency.messages);

    let diagnosis = buildPlanningOperationalDiagnosis({
        positions: input.positions,
        feasibility,
        staffing: staffingRef6x2,
        peopleAvailable: input.employees.length,
        soldHours: input.slaVendidas,
        modo12DayCount: modo12DaysAuto.length,
        pickedCycle: cycleKey,
    });

    if (diagnosis.strictSixTwo && !ajustarCrono) {
        const feas62 = checkFeasibility({ ...input, autoCycles: ['6+2'] });
        if (feas62.ok) {
            cycleKey = '6+2';
            cycles = ['6+2'];
            feasibility = feas62;
            diagnosis = buildPlanningOperationalDiagnosis({
                positions: input.positions,
                feasibility: feas62,
                staffing: staffingRef6x2,
                peopleAvailable: input.employees.length,
                soldHours: input.slaVendidas,
                modo12DayCount: modo12DaysAuto.length,
                pickedCycle: '6+2',
            });
            warnings.push('Balance JUSTO: 6+2 estricto con bandas fijas + flotante (rotativo OFF).');
        }
    }

    const staffing = computeDailyStaffingModel(
        input.positions,
        cycleKey,
        input.slaVendidas,
    );

    return {
        pickedCycle: cycleKey,
        cycles,
        feasibility,
        staffing,
        modo12DaysAuto,
        contingencyDaysManual,
        modo12DaysEngine,
        absenceModo12Ok: absenceModo12.ok,
        absenceModo12Checks: absenceModo12.checks,
        absenceModo12Messages: absenceModo12.messages,
        contingencyOk: contingency.ok,
        contingencyChecks: contingency.checks,
        contingencyMessages: contingency.messages,
        rotateShifts,
        ajustarCrono,
        warnings,
        diagnosis,
        strictSixTwo: diagnosis.strictSixTwo && !ajustarCrono,
        recommendedAlternative: picked.recommendedAlternative,
    };
}
