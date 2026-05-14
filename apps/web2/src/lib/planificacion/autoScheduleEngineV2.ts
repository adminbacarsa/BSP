/**
 * Motor de cronograma automático V2 — "viabilidad primero".
 *
 * Reglas que asume:
 *  - La PLANIFICACIÓN de un objetivo se ve por MES CALENDARIO (1 → fin del mes).
 *  - El CONTROL de horas del empleado se hace por CICLO CCT (26 → 25 del mes siguiente).
 *  - Regla dura: ningún empleado puede superar HARD_MAX_HOURS (tope CCT en `suvicoPolicy`).
 *  - El target promedio (TARGET_AVG_HOURS) es informativo, no acota la oferta.
 *
 * Por eso la oferta de un empleado en el mes calendario se compone de DOS tramos:
 *   T1 (1 → cutoff, día 25 por defecto): pertenece al ciclo CCT que viene del 26 del mes anterior.
 *      Tope = HARD_MAX − cola CCT del mes anterior.
 *   T2 (cutoff+1 → fin del mes): pertenece al ciclo CCT siguiente, que arranca de cero.
 *      Tope = HARD_MAX (lo que quede sin usar se planifica el mes siguiente).
 *
 * A diferencia del generador clásico (`generateAutoSchedule` en index.tsx),
 * acá NO se pinta nada antes de validar:
 *   1. Se calcula la demanda real (horas por puesto × días activos × qty × turno).
 *   2. Se calcula la oferta efectiva por empleado (por tramo CCT − cola − ausencias).
 *   3. Se compara la cobertura concurrente máxima vs cantidad de empleados disponibles.
 *   4. Si NO cierra → devuelve `feasibility.ok = false` con motivos claros (no se generan cambios).
 *   5. Si cierra → `generateScheduleV2` arma el cronograma respetando reglas duras.
 *
 * Reglas duras del generador (`generateScheduleV2`):
 *   - Matching primero: cada empleado se asigna a UN puesto del mes, priorizando
 *     puesto fijo (defaultPositionByEmp), cercanía y bajo ausentismo. Si sobra gente
 *     (capacidad ociosa) los empleados restantes quedan IDLE: mes entero en RET/F,
 *     sin turnos salpicados.
 *   - Rotación de bandas: en puestos con varios códigos (M/T/N o D12/N12), cada
 *     empleado rota de banda **semana a semana** (anillo + slot desfasado), no se
 *     queda todo el mes en la misma letra.
 *   - El ciclo manda: cada empleado tiene un patrón fijo de trabajo/franco.
 *       · Puesto con días limitados (ej. EN L-V) → días de trabajo = días activos del puesto.
 *       · Puesto 24/7 / empleado idle → ciclo genérico (4+2, 6+1, etc.) con offset
 *         desfasado por índice del grupo para que los francos no caigan a la vez.
 *     NUNCA se asigna un turno en un día que el ciclo del empleado marca como franco.
 *     Días libres del ciclo → F. Días de trabajo sin turno asignado → RET (horas tácitas).
 *
 * El módulo es puro: no conoce React ni Firestore. Recibe el contexto ya armado
 * por el componente y devuelve un objeto con métricas + diagnóstico.
 */

import {
    addDaysStr,
    checkRestBetweenShifts,
    workStreakStatsBackward,
    workStreakStatsForward,
    type AgreementRestConfig,
} from './restBetweenShifts';
import { RET_STANDBY_REFERENCE_HOURS } from './constants';
import { SUVICO_POLICY } from './suvicoPolicy';

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET']);
const SHIFT_HRS_DEFAULT: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9 };
const CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};
/** Horas por turno según ciclo: 4+2 → D12/N12 (12h); resto → M/T/N (8h). */
const CYCLE_SHIFT_DEFAULT: Record<string, number> = {
    '4+2': 12,
    '5+1': 8,
    '6+1': 8,
    '6+2': 8,
};

/**
 * Reglas base de descanso (sin tope de ciclo).
 * El tope `maxConsecutiveWorkDays` se setea dinámicamente con `cL` del ciclo elegido
 * dentro de `generateScheduleV2` (6+2 → 6, 4+2 → 4, etc.) para que el motor
 * respete EXACTO el ciclo y nunca produzca rachas mayores.
 */
const V2_AGREEMENT_REST_BASE: AgreementRestConfig = {
    minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
    longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
    minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
};

/** Tope target promedio por empleado / mes; fuente: `SUVICO_POLICY.REST.TARGET_MONTHLY`. */
export const TARGET_AVG_HOURS = SUVICO_POLICY.REST.TARGET_MONTHLY;
/** Tope duro de horas facturables por ciclo CCT; fuente: `SUVICO_POLICY.REST.MAX_MONTHLY_HARD`. */
export const HARD_MAX_HOURS = SUVICO_POLICY.REST.MAX_MONTHLY_HARD;
/**
 * La racha 48h → descanso 35h del CCT se controla día a día con `checkRestBetweenShifts` y
 * `verifyScheduleCoverage` (no hay "tope semanal blando" que la reemplace). Tras generar,
 * `stats.suvicoWeekBillableOver48` lista semanas ISO con más de 48h facturables solo como
 * alerta de carga/costo; no liquida extras ni sustituye asesoramiento legal.
 */
export interface V2ShiftDef {
    code: string;
    name?: string;
    hours?: number;
    startTime?: string;
    endTime?: string;
    days?: string[]; // letras de día activas L M X J V S D
}

export interface V2PositionDef {
    positionName: string;
    qty?: number;
    shifts?: V2ShiftDef[];
    activeDays?: string[]; // si <7, manda esta lista
    /** '24hs' = meta 24h × pax/día (no se suman variantes M/T/N + D12/N12). 'custom' u otro = suma de bandas o modalidad elegida. */
    coverageType?: string;
}

export interface V2EmployeeDef {
    id: string;
    nombre?: string;
    /** Coordenadas del domicilio del empleado (si están). */
    lat?: number | null;
    lng?: number | null;
    /** Objetivo preferido del empleado (RRHH). Si coincide con el actual, prioridad alta. */
    preferredObjectiveId?: string;
    /** Tasa de ausentismo (0..1) de los últimos N meses. Menor = mejor. */
    absenceRate?: number;
}

export interface V2AbsenceMap {
    /** empId → set de fechas YYYY-MM-DD con código de ausencia. */
    [empId: string]: Map<string, string>;
}

export type V2BudgetMode = 'cct' | 'calendar';

export interface V2EngineContext {
    positions: V2PositionDef[];
    employees: V2EmployeeDef[];
    /** Días del mes objetivo. */
    daysInMonth: Date[];
    /** Horas ya acumuladas por empleado (cola CCT 26→fin del mes anterior). */
    empMonthlyInitial: Record<string, number>;
    /** Mapa de ausencias por empleado. */
    absences: V2AbsenceMap;
    /** Horas vendidas (SLA) del objetivo. */
    slaVendidas: number;
    /** Esquemas de ciclo seleccionados por el usuario (4+2, 6+1, etc.). */
    autoCycles: string[];
    /** Identificador del objetivo actual (para comparar contra preferredObjectiveId). */
    objectiveId?: string;
    /** Coordenadas del objetivo (para ordenar por cercanía). */
    objectiveLat?: number | null;
    objectiveLng?: number | null;
    /** Mapa empId → nombre de puesto al que está fijado en este objetivo (empDefaultPos). */
    defaultPositionByEmp?: Record<string, string>;
    /**
     * Cupo del empleado:
     *  - 'cct' (recomendado): divide el mes en tramo ciclo actual (1→cutoff) y ciclo siguiente
     *    (cutoff+1→fin). El tramo actual respeta la cola CCT; el siguiente arranca de cero.
     *  - 'calendar': 192h netas por persona en todo el mes, ignora la cola.
     */
    budgetMode?: V2BudgetMode;
    /** Día de corte CCT (último día del ciclo del mes). Default 25 (CCT 422/05). */
    cctCutoffDay?: number;
    /** Función para obtener "L M X J V S D" desde YYYY-MM-DD. */
    getDayLetter: (dateStr: string) => string;
    /** Función para serializar Date → YYYY-MM-DD. */
    getDateKey: (d: Date) => string;
    /**
     * Rotar bandas semana a semana (M→T→N→M…). Default: true.
     * Si el puesto tiene una sola banda (ej. RO) no tiene efecto.
     */
    rotateShifts?: boolean;
}

