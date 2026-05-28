/**
 * Cerebro de planificación automática COSP.
 *
 * Capas:
 *  1. Sobre mensual (SLA horas)
 *  2. Día a día: servicio + pool franco + plantilla
 *  3. Modo 8 (M/T/N) vs Modo 12 (D12/N12)
 *  4. Modo 12 auto por ausencias · Contingencia manual (liberar RET)
 */

import {
    pickOptimalAutoCycles,
    type V2AbsenceMap,
    type V2EngineContext,
    type V2FeasibilityReport,
    type V2PositionDef,
} from './autoScheduleEngineV2';

const CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};

/** Ausencias que disparan Modo 12 automático (cubrir con plantilla del objetivo). */
export const MODO12_AUTO_ABSENCE_CODES = new Set(['V', 'L', 'E']);

export interface DailyStaffingModel {
    cycleKey: string;
    /** Slots Modo 8 (M+T+N u equivalente) en día tipo 24hs. */
    servicioDiarioModo8: number;
    /** Slots Modo 12 (D12+N12) en el mismo día. */
    servicioDiarioModo12: number;
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

export interface ContingencyDayCheck {
    dateStr: string;
    ok: boolean;
    liberables: number;
    absentCount: number;
    reason?: string;
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
    contingencyOk: boolean;
    contingencyChecks: ContingencyDayCheck[];
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
            if (MODO12_AUTO_ABSENCE_CODES.has(String(code || '').toUpperCase())) {
                out.add(dateStr);
            }
        });
    }
    return [...out].sort();
}

function countAbsentOnDate(
    absences: V2AbsenceMap,
    employeeIds: string[],
    dateStr: string,
): number {
    let n = 0;
    for (const empId of employeeIds) {
        if (absences[empId]?.has(dateStr)) n++;
    }
    return n;
}

/**
 * Contingencia manual: liberar guardias para otro objetivo/evento.
 * Solo viable si, tras cubrir SLA + ausencias, queda slack para pasar a Modo 12.
 */
export function validateContingencyDays(params: {
    staffing: DailyStaffingModel;
    contingencyDays: string[];
    absences: V2AbsenceMap;
    employeeIds: string[];
    peopleAvailable: number;
    modo12DaysAuto: string[];
}): { ok: boolean; checks: ContingencyDayCheck[]; messages: string[] } {
    const {
        staffing,
        contingencyDays,
        absences,
        employeeIds,
        peopleAvailable,
        modo12DaysAuto,
    } = params;

    const messages: string[] = [];
    const checks: ContingencyDayCheck[] = [];
    const freedPerDay = Math.max(
        0,
        staffing.servicioDiarioModo8 - staffing.servicioDiarioModo12,
    );

    if (!contingencyDays.length) {
        return { ok: true, checks, messages };
    }

    if (peopleAvailable < staffing.plantillaTotal) {
        messages.push(
            `Contingencia: la dotación (${peopleAvailable}) está por debajo de la plantilla diseñada (${staffing.plantillaTotal}).`,
        );
    }

    const autoSet = new Set(modo12DaysAuto);
    const [cL, cF] = CYCLE_MAP[staffing.cycleKey] ?? [6, 2];
    const workRatio = cL / (cL + cF);

    for (const dateStr of [...contingencyDays].sort()) {
        const absentCount = countAbsentOnDate(absences, employeeIds, dateStr);
        const expectedWorking = Math.floor(peopleAvailable * workRatio) - absentCount;
        const needModo8 = staffing.servicioDiarioModo8;

        let ok = true;
        let reason: string | undefined;
        let liberables = freedPerDay;

        if (absentCount > 0 && autoSet.has(dateStr)) {
            liberables = 0;
            ok = false;
            reason = 'Modo 12 ya activo por ausencia; cobertura maximizada, no hay guardias liberables.';
        } else if (expectedWorking < needModo8) {
            liberables = 0;
            ok = false;
            reason = `Cobertura ajustada (${expectedWorking} disponibles vs ${needModo8} necesarios en Modo 8).`;
        } else if (peopleAvailable < staffing.plantillaTotal) {
            liberables = Math.min(liberables, Math.max(0, peopleAvailable - needModo8));
            if (liberables <= 0) {
                ok = false;
                reason = 'Sin plantilla de sobra para liberar guardias.';
            }
        }

        checks.push({ dateStr, ok, liberables, absentCount, reason });
        if (!ok && reason) {
            messages.push(`Contingencia ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: ${reason}`);
        }
    }

    const ok = checks.every(c => c.ok);
    if (!ok) {
        messages.unshift(
            'Contingencia no viable: el objetivo ya está maximizado por cobertura/ausencias. Quitá fechas o agregá dotación.',
        );
    } else if (checks.length > 0) {
        const minLib = Math.min(...checks.map(c => c.liberables));
        messages.push(
            `Contingencia OK: hasta ${minLib} guardia(s) liberable(s)/día para RET u otro objetivo (Modo 12).`,
        );
    }

    return { ok, checks, messages };
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

    const contingency = validateContingencyDays({
        staffing,
        contingencyDays: contingencyDaysManual,
        absences: input.absences,
        employeeIds,
        peopleAvailable: input.employees.length,
        modo12DaysAuto,
    });

    if (modo12DaysAuto.length > 0) {
        warnings.push(
            `Modo 12 automático: ${modo12DaysAuto.length} día(s) por vacaciones/licencias/enfermedad (cubrir con plantilla del objetivo).`,
        );
    }

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
        contingencyOk: contingency.ok,
        contingencyChecks: contingency.checks,
        contingencyMessages: contingency.messages,
        rotateShifts,
        ajustarCrono,
        warnings,
    };
}
