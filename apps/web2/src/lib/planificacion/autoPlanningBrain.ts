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
    pickOptimalAutoCycles,
    type V2AbsenceMap,
    type V2EngineContext,
    type V2FeasibilityReport,
    type V2PositionDef,
} from './autoScheduleEngineV2';
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
};

/**
 * Punto de entrada del cerebro Auto: esquema, dotación diaria, Modo 12, Contingencia, rotativo.
 */
export function resolveAutoPlanningBrain(input: AutoPlanningBrainInput): AutoPlanningBrainResult {
    const warnings: string[] = [];
    const employeeIds = input.employees.map(e => e.id);
    const monthDateStrs = input.daysInMonth.map(d => input.getDateKey(d));

    const picked = pickOptimalAutoCycles({ ...input, autoCycles: [] });
    const cycleKey = picked.pickedKey;
    const staffing = computeDailyStaffingModel(
        input.positions,
        cycleKey,
        input.slaVendidas,
    );

    const modo12DaysAuto = deriveModo12DaysFromAbsences(
        input.absences,
        employeeIds,
        monthDateStrs,
    );
    const contingencyDaysManual = [...(input.contingencyDaysManual ?? [])].sort();

    const contingency = validateContingencyCoverage({
        staffing,
        contingencyDays: contingencyDaysManual,
        absences: input.absences,
        employeeIds,
        peopleAvailable: input.employees.length,
        modo12DaysAuto,
    });

    const absenceModo12 = validateAbsenceModo12Days({
        staffing,
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
            picked.feasibility.ok,
        );

    const ajustarCrono = input.ajustarCronoOverride === true;

    warnings.push(...contingency.messages);

    return {
        pickedCycle: cycleKey,
        cycles: picked.cycles,
        feasibility: picked.feasibility,
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
    };
}