export interface V2PositionDemand {
    positionName: string;
    /** Horas totales requeridas en el mes para cubrir el SLA del puesto. */
    monthHours: number;
    /** Personas necesarias en simultáneo en el día más cargado. */
    peakConcurrent: number;
    /** Días activos en el mes. */
    activeDays: number;
    /** Personas estimadas para cubrir el puesto continuamente, dado el ciclo (qty × (cL+cF)/cL). */
    peopleNeededWithCycle: number;
    /** Total de asignaciones (slots) a cubrir en el mes: Σ qty × bandas × días activos. */
    totalSlots: number;
}

export interface V2EmployeeOffer {
    id: string;
    nombre?: string;
    /** Horas ya cargadas en cola CCT (26→fin mes anterior). */
    priorHours: number;
    /** Días de ausencia en el mes. */
    absenceDays: number;
    /** Horas disponibles en el TRAMO del ciclo CCT actual (días 1 → cutoff). */
    availableCurrentCycle: number;
    /** Horas disponibles en el TRAMO del ciclo CCT siguiente (cutoff+1 → fin de mes). */
    availableNextCycle: number;
    /** Días planificables en cada tramo. */
    daysCurrentCycle: number;
    daysNextCycle: number;
    /** Horas máximas que puede aportar este mes calendario (suma de ambos tramos). */
    availableHours: number;
}

export interface V2FeasibilityReport {
    ok: boolean;
    /** Bloqueos duros: oferta insuficiente para cumplir el contrato. */
    reasons: string[];
    /** Inconsistencias importantes (estructura vs SLA vendidas) — no bloquean pero deben revisarse. */
    warnings: string[];
    metrics: {
        /** Horas que costaría cubrir la estructura del SLA al 100% (qty × bandas × días activos). */
        structuralDemandHours: number;
        /** Horas vendidas / contratadas del SLA (campo slaVendidas). */
        contractedHours: number;
        /** Objetivo real de planificación (vendidas si > 0, si no la estructural). */
        effectiveTargetHours: number;
        /** Capacidad máxima del equipo (Σ availableHours). */
        offerHours: number;
        peopleAvailable: number;
        /** Personas en simultáneo en el día estructural más cargado. */
        peakConcurrent: number;
        /** Mínimo de personas por cupo de horas (ceil(objetivo / 192)). */
        peopleNeededForTarget: number;
        /** Heurística de dotación con ciclo (ceil(objetivo/192 × factor)); solo advertencia. */
        peopleSuggestedWithCycle: number;
        /** Personas necesarias si se cubre el 100% de la estructura (referencia). */
        peopleNeededForStructure: number;
        cycleFactor: number;
        cycleUsed: string;
        /** Σ horas ya cargadas en cola CCT (26–fin mes anterior) por todo el equipo. */
        totalPriorHoursTeam: number;
        /** Σ (días ausencia × 8h) estimado para el mes. */
        totalAbsenceHoursTeam: number;
        /** Día de corte CCT usado (default 25). */
        cctCutoffDay: number;
        /** Σ oferta del tramo ciclo actual (1 → cutoff). */
        offerHoursCurrentCycle: number;
        /** Σ oferta del tramo ciclo siguiente (cutoff+1 → fin). */
        offerHoursNextCycle: number;
        /** Capacidad ociosa: empleados que sobran tras asignar a todos los puestos. */
        idleEmployees?: number;
        /** Detalle de empleados ociosos (id + nombre). */
        idleEmployeesList?: Array<{ id: string; nombre?: string }>;
        /** Total de asignaciones (slots) a cubrir en el mes: Σ por puesto qty × bandas × días activos. */
        totalSlotsAll: number;
        /** Comparativa de personas necesarias y buffer por esquema de ciclo (4+2, 5+1, 6+1, 6+2). */
        cycleComparison: Array<{
            cycleKey: string;
            structuralPeakPeople: number;
            hrsPerPerson: number;
            bufferHours: number;
            retEstimate: number;
        }>;
    };
    perPosition: V2PositionDemand[];
    perEmployee: V2EmployeeOffer[];
}

export interface V2EngineResult {
    feasibility: V2FeasibilityReport;
    /** En esta iteración inicial siempre vacío (no pinta hasta que viabilidad esté firme). */
    changes: Record<string, any>;
}

/** Devuelve [cL, cF] del ciclo "más representativo" elegido por el usuario.
 *  Prefiere el ciclo con más días de franco (6+2 > 6+1) para que si ambos
 *  están marcados, se respete el esquema de mayor descanso solicitado. */
export function pickRepresentativeCycle(autoCycles: string[]): { key: string; cL: number; cF: number } {
    const ordered = ['6+2', '6+1', '5+1', '4+2'];
    for (const key of ordered) {
        if (autoCycles.includes(key)) {
            const [cL, cF] = CYCLE_MAP[key];
            return { key, cL, cF };
        }
    }
    return { key: '6+1', cL: 6, cF: 1 };
}

function isFrancoCode(code: string | undefined): boolean {
    return FRANCO_SET.has(String(code || '').toUpperCase());
}

function parseShiftHourFloat(t: any): number | null {
    if (t == null || t === '' || t === '00:00') return null;
    if (typeof t !== 'string') return null;
    const parts = t.split(':').map(Number);
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h)) return null;
    return h + (m || 0) / 60;
}

/**
 * Duración del turno en horas. Orden de prioridad:
 *  1) `s.hours` si viene explícito y > 0.
 *  2) Diferencia `endTime - startTime` (con overnight: si end ≤ start sumamos 24h).
 *  3) Default por código (M/T/N=8, D12/N12=12) → 8 si el código es desconocido.
 *
 * Antes solo usábamos (1) y (3): los puestos con códigos custom (RO, EN, RON, PU, etc.)
 * que solo declaran startTime/endTime caían al fallback 8h y el motor escribía
 * asignaciones de 8h cuando el SLA pedía 10h/12h, dejando huecos de cobertura.
 */
function shiftHours(s: V2ShiftDef): number {
    const code = String(s.code || '').toUpperCase();
    const h = Number(s.hours);
    if (Number.isFinite(h) && h > 0) return h;
    const start = parseShiftHourFloat(s.startTime);
    const end = parseShiftHourFloat(s.endTime);
    if (start !== null && end !== null) {
        let dur = end - start;
        if (dur <= 0) dur += 24; // turno nocturno (cruza medianoche)
        if (dur > 0 && dur <= 24) return dur;
    }
    return SHIFT_HRS_DEFAULT[code] ?? 8;
}

export function positionIsActiveOn(pos: V2PositionDef, dayLetter: string): boolean {
    if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    const workingShifts = (pos.shifts || []).filter((s) => !isFrancoCode(s.code));
    const withDays = workingShifts.filter((s) => Array.isArray(s.days) && s.days!.length > 0);
    if (withDays.length === 0 || withDays.length < workingShifts.length) return true;
    return withDays.some((s) => s.days!.includes(dayLetter));
}

/** Bandas activas un día (sin francos). */
function shiftsActiveOnDay(pos: V2PositionDef, dayLetter: string): V2ShiftDef[] {
    return (pos.shifts || []).filter((s) => {
        if (isFrancoCode(s.code)) return false;
        if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(dayLetter)) return false;
        return true;
    });
}



/**
 * Bandas activas del puesto para un día, filtradas según el ciclo elegido:
 *  - 4+2 → 48h/4días = 12h/turno → preferir D12/N12
 *  - 6+x / 5+1 → 48h/6-5días = 8h/turno → preferir M/T/N
 * Fallback: si el SLA no tiene bandas del tipo preferido, se usan las disponibles.
 */
export function effectiveShiftsForPositionDay(
    pos: V2PositionDef,
    dayLetter: string,
    autoCycles?: string[]
): V2ShiftDef[] {
    if (!positionIsActiveOn(pos, dayLetter)) return [];
    const dayShifts = shiftsActiveOnDay(pos, dayLetter);
    if (dayShifts.length === 0) return [];
    const { key: cycleKey } = pickRepresentativeCycle(autoCycles || []);
    if (cycleKey === '4+2') {
        // Ciclo puro 4+2 → 48h/4días = 12h/turno → D12/N12
        const bands12 = dayShifts.filter((s) => shiftHours(s) >= 12);
        if (bands12.length > 0) return bands12;
        return dayShifts;
    }
    // Ciclo 8h (6+2, 6+1, 5+1) → M/T/N
    const bands8 = dayShifts.filter((s) => shiftHours(s) < 12);
    if (bands8.length > 0) return bands8;
    return dayShifts;
}

function is24hsCoverage(pos: V2PositionDef): boolean {
    const t = String(pos.coverageType || '24hs').toLowerCase();
    return t === '24hs' || t === '24' || t === '24h';
}

/** Horas de cobertura “meta” ese día para el puesto (alineado al pie: 24h×pax en 24hs). */
function dailyCoverageHoursForPosition(pos: V2PositionDef, dayLetter: string, autoCycles?: string[]): number {
    if (!positionIsActiveOn(pos, dayLetter)) return 0;
    const qty = Math.max(1, Number(pos.qty) || 1);
    if (is24hsCoverage(pos)) {
        return qty * 24;
    }
    const eff = effectiveShiftsForPositionDay(pos, dayLetter, autoCycles);
    const h = eff.reduce((sum, s) => sum + shiftHours(s), 0);
    return qty * h;
}

function dayDemandHoursForPosition(pos: V2PositionDef, dayLetter: string, autoCycles?: string[]): number {
    return dailyCoverageHoursForPosition(pos, dayLetter, autoCycles);
}

function dayPeakConcurrentForPosition(pos: V2PositionDef, dayLetter: string, autoCycles?: string[]): number {
    if (!positionIsActiveOn(pos, dayLetter)) return 0;
    const qty = Math.max(1, Number(pos.qty) || 1);
    if (is24hsCoverage(pos)) return qty;
    const eff = effectiveShiftsForPositionDay(pos, dayLetter, autoCycles);
    return qty * Math.max(1, eff.length);
}

export function checkFeasibility(ctx: V2EngineContext): V2FeasibilityReport {
    const { cL, cF, key: cycleKey } = pickRepresentativeCycle(ctx.autoCycles);
    const cycleFactor = (cL + cF) / cL; // p.ej. 6+1 → 7/6 ≈ 1.166

    const perPosition: V2PositionDemand[] = ctx.positions.map((pos) => {
        let monthHours = 0;
        let peakConcurrent = 0;
        let activeDays = 0;
        let totalSlots = 0;
        const qty = Math.max(1, Number(pos.qty) || 1);
        ctx.daysInMonth.forEach((d) => {
            const letter = ctx.getDayLetter(ctx.getDateKey(d));
            const dh = dayDemandHoursForPosition(pos, letter, ctx.autoCycles);
            if (dh > 0) {
                activeDays++;
                monthHours += dh;
                const peak = dayPeakConcurrentForPosition(pos, letter, ctx.autoCycles);
                if (peak > peakConcurrent) peakConcurrent = peak;
                // Slots = qty × bandas activas ese día
                const bands = effectiveShiftsForPositionDay(pos, letter, ctx.autoCycles).length;
                totalSlots += qty * Math.max(1, bands);
            }
        });
        // Dotación realista: cabezas necesarias para cubrir las horas mensuales del puesto
        // sumando el sobrecosto del ciclo (francos).
        //
        // Puestos 24/7 (ej. PUESTO 1, M+T+N): el ciclo genera francos → se necesita más
        // gente que la que está en servicio simultáneamente. Usamos cycleFactor y TARGET_AVG_HOURS.
        //
        // Puestos limitados (L-V): el descanso natural S/D ya es el "franco". NO aplicamos
        // cycleFactor ni inflamos por horas: 1 persona cubre 1 puesto L-V aunque el total de
        // horas supere TARGET_AVG_HOURS (el tope CCT de 200h se maneja en la asignación).
        // Si el guardia llega a 200h antes de fin de mes, los días restantes quedan como
        // RET activable del colchón global (3456h disponibles vs 3298h contratadas = 158h buffer).
        const isLimitedSchedule = activeDays < ctx.daysInMonth.length;
        const factorForPosition = isLimitedSchedule ? 1 : cycleFactor;
        const peopleByHours = (!isLimitedSchedule && monthHours > 0)
            ? Math.ceil((monthHours / TARGET_AVG_HOURS) * factorForPosition)
            : 0;
        const peopleByPeak = Math.ceil(peakConcurrent * factorForPosition);
        const peopleNeededWithCycle = Math.max(peopleByHours, peopleByPeak);
        return {
            positionName: pos.positionName,
            monthHours,
            peakConcurrent,
            activeDays,
            peopleNeededWithCycle,
            totalSlots,
        };
    });

    const structuralDemandHours = perPosition.reduce((s, p) => s + p.monthHours, 0);
    const peakConcurrent = perPosition.reduce((s, p) => s + p.peakConcurrent, 0);
    const peopleNeededForStructure = perPosition.reduce((s, p) => s + p.peopleNeededWithCycle, 0);
    // Dotación estructural basada solo en pico concurrente × factor de ciclo (sin inflar con TARGET_AVG_HOURS).
    // peopleNeededForStructure usa max(horas, pico) y puede sobreestimar con 8h shifts; esta métrica
    // es la correcta para saber si el ciclo cierra matemáticamente con la dotación disponible.
    const structuralPeakPeople = ctx.positions.reduce((s, pos, idx) => {
        const p = perPosition[idx];
        if (!p) return s;
        const isLimited = p.activeDays < ctx.daysInMonth.length;
        const factor = isLimited ? 1 : cycleFactor;
        return s + Math.ceil(p.peakConcurrent * factor);
    }, 0);

    const contractedHours = Math.max(0, ctx.slaVendidas || 0);
    /** Si hay horas vendidas, ese es el verdadero objetivo de planificación. Si no, la estructura. */
    const effectiveTargetHours = contractedHours > 0 ? contractedHours : structuralDemandHours;
    /** Por horas: cuántos "192h" hacen falta (sin mezclar factor de ciclo en el cupo total). */
    const peopleNeededForTarget = Math.ceil(effectiveTargetHours / TARGET_AVG_HOURS);
    /** Heurística: con francos del ciclo a veces conviene +1 cabeza; no bloquea si ya cierran las horas. */
    const peopleSuggestedWithCycle = Math.ceil((effectiveTargetHours / TARGET_AVG_HOURS) * cycleFactor);

    const mode: V2BudgetMode = ctx.budgetMode === 'calendar' ? 'calendar' : 'cct';
    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31 ? ctx.cctCutoffDay : 25;
    /** Jornada promedio para estimar capacidad por días (8h por defecto; 12h si el ciclo es 4+2). */
    const avgShiftHours = cycleKey === '4+2' ? 12 : 8;
    /** Proporción de días laborables del ciclo (6+1 → 6/7). */
    const workRatio = cL / (cL + cF);

    const daysCurrent = ctx.daysInMonth.filter((d) => d.getDate() <= cutoffDay);
    const daysNext = ctx.daysInMonth.filter((d) => d.getDate() > cutoffDay);

    const perEmployee: V2EmployeeOffer[] = ctx.employees.map((emp) => {
        const priorHours = Math.max(0, ctx.empMonthlyInitial[emp.id] || 0);
        const absSet = ctx.absences[emp.id];
        const absenceDaysCurrent = absSet ? daysCurrent.filter((d) => absSet.has(ctx.getDateKey(d))).length : 0;
        const absenceDaysNext = absSet ? daysNext.filter((d) => absSet.has(ctx.getDateKey(d))).length : 0;
        const absenceDays = absenceDaysCurrent + absenceDaysNext;

        if (mode === 'calendar') {
            const availableHours = Math.max(0, HARD_MAX_HOURS - absenceDays * 8);
            return {
                id: emp.id,
                nombre: emp.nombre,
                priorHours,
                absenceDays,
                availableCurrentCycle: availableHours,
                availableNextCycle: 0,
                daysCurrentCycle: ctx.daysInMonth.length,
                daysNextCycle: 0,
                availableHours,
            };
        }

        // Modo CCT por tramos.
        // Regla dura: en cada ciclo CCT (26→25) el empleado no puede pasar de 200h (HARD_MAX_HOURS).
        // Tramo 1 → cutoff: cola CCT + horas del tramo ≤ 200 → tope = 200 − cola.
        // Tramo cutoff+1 → fin: ciclo CCT nuevo arranca en cero → tope = 200 (lo que falte se planificará el mes próximo).
        const remainingHardCurrent = Math.max(0, HARD_MAX_HOURS - priorHours);
        const workableDaysCurrent = Math.max(0, daysCurrent.length - absenceDaysCurrent);
        // Capacidad por tramo: días del tramo × proporción de trabajo del ciclo (cL/(cL+cF))
        // × jornada. Los días laborables efectivos suelen ser fraccionarios (ej. 6+2 en
        // 25 días → 18,75 días); redondear todo el producto hacia abajo subestimaba ~2h
        // por tramo y marcaba "no viable" con 18×180 cuando con techo 200 y días
        // enteros sí cierra (ceil(18,75)=19 → 152h en T1, etc.).
        const rawWorkSlotsCurrent = workableDaysCurrent * workRatio;
        const capacityCurrent = Math.ceil(rawWorkSlotsCurrent) * avgShiftHours;
        const availableCurrentCycle = Math.max(0, Math.min(remainingHardCurrent, capacityCurrent));

        const workableDaysNext = Math.max(0, daysNext.length - absenceDaysNext);
        const rawWorkSlotsNext = workableDaysNext * workRatio;
        const capacityNext = Math.ceil(rawWorkSlotsNext) * avgShiftHours;
        const availableNextCycle = Math.max(0, Math.min(HARD_MAX_HOURS, capacityNext));

        return {
            id: emp.id,
            nombre: emp.nombre,
            priorHours,
            absenceDays,
            availableCurrentCycle,
            availableNextCycle,
            daysCurrentCycle: daysCurrent.length,
            daysNextCycle: daysNext.length,
            availableHours: availableCurrentCycle + availableNextCycle,
        };
    });

    const offerHours = perEmployee.reduce((s, e) => s + e.availableHours, 0);
    const offerHoursCurrentCycle = perEmployee.reduce((s, e) => s + e.availableCurrentCycle, 0);
    const offerHoursNextCycle = perEmployee.reduce((s, e) => s + e.availableNextCycle, 0);
    const peopleAvailable = perEmployee.filter((e) => e.availableHours > 0).length;
    const totalPriorHoursTeam = perEmployee.reduce((s, e) => s + e.priorHours, 0);
    const totalAbsenceHoursTeam = perEmployee.reduce((s, e) => s + e.absenceDays * 8, 0);

    const reasons: string[] = [];
    const warnings: string[] = [];

    // Inconsistencia estructura vs SLA vendidas (advertencia, no bloqueo)
    if (contractedHours > 0 && structuralDemandHours > 0) {
        const diff = structuralDemandHours - contractedHours;
        const pct  = Math.abs(diff) / Math.max(contractedHours, 1);
        if (pct > 0.10) {
            if (diff > 0) {
                warnings.push(
                    `La estructura cargada en el SLA equivale a unas ${Math.round(structuralDemandHours)}h de cobertura “máxima” en el mes que estás viendo (no suma otros meses), pero el contrato (horas vendidas) es ${Math.round(contractedHours)}h. ` +
                    `Eso no invalida la viabilidad: solo indica que el modelo en pantalla tiene más bandas/qty de las que hoy facturás. ` +
                    `Podés dejarlo así y planificar contra las vendidas, o alinear el SLA (bajar qty / sacar bandas) para que el pie de cobertura coincida con lo operado.`
                );
            } else {
                warnings.push(
                    `Vendiste ${Math.round(contractedHours)}h pero la estructura cargada cubriría unas ${Math.round(structuralDemandHours)}h. ` +
                    `No invalida la viabilidad si la oferta del equipo alcanza; igual conviene revisar puestos/bandas o el monto vendido.`
                );
            }
        }
    }

    if (peopleAvailable < peopleNeededForTarget) {
        reasons.push(
            `Dotación insuficiente por horas: hacen falta al menos ${peopleNeededForTarget} personas con ~${TARGET_AVG_HOURS}h c/u para ${Math.round(effectiveTargetHours)}h y hay ${peopleAvailable}.`
        );
    } else if (peopleAvailable < peopleSuggestedWithCycle) {
        warnings.push(
            `Con ciclo ${cycleKey} a veces se recomienda ~${peopleSuggestedWithCycle} personas para rotar francos con más holgura; con ${peopleAvailable} el cupo de horas alcanza el objetivo, pero el calendario puede quedar más apretado.`
        );
    }

    // Capacidad ociosa: si tenés más empleados que los necesarios por ciclo y por horas,
    // los que sobran van a quedar en RET / F (no van a tomar turnos facturables).
    const peopleNeededFinal = Math.max(peopleNeededForTarget, peopleSuggestedWithCycle);
    const idleCount = Math.max(0, peopleAvailable - peopleNeededFinal);
    const idleEmployeesList: Array<{ id: string; nombre?: string }> = [];
    if (idleCount > 0) {
        warnings.push(
            `Capacidad ociosa: con ${peopleAvailable} personas disponibles y ${peopleNeededFinal} necesarias para el ciclo ${cycleKey}, sobran ~${idleCount}. ` +
            `Estos empleados van a quedar en RET / Franco todo el mes (no se les van a salpicar turnos sueltos).`
        );
    }
    if (offerHours < effectiveTargetHours) {
        const falta = Math.round(effectiveTargetHours - offerHours);
        reasons.push(
            `Horas insuficientes: el equipo aporta como máximo ${Math.round(offerHours)}h y el objetivo es ${Math.round(effectiveTargetHours)}h (faltan ${falta}h).`
        );
    }
    // Pico simultáneo solo bloquea si encima ya falta gente (evita pánico cuando estructura > vendidas).
    if (peopleAvailable < peakConcurrent && peopleAvailable < peopleNeededForTarget) {
        reasons.push(
            `Pico simultáneo estructural: el día más cargado de la estructura requiere ${peakConcurrent} personas a la vez (puede ser por sobre-diseño del SLA).`
        );
    }

    // Verificación estructural por ciclo: ¿alcanza la dotación para cubrir TODOS los puestos
    // con el ciclo elegido?
    //  · Déficit ≥ 2 personas → bloqueo duro (genuinamente imposible).
    //  · Déficit = 1 persona → advertencia (puede generar con huecos mínimos; a menudo
    //    causado por un puesto L-V no configurado como tal en Servicios → el motor lo
    //    trata como 7 días y aplica el factor de ciclo, inflando la cuenta).
    //  · Colchón 0-1 → advertencia de margen ajustado.
    const structuralGap = structuralPeakPeople - peopleAvailable;
    if (structuralGap >= 2) {
        reasons.push(
            `Ciclo ${cycleKey} inviable: cubrir todos los puestos en simultáneo requiere ~${structuralPeakPeople} personas (pico × factor ${cycleKey}) pero hay ${peopleAvailable} (faltan ${structuralGap}). ` +
            `Soluciones: elegir 4+2 (menos personas por ciclo), agregar personas, o verificar que los puestos L-V estén configurados con "Días operativos" L-V en Servicios.`
        );
    } else if (structuralGap === 1) {
        warnings.push(
            `Ciclo ${cycleKey}: necesita ~${structuralPeakPeople} personas para cubrir todos los puestos simultáneamente y hay ${peopleAvailable}. ` +
            `Va a generar con 1 slot potencialmente sin cubrir por día. Si algún puesto opera solo L-V (ej. Rondin, Encargada), configuralo con "Días operativos" en Servicios para que el motor no aplique el factor de ciclo a ese puesto.`
        );
    } else if (structuralGap >= -1) {
        warnings.push(
            `Margen muy ajustado con ciclo ${cycleKey}: se necesitan ${structuralPeakPeople} personas y hay ${peopleAvailable} (colchón de ${-structuralGap}). ` +
            `Cualquier ausencia puede generar slots vacíos. Si algún puesto opera L-V, configuralo en Servicios → Días operativos.`
        );
    }

    return {
        ok: reasons.length === 0,
        reasons,
        warnings,
        metrics: {
            structuralDemandHours,
            contractedHours,
            effectiveTargetHours,
            offerHours,
            peopleAvailable,
            peakConcurrent,
            peopleNeededForTarget,
            peopleSuggestedWithCycle,
            peopleNeededForStructure,
            cycleFactor,
            cycleUsed: cycleKey,
            totalPriorHoursTeam,
            totalAbsenceHoursTeam,
            cctCutoffDay: cutoffDay,
            offerHoursCurrentCycle,
            offerHoursNextCycle,
            idleEmployees: idleCount,
            idleEmployeesList,
            totalSlotsAll: perPosition.reduce((s, p) => s + p.totalSlots, 0),
            cycleComparison: Object.entries(CYCLE_MAP).map(([ck, [cLc, cFc]]) => {
                const f = (cLc + cFc) / cLc;
                const avgHrs = CYCLE_SHIFT_DEFAULT[ck] ?? 8;
                const spp = ctx.positions.reduce((s, _pos, idx) => {
                    const p = perPosition[idx];
                    if (!p) return s;
                    const isLim = p.activeDays < ctx.daysInMonth.length;
                    return s + Math.ceil(p.peakConcurrent * (isLim ? 1 : f));
                }, 0);
                const workDays = Math.floor((cLc / (cLc + cFc)) * ctx.daysInMonth.length);
                const hrsPerPerson = Math.min(HARD_MAX_HOURS, workDays * avgHrs);
                const buffer = spp * hrsPerPerson - structuralDemandHours;
                return {
                    cycleKey: ck,
                    structuralPeakPeople: spp,
                    hrsPerPerson,
                    bufferHours: Math.round(buffer),
                    retEstimate: Math.max(0, Math.floor(buffer / avgHrs)),
                };
            }),
        },
        perPosition,
        perEmployee,
    };
}

// ───────────────────────────── GENERACIÓN ─────────────────────────────

export interface V2Assignment {
    empId: string;
    dateStr: string; // YYYY-MM-DD
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTime: string;
    /** Hora de fin (HH:MM). Importante para códigos custom (RO, EN, RON…) cuya duración no es 8/12h estándar. */
    endTime?: string;
    isFranco?: boolean;
    isReten?: boolean;
}

export interface V2GenerateStats {
    totalAssignments: number;
    totalBillableHours: number;
    targetHours: number;
    uncoveredSlots: number;
    employeeMonthlyHours: Record<string, number>;
    employeeCycleHours: { current: Record<string, number>; next: Record<string, number> };
    employeesOver200: string[];
    /** Dotación final por puesto tras el matching. */
    positionGroups?: Record<string, string[]>;
    /** Empleados que quedaron como capacidad ociosa (mes en RET/F, sin turnos). */
    idleEmployeeIds?: string[];
    /** Turno principal del mes por empleado asignado (M, T, N, D12, N12). */
    primaryShiftByEmp?: Record<string, string | null>;
    /**
     * Cantidad de RETs por empleado en el mes.
     * RET = stand-by ("retenido por si hace falta"); no suma a horas trabajadas
     * pero representa horas POTENCIALES que pueden activarse para cubrir ausencias
     * en otros objetivos (usa `RET_STANDBY_REFERENCE_HOURS` en stats, no liquidación).
     */
    employeeRetCount?: Record<string, number>;
    /** Horas RET potenciales por empleado = retCount × referencia stand-by (~8h, ver `RET_STANDBY_REFERENCE_HOURS`). */
    employeeRetHoursPotential?: Record<string, number>;
    /** Total mes de RETs y horas RET potenciales (suma de todos los empleados). */
    totalRetCount?: number;
    totalRetHoursPotential?: number;
    /**
     * Semanas ISO (facturación acumulada en `writeAssignment`) por encima del umbral semanal
     * en `SUVICO_POLICY.ALERTS` (48h por defecto, 50h en puestos limitados).
     * Solo alerta operativa: el cumplimiento legal de racha + descanso prolongado
     * sigue validándose con `verifyScheduleCoverage` / `checkRestBetweenShifts`.
     */
    suvicoWeekBillableOver48?: Array<{ empId: string; weekKey: string; hours: number }>;
}

export interface V2GenerateResult {
    feasibility: V2FeasibilityReport;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
}

const OVERNIGHT_CODES = new Set(['N', 'N12']);
const SHIFT_END_HOUR: Record<string, number> = { M: 14, T: 22, N: 6, D12: 19, N12: 7 };
const SHIFT_START_HOUR: Record<string, number> = { M: 6, T: 14, N: 22, D12: 7, N12: 19 };
const DEFAULT_SHIFT_TIMES: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };

interface EmpRuntimeState {
    monthHours: number;
    cycleCurrentUsed: number; // tramo 1→cutoff
    cycleNextUsed: number;    // tramo cutoff+1→fin
    weekHours: Record<string, number>; // key = año-semana ISO
    lastWorkDate: string | null;
    lastShiftCode: string | null;
    lastShiftStart: number | null; // hora de inicio numérica (0-23.99)
    lastShiftHours: number | null; // duración en horas
    assignedDays: Set<string>; // YYYY-MM-DD donde ya tiene algo (turno o ausencia)
}

function isoWeekKey(d: Date): string {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const weekNum = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Genera asignaciones respetando ciclo CCT (4+2, 6+1...), 200h/ciclo, ausencias y horas vendidas. */
export function generateScheduleV2(ctx: V2EngineContext): V2GenerateResult {
    const feasibility = checkFeasibility(ctx);
    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31 ? ctx.cctCutoffDay : 25;
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles);
    const cycleLen = cL + cF; // p.ej. 6+1 → 7
    const has4x2 = ctx.autoCycles.includes('4+2');
    const defaultPos = { ...(ctx.defaultPositionByEmp || {}) };
    // Empleados con puesto fijo EXPLÍCITO (configurado por el usuario, no auto-detectado).
    // Se usa en el emergency pass para diferenciar quién puede moverse entre puestos.
    const userLockedPos: Record<string, string> = { ...(ctx.defaultPositionByEmp || {}) };

    // Config de descanso dinámico: agrega el tope HARD de días seguidos según el ciclo.
    const V2_AGREEMENT_REST: AgreementRestConfig = {
        ...V2_AGREEMENT_REST_BASE,
        maxConsecutiveWorkDays: cL,
    };

    // Pre-cálculo: distancia, preferencia y ausentismo (un solo cálculo por empleado).
    // Se usa para ordenar el matching empleado→puesto.
    const haversineKm = (a: number, b: number, c: number, d: number) => {
        const toRad = (x: number) => (x * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(c - a);
        const dLng = toRad(d - b);
        const sa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(sa));
    };
    const empMeta: Record<string, { preferMatch: boolean; distanceKm: number | null; absenceRate: number; targetHours: number; priorityScore: number }> = {};
    ctx.employees.forEach((e) => {
        const preferMatch = !!ctx.objectiveId && !!e.preferredObjectiveId && e.preferredObjectiveId === ctx.objectiveId;
        let distanceKm: number | null = null;
        if (
            typeof e.lat === 'number' && typeof e.lng === 'number' &&
            typeof ctx.objectiveLat === 'number' && typeof ctx.objectiveLng === 'number'
        ) {
            distanceKm = haversineKm(e.lat, e.lng, ctx.objectiveLat, ctx.objectiveLng);
        }
        const absenceRate = Math.max(0, Math.min(1, e.absenceRate ?? 0));
        const priorityScore =
            (preferMatch ? 100 : 0) +                              // objetivo preferido manda
            (distanceKm === null ? 0 : Math.max(0, 40 - distanceKm * 0.8)) + // más cerca, mejor
            (1 - absenceRate) * 30;                                // menor ausentismo, mejor
        empMeta[e.id] = { preferMatch, distanceKm, absenceRate, targetHours: TARGET_AVG_HOURS, priorityScore };
    });

    // ── PASO 1: Matching empleado → puesto ──────────────────────────────
    // Asignamos a cada empleado UN puesto fijo del mes (o lo dejamos idle si no entra
    // en ningún cupo). Esto evita que el motor salpique turnos sueltos entre puestos.
    const positionGroups: Record<string, string[]> = {};
    ctx.positions.forEach((p) => { positionGroups[p.positionName] = []; });
    const empAssignedTo: Record<string, string | null> = {};

    // Mejor candidato primero (orden global)
    const sortedEmps = [...ctx.employees].sort((a, b) => empMeta[b.id].priorityScore - empMeta[a.id].priorityScore);

    // 1a. Empleados con puesto fijo: van a ese puesto SIEMPRE QUE el puesto no esté
    //     saturado (1.6× el needed). Si el puesto fijo ya está lleno, igual respetamos
    //     la elección operativa pero como refuerzo (no rechazamos al empleado).
    //     Esto evita que 10 empleados con default = "Puesto 1" dejen vacío al resto.
    const positionNeed: Record<string, number> = {};
    feasibility.perPosition.forEach((p) => { positionNeed[p.positionName] = p.peopleNeededWithCycle; });
    // 1.05 es el balance ajustado: casi sin refuerzos para que los titulares
    // del grupo consuman las horas hasta 200h/ciclo. Refuerzos extra =
    // cada uno pasa más días en RET y se desperdicia capacidad.
    const overcapFactor = 1.05;

    for (const emp of sortedEmps) {
        const fixed = defaultPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        positionGroups[fixed].push(emp.id);
        empAssignedTo[emp.id] = fixed;
    }
    // 1b. Resto: llenar los puestos hasta el "needed" del ciclo, eligiendo en cada paso
    //     el puesto con mayor brecha. Cuando todos están saturados, seguimos repartiendo
    //     los empleados restantes como REFUERZO (rotando el puesto con menos refuerzo)
    //     para que ninguno quede idle si el puesto puede absorber relevos.
    //     Solo queda idle cuando claramente sobran cabezas vs lo que cualquier puesto
    //     puede usar (umbral: overcapFactor del needed por ciclo).
    for (const emp of sortedEmps) {
        if (empAssignedTo[emp.id] !== undefined) continue;
        let target: string | null = null;
        let maxGap = 0;
        // primero, puesto con mayor brecha vs lo necesario
        for (const pos of ctx.positions) {
            const need = positionNeed[pos.positionName] || 0;
            const have = positionGroups[pos.positionName].length;
            const gap = need - have;
            if (gap > maxGap) { maxGap = gap; target = pos.positionName; }
        }
        // si todos los puestos están en o sobre su needed, distribuir como refuerzo
        // dando prioridad al puesto con menor saturación relativa.
        if (!target) {
            let minRatio = Infinity;
            for (const pos of ctx.positions) {
                const need = Math.max(1, positionNeed[pos.positionName] || 1);
                const have = positionGroups[pos.positionName].length;
                const ratio = have / need;
                if (ratio < overcapFactor && ratio < minRatio) {
                    minRatio = ratio;
                    target = pos.positionName;
                }
            }
        }
        if (target) {
            positionGroups[target].push(emp.id);
            empAssignedTo[emp.id] = target;
        } else {
            empAssignedTo[emp.id] = null; // capacidad ociosa real
        }
    }

    // ── SURPLUS: mover empleados sobrantes a capacidad ociosa real ──────────
    // Si hay más empleados en un grupo que los que el ciclo necesita
    // (peopleNeededWithCycle), los sobrantes reales quedan ociosos y acumulan
    // todos los RETs del mes, en vez de repartirlos entre todo el grupo.
    for (const posName of Object.keys(positionGroups)) {
        const need = Math.max(1, positionNeed[posName] || 1);
        const group = positionGroups[posName];
        if (group.length <= need) continue;
        // Ordenar por score ascendente: los de menor prioridad (más lejos, más ausencias)
        // son los candidatos para quedar ociosos. Los que tienen defaultPos fijo nunca se mueven.
        const byScore = [...group].sort((a, b) => empMeta[a].priorityScore - empMeta[b].priorityScore);
        let removed = 0;
        for (const empId of byScore) {
            if (group.length - removed <= need) break;
            if (defaultPos[empId] === posName) continue; // owner fijo nunca se saca
            const idx = group.indexOf(empId);
            if (idx >= 0) group.splice(idx, 1);
            empAssignedTo[empId] = null;
            removed++;
        }
    }

    // ── INFERENCIA DE OWNER VIRTUAL ──
    // Si un puesto singular (qty=1) tiene UN solo empleado en su grupo y ese
    // empleado no tiene defaultPos cargado desde la UI, lo marcamos como owner
    // virtual. Esto activa la consolidación-por-owner aun cuando el usuario no
    // configuró `puestoPredeterminado` manualmente (caso Romina/Goyochea).
    Object.entries(positionGroups).forEach(([posName, empIds]) => {
        const pos = ctx.positions.find((p) => p.positionName === posName);
        if (!pos) return;
        const qty = Math.max(1, Number(pos.qty) || 1);
        if (qty !== 1) return;
        if (empIds.length !== 1) return;
        const onlyEmp = empIds[0];
        if (!defaultPos[onlyEmp]) {
            defaultPos[onlyEmp] = posName;
        }
    });

    // ── PASO 2: Anillo de turnos + offset de ciclo + fase de rotación semanal ──
    // Cada puesto define un anillo ordenado (p.ej. M→T→N). Cada empleado tiene
    // `empRotationSlot` (0..n-1) para arrancar desfasado; la banda del día se
    // obtiene con ROTACIÓN SEMANAL: `ring[(slot + weekIdx) % len]` así la gente
    // no queda todo el mes en la misma letra.
    // Dentro de cada subgrupo del mismo código base del mes (semana 0), se
    // distribuyen offsets sobre cycleLen para que los francos no caigan el mismo día.
    const empPrimaryShift: Record<string, string | null> = {};
    const empGroupIdx: Record<string, number> = {};
    const shiftRingByPosition: Record<string, string[]> = {};
    const empRotationSlot: Record<string, number> = {};
    // Ciclo por empleado: D12/N12 → 4+2 (cycleLen=6, cL=4); M/T/N → ciclo 8h global.
    const empCycleLen: Record<string, number> = {};
    const empCL_map: Record<string, number> = {};
    const shouldRotate = ctx.rotateShifts !== false; // default true
    const expectedShiftForDay = (empId: string, dateStr: string, posName: string): string | null => {
        const ring = shiftRingByPosition[posName];
        if (!ring || ring.length === 0) return empPrimaryShift[empId];
        const slot = empRotationSlot[empId] ?? 0;
        if (ring.length === 1 || !shouldRotate) return ring[slot % ring.length];
        // Rotación POR CICLO: la banda avanza cada vez que completa un ciclo completo.
        // Patrón resultante: MMMMMM FF TTTTTT FF NNNNNN FF MMMMMM …
        // cycleNum = cuántos ciclos completos han pasado para este empleado.
        const eCycleLen = empCycleLen[empId] ?? cycleLen;
        const offset = empGroupIdx[empId] ?? 0;
        const di = parseInt(dateStr.split('-')[2], 10) - 1; // 0-based desde día 1 del mes
        const cycleNum = Math.floor((di + offset) / eCycleLen);
        return ring[(slot + cycleNum) % ring.length];
    };

    Object.entries(positionGroups).forEach(([posName, empIds]) => {
        const pos = ctx.positions.find((p) => p.positionName === posName);
        if (!pos) return;
        const sampleDay = ctx.daysInMonth.find((d) => positionIsActiveOn(pos, ctx.getDayLetter(ctx.getDateKey(d))));
        const sampleLetter = sampleDay ? ctx.getDayLetter(ctx.getDateKey(sampleDay)) : 'L';
        const refShifts = effectiveShiftsForPositionDay(pos, sampleLetter, ctx.autoCycles);
        const shiftCodes = refShifts.map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
        shiftRingByPosition[posName] = shiftCodes;
        if (shiftCodes.length === 0) {
            empIds.forEach((empId, idx) => { empGroupIdx[empId] = idx; empPrimaryShift[empId] = null; });
            return;
        }
        // Asignación de turno primario (rota semanalmente) por índice.
        empIds.forEach((empId, idx) => {
            const code = shiftCodes[idx % shiftCodes.length];
            empPrimaryShift[empId] = code; // semana 0 (referencia para stats)
            empRotationSlot[empId] = idx % shiftCodes.length;
        });
        // Offsets de franco: separados por tipo de turno (8h vs 12h) para que
        // cada subgrupo tenga offsets distribuidos sobre SU propio cycleLen.
        // cF≥2 → evitar offset=cycleLen-1 (causa franco huérfano al inicio del mes).
        const empIds8h = empIds.filter(id => !(has4x2 && (SHIFT_HRS_DEFAULT[(empPrimaryShift[id] || '').toUpperCase()] ?? 8) >= 12));
        const empIds12h = empIds.filter(id => has4x2 && (SHIFT_HRS_DEFAULT[(empPrimaryShift[id] || '').toUpperCase()] ?? 8) >= 12);
        const assignOffsets = (group: string[], eCL: number, eCF: number) => {
            const eCycleLen = eCL + eCF;
            const modBase = eCF >= 2 ? eCycleLen - 1 : eCycleLen; // evitar offset huérfano
            group.forEach((empId, idx) => {
                const offset = Math.floor((idx * eCycleLen) / Math.max(1, group.length)) % modBase;
                empGroupIdx[empId] = offset;
                empCycleLen[empId] = eCycleLen;
                empCL_map[empId] = eCL;
            });
        };
        assignOffsets(empIds8h, cL, cF);
        assignOffsets(empIds12h, 4, 2); // 4+2 siempre
    });

    // ── PASO 3: Días "de trabajo" del ciclo por empleado ────────────────
    //  - Asignado a puesto que NO opera todos los días de la semana (ej. EN L-V, RON L-V):
    //    días de trabajo = días en que el puesto opera. S/D que el puesto no opera → F automático.
    //    La detección es dinámica vía positionIsActiveOn (cubre activeDays + shifts[].days).
    //  - Asignado a puesto 24/7 → ciclo genérico (cL+cF) con offset = groupIdx.
    //  - Idle (sin puesto) → ciclo genérico para que F y RET respeten la proporción del ciclo.
    const positionOperatesAllWeek = (pos: V2PositionDef): boolean => {
        const letters = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        return letters.every((l) => positionIsActiveOn(pos, l));
    };
    const cycleWorkDays: Record<string, Set<string>> = {};
    ctx.employees.forEach((emp, globalIdx) => {
        const set = new Set<string>();
        const assignedPosName = empAssignedTo[emp.id];
        const assignedPos = assignedPosName ? ctx.positions.find((p) => p.positionName === assignedPosName) : null;
        const isLimitedPos = !!assignedPos && !positionOperatesAllWeek(assignedPos);
        if (isLimitedPos && assignedPos) {
            ctx.daysInMonth.forEach((day) => {
                const dayLetter = ctx.getDayLetter(ctx.getDateKey(day));
                if (positionIsActiveOn(assignedPos, dayLetter)) set.add(ctx.getDateKey(day));
            });
        } else {
            const eCycleLen = empCycleLen[emp.id] ?? cycleLen;
            const eCL = empCL_map[emp.id] ?? cL;
            const offset = (empGroupIdx[emp.id] ?? globalIdx) % eCycleLen;
            ctx.daysInMonth.forEach((day, di) => {
                const slot = (di + offset) % eCycleLen;
                if (slot < eCL) set.add(ctx.getDateKey(day));
            });
        }
        cycleWorkDays[emp.id] = set;
    });

    // Empleados asignados a puestos con schedule acotado (L-V, custom).
    // Para ellos NO aplica el tope de días consecutivos del ciclo —
    // su patrón ya está fijo por la estructura del servicio.
    const limitedEmpIds = new Set<string>(
        ctx.employees
            .filter(emp => {
                const posName = empAssignedTo[emp.id];
                if (!posName) return false;
                const pos = ctx.positions.find(p => p.positionName === posName);
                return !!pos && !positionOperatesAllWeek(pos);
            })
            .map(emp => emp.id)
    );

    const assignments: V2Assignment[] = [];
    // Techo de horas facturables en la generación: el MÁXIMO entre vendidas y demanda
    // estructural del SLA en pantalla. Antes usábamos solo `contractedHours` cuando
    // existía, y si la grilla (puestos × bandas × días) pedía MÁS horas que las
    // vendidas, `billableCap` cortaba antes de llenar slots → huecos + muchos RET
    // y el encabezado mostraba "colchón" engañoso. Si vendés menos que lo que la
    // estructura implica, igual hay que poder cubrir la estructura (avisá en viabilidad).
    const contractedH = feasibility.metrics.contractedHours || 0;
    const structuralH = feasibility.metrics.structuralDemandHours || 0;
    const mergedBillableTarget =
        Math.max(contractedH, structuralH) ||
        feasibility.metrics.effectiveTargetHours ||
        0;

    const stats: V2GenerateStats = {
        totalAssignments: 0,
        totalBillableHours: 0,
        targetHours: mergedBillableTarget,
        uncoveredSlots: 0,
        employeeMonthlyHours: {},
        employeeCycleHours: { current: {}, next: {} },
        employeesOver200: [],
        positionGroups: { ...positionGroups },
        idleEmployeeIds: Object.entries(empAssignedTo).filter(([, v]) => v === null).map(([k]) => k),
        primaryShiftByEmp: { ...empPrimaryShift },
        suvicoWeekBillableOver48: [],
    };

    const runtime: Record<string, EmpRuntimeState> = {};
    ctx.employees.forEach((e) => {
        runtime[e.id] = {
            monthHours: 0,
            cycleCurrentUsed: ctx.empMonthlyInitial[e.id] || 0,
            cycleNextUsed: 0,
            weekHours: {},
            lastWorkDate: null,
            lastShiftCode: null,
            lastShiftStart: null,
            lastShiftHours: null,
            assignedDays: new Set(),
        };
        stats.employeeMonthlyHours[e.id] = 0;
        stats.employeeCycleHours.current[e.id] = ctx.empMonthlyInitial[e.id] || 0;
        stats.employeeCycleHours.next[e.id] = 0;
    });

    // Helpers
    void stats.targetHours; // referencia para stats, no se usa como cap en la generación

    const parseHour = (s: string | undefined): number | null => {
        if (!s) return null;
        const m = String(s).match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) + Number(m[2]) / 60;
    };
    const passesAgreementRest = (empId: string, dateStr: string, shiftCode: string, curStartTime: string | undefined, curHrs: number): boolean => {
        const codeUp = String(shiftCode || '').toUpperCase();
        if (FRANCO_SET.has(codeUp)) return true;
        const hrs = Number(curHrs);
        if (!Number.isFinite(hrs) || hrs <= 0) return true;
        const defaultStart = DEFAULT_SHIFT_TIMES[codeUp] || '07:00';
        const startResolved = curStartTime || defaultStart;
        const getShift = (eid: string, ds: string): any | null => {
            const absMap = ctx.absences[eid];
            if (absMap?.has(ds)) return { code: absMap.get(ds), hours: 0, startTime: '00:00' };
            if (eid === empId && ds === dateStr) {
                return { code: codeUp, startTime: startResolved, hours: hrs };
            }
            const a = assignments.find((x) => x.empId === eid && x.dateStr === ds);
            if (!a) return null;
            const c = String(a.code || '').toUpperCase();
            // RET y francos no son turnos trabajados: deben reportar 0 horas
            const isNonWork = c === 'RET' || FRANCO_SET.has(c);
            return {
                code: c,
                startTime: a.startTime || (isNonWork ? '00:00' : DEFAULT_SHIFT_TIMES[c] || '07:00'),
                hours: isNonWork ? 0 : (Number(a.hours) || SHIFT_HRS_DEFAULT[c] || 8),
                endTime: (a as any).endTime,
            };
        };
        const empMaxCons = limitedEmpIds.has(empId) ? undefined : (empCL_map[empId] ?? cL);
        const empRestCfg: AgreementRestConfig = empMaxCons !== undefined
            ? { ...V2_AGREEMENT_REST_BASE, maxConsecutiveWorkDays: empMaxCons }
            : V2_AGREEMENT_REST_BASE;
        return (
            checkRestBetweenShifts({
                empId,
                targetDateStr: dateStr,
                proposed: { code: codeUp, startTime: startResolved, hours: hrs },
                getShift,
                cfg: empRestCfg,
            }) === null
        );
    };


    // Marcamos primero todas las ausencias como días asignados (no se planifica sobre ellas)
    for (const emp of ctx.employees) {
        const absSet = ctx.absences[emp.id];
        if (!absSet) continue;
        absSet.forEach((code, dateStr) => {
            runtime[emp.id].assignedDays.add(dateStr);
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code,
                name: code,
                hours: 0,
                startTime: '00:00',
            });
        });
    }

    const writeAssignment = (empId: string, dateStr: string, positionName: string, sCode: string, sName: string, sHrs: number, sStart: string, inCurrentCycle: boolean, sEnd?: string) => {
        const st = runtime[empId];
        const wkKey = isoWeekKey(new Date(dateStr));
        st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + sHrs;
        if (inCurrentCycle) {
            st.cycleCurrentUsed += sHrs;
            stats.employeeCycleHours.current[empId] = st.cycleCurrentUsed;
        } else {
            st.cycleNextUsed += sHrs;
            stats.employeeCycleHours.next[empId] = st.cycleNextUsed;
        }
        st.monthHours += sHrs;
        stats.employeeMonthlyHours[empId] = st.monthHours;
        st.lastWorkDate = dateStr;
        st.lastShiftCode = sCode;
        st.lastShiftStart = parseHour(sStart);
        st.lastShiftHours = sHrs;
        st.assignedDays.add(dateStr);
        const a: V2Assignment = { empId, dateStr, positionName, code: sCode, name: sName, hours: sHrs, startTime: sStart };
        if (sEnd) a.endTime = sEnd;
        assignments.push(a);
        stats.totalAssignments++;
        stats.totalBillableHours += sHrs;
    };

    // ── GENERACIÓN: loop único día×puesto×banda ──────────────────────────
    // Regla de oro: cada empleado trabaja SOLO su banda asignada todo el mes.
    // No hay cross-banda rescue. Los slots sin cobertura se reportan como vacantes.
    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        const inCurrentCycle = day.getDate() <= cutoffDay;

        for (const pos of ctx.positions) {
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);

            for (const sh of dayShifts) {
                const sCode = String(sh.code || '').toUpperCase();
                const sHrs = shiftHours(sh);
                const sStart = sh.startTime || DEFAULT_SHIFT_TIMES[sCode] || '07:00';
                const sEnd = sh.endTime || undefined;
                const sName = sh.name || sCode;

                // Solo empleados del grupo de ESTE puesto con ESTA banda asignada
                const group = positionGroups[pos.positionName] || [];
                const candidates = group.filter((empId) => {
                    if (runtime[empId].assignedDays.has(dateStr)) return false;
                    if (ctx.absences[empId]?.has(dateStr)) return false;
                    if (!cycleWorkDays[empId]?.has(dateStr)) return false;
                    const primary = expectedShiftForDay(empId, dateStr, pos.positionName);
                    if (primary && primary !== sCode) return false; // banda semanal
                    return true;
                });

                // Owner del puesto primero, luego por prioridad
                candidates.sort((a, b) => {
                    const ao = defaultPos[a] === pos.positionName ? 1 : 0;
                    const bo = defaultPos[b] === pos.positionName ? 1 : 0;
                    if (ao !== bo) return bo - ao;
                    return empMeta[b].priorityScore - empMeta[a].priorityScore;
                });

                let covered = 0;
                for (const empId of candidates) {
                    if (covered >= qty) break;
                    const st = runtime[empId];
                    const used = inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
                    if (used + sHrs > HARD_MAX_HOURS) continue;
                    if (!passesAgreementRest(empId, dateStr, sCode, sStart, sHrs)) continue;
                    writeAssignment(empId, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrentCycle, sEnd);
                    covered++;
                }

                if (covered < qty) {
                    stats.uncoveredSlots += qty - covered;
                }
            }
        }
    }

    const suvicoWeekBillableOver48: Array<{ empId: string; weekKey: string; hours: number }> = [];
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        // Puestos L–V con jornada >8h estructural: `WEEK_BILLABLE_HOURS_LIMITED_POSITION` evita falsos positivos.
        const weekCap = limitedEmpIds.has(emp.id)
            ? SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_LIMITED_POSITION
            : SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;
        for (const [weekKey, h] of Object.entries(st.weekHours)) {
            if (h > weekCap + 1e-6) {
                suvicoWeekBillableOver48.push({ empId: emp.id, weekKey, hours: Math.round(h * 10) / 10 });
            }
        }
    }
    stats.suvicoWeekBillableOver48 = suvicoWeekBillableOver48;

    // Días sobrantes:
    //   - Empleado IDLE (sin puesto asignado por capacidad ociosa): TODO el mes en RET o F,
    //     según ciclo. Nunca se mezcla con un turno facturable, así queda evidente que
    //     ese empleado está en stand-by todo el mes.
    //   - Empleado asignado a un puesto:
    //       · Día de franco del ciclo → F.
    //       · Día de trabajo del ciclo sin turno asignado (lo cubrió otro del grupo) → RET.
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        const ownerPosName = defaultPos[emp.id];
        const ownerPos = ownerPosName ? ctx.positions.find((p) => p.positionName === ownerPosName) : null;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;
            const dayLetter = ctx.getDayLetter(dateStr);
            // Salvaguarda: owner de puesto limitado en día NO operativo del puesto → F.
            const ownerLimitedInactive = !!ownerPos && !positionIsActiveOn(ownerPos, dayLetter);
            const isWorkDayInCycle = !ownerLimitedInactive && cycleWorkDays[emp.id]?.has(dateStr);
            // RET solo si la activación potencial no excedería 200h en el ciclo.
            const inCurrentCycleDay = day.getDate() <= cutoffDay;
            const usedInCycle = inCurrentCycleDay ? st.cycleCurrentUsed : st.cycleNextUsed;
            const primaryCode = (empPrimaryShift[emp.id] || 'M').toUpperCase();
            const retActivationHrs = SHIFT_HRS_DEFAULT[primaryCode] ?? 8;
            const retFitsInCycle = usedInCycle + retActivationHrs <= HARD_MAX_HOURS;
            const fallbackCode = isWorkDayInCycle && retFitsInCycle ? 'RET' : 'F';
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code: fallbackCode,
                name: fallbackCode === 'RET' ? 'Retén' : 'Franco',
                hours: 0,
                startTime: '00:00',
                isFranco: fallbackCode === 'F',
                isReten: fallbackCode === 'RET',
            });
            st.assignedDays.add(dateStr);
        }
    }


    // Empleados que pasaron 200h en el ciclo actual (no debería pasar pero auditamos)
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        if (st.cycleCurrentUsed > HARD_MAX_HOURS || st.cycleNextUsed > HARD_MAX_HOURS) {
            stats.employeesOver200.push(emp.id);
        }
    }

    // Acumulado de RETs por empleado (horas potenciales en stand-by)
    // RET no suma a horas trabajadas pero queremos mostrar en el reporte
    // cuántas horas "potenciales" tiene cada vigilador retenido.
    const empRetCount: Record<string, number> = {};
    for (const a of assignments) {
        if (a.code === 'RET' && a.empId) {
            empRetCount[a.empId] = (empRetCount[a.empId] || 0) + 1;
        }
    }
    const empRetHoursPotential: Record<string, number> = {};
    let totalRetCount = 0;
    for (const [empId, count] of Object.entries(empRetCount)) {
        empRetHoursPotential[empId] = count * RET_STANDBY_REFERENCE_HOURS;
        totalRetCount += count;
    }
    stats.employeeRetCount = empRetCount;
    stats.employeeRetHoursPotential = empRetHoursPotential;
    stats.totalRetCount = totalRetCount;
    stats.totalRetHoursPotential = totalRetCount * RET_STANDBY_REFERENCE_HOURS;

    return { feasibility, assignments, stats };
}

/**
 * Punto de entrada del motor V2 — fase viabilidad (no genera celdas todavía).
 * Usar `generateScheduleV2(ctx)` para obtener asignaciones.
 */
export function runAutoScheduleV2(ctx: V2EngineContext): V2EngineResult {
    const feasibility = checkFeasibility(ctx);
    return {
        feasibility,
        changes: {},
    };
}
