/**
 * Motor de cronograma automático V2 — "viabilidad primero".
 *
 * Reglas que asume:
 *  - La PLANIFICACIÓN de un objetivo se ve por MES CALENDARIO (1 → fin del mes).
 *  - El CONTROL de horas del empleado se hace por CICLO CCT (26 → 25 del mes siguiente).
 *  - Regla dura: ningún empleado puede superar HARD_MAX_HOURS (200h) en un ciclo CCT.
 *  - El target promedio (TARGET_AVG_HOURS = 192h) es informativo, no acota la oferta.
 *
 * Por eso la oferta de un empleado en el mes calendario se compone de DOS tramos:
 *   T1 (1 → cutoff, día 25 por defecto): pertenece al ciclo CCT que viene del 26 del mes anterior.
 *      Tope = 200h − cola CCT del mes anterior.
 *   T2 (cutoff+1 → fin del mes): pertenece al ciclo CCT siguiente, que arranca de cero.
 *      Tope = 200h (lo que quede sin usar se planifica el mes siguiente).
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

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET']);
const SHIFT_HRS_DEFAULT: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};
const CYCLE_SHIFT_DEFAULT: Record<string, number> = {
    '4+2': 12,
    '5+1': 8,
    '6+1': 8,
    '6+2': 8,
};
/** Tope target promedio por empleado / mes (CCT 422/05 ≈ 192h). */
export const TARGET_AVG_HOURS = 192;
/** Tope duro CCT 422/05 art. 7. */
export const HARD_MAX_HOURS = 200;
/**
 * Tope semanal blando: 60h.
 * El CCT marca 48h/semana, pero en seguridad es común tener turnos de 10h/12h en
 * jornadas L-V donde 5×10=50h superan 48 sin pasarse del techo de 200h/ciclo.
 * Mantenemos un tope al sólo efecto de evitar cargas extremas (>60h en 7 días);
 * la regla dura sigue siendo HARD_MAX_HOURS por ciclo CCT.
 */
const WEEKLY_SOFT_CAP = 60;

export interface V2ShiftDef {
    code: string;
    name?: string;
    hours?: number;
    startTime?: string;
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
    };
    perPosition: V2PositionDemand[];
    perEmployee: V2EmployeeOffer[];
}

export interface V2EngineResult {
    feasibility: V2FeasibilityReport;
    /** En esta iteración inicial siempre vacío (no pinta hasta que viabilidad esté firme). */
    changes: Record<string, any>;
}

/** Devuelve [cL, cF] del ciclo "más representativo" elegido por el usuario. */
function pickRepresentativeCycle(autoCycles: string[]): { key: string; cL: number; cF: number } {
    const ordered = ['6+1', '6+2', '5+1', '4+2'];
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

function shiftHours(s: V2ShiftDef): number {
    const code = String(s.code || '').toUpperCase();
    const h = Number(s.hours);
    if (Number.isFinite(h) && h > 0) return h;
    return SHIFT_HRS_DEFAULT[code] ?? 8;
}

function positionIsActiveOn(pos: V2PositionDef, dayLetter: string): boolean {
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

/** Devuelve true si entre los ciclos elegidos hay algún ciclo de 12h (4+2). */
function userHas12hCycles(autoCycles: string[] | undefined): boolean {
    if (!autoCycles || autoCycles.length === 0) return false;
    return autoCycles.some((k) => CYCLE_SHIFT_DEFAULT[k] === 12);
}
/** Devuelve true si entre los ciclos elegidos hay algún ciclo de 8h (5+1, 6+1, 6+2). */
function userHas8hCycles(autoCycles: string[] | undefined): boolean {
    if (!autoCycles || autoCycles.length === 0) return false;
    return autoCycles.some((k) => CYCLE_SHIFT_DEFAULT[k] === 8);
}

/**
 * Modalidades de cobertura del puesto un día:
 *  - M/T/N (8h) y D12/N12 (12h) son ALTERNATIVAS para cubrir 24h (no se suman).
 *  - La elección depende de qué ciclos pidió el usuario:
 *      - solo 8h (6+1/5+1/6+2) → bandas 8h; si el puesto solo tiene 12h, se cae a 12h (forzado).
 *      - solo 12h (4+2) → bandas 12h; si el puesto solo tiene 8h, se cae a 8h.
 *      - ambos → priorizamos 8h cuando hay bandas 8h disponibles; si no hay 8h, se usan las 12h.
 */
export function effectiveShiftsForPositionDay(
    pos: V2PositionDef,
    dayLetter: string,
    autoCycles?: string[]
): V2ShiftDef[] {
    if (!positionIsActiveOn(pos, dayLetter)) return [];
    const dayShifts = shiftsActiveOnDay(pos, dayLetter);
    if (dayShifts.length === 0) return [];
    const bands8 = dayShifts.filter((s) => shiftHours(s) < 12);
    const bands12 = dayShifts.filter((s) => shiftHours(s) >= 12);

    const wants12 = userHas12hCycles(autoCycles);
    const wants8 = userHas8hCycles(autoCycles);

    if (wants8 && !wants12) {
        if (bands8.length > 0) return bands8;
        return bands12;
    }
    if (wants12 && !wants8) {
        if (bands12.length > 0) return bands12;
        return bands8;
    }
    if (bands8.length > 0) return bands8;
    if (bands12.length > 0) return bands12;
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
        ctx.daysInMonth.forEach((d) => {
            const letter = ctx.getDayLetter(ctx.getDateKey(d));
            const dh = dayDemandHoursForPosition(pos, letter, ctx.autoCycles);
            if (dh > 0) {
                activeDays++;
                monthHours += dh;
                const peak = dayPeakConcurrentForPosition(pos, letter, ctx.autoCycles);
                if (peak > peakConcurrent) peakConcurrent = peak;
            }
        });
        // Dotación realista: cabezas necesarias para cubrir las horas mensuales del puesto
        // sumando el sobrecosto del ciclo (francos). Antes solo usábamos el pico simultáneo,
        // lo que subestimaba feo a los puestos 24/7 (M+T+N).
        // Si el puesto NO opera todos los días de la semana (ej. EN/RON L-V), el descanso
        // ya está incorporado: S/D son francos "naturales". No aplicamos cycleFactor en
        // ese caso para no inflar la dotación (1 persona alcanza para cubrir un L-V).
        const isLimitedSchedule = activeDays < ctx.daysInMonth.length;
        const factorForPosition = isLimitedSchedule ? 1 : cycleFactor;
        const peopleByHours = monthHours > 0 ? Math.ceil((monthHours / TARGET_AVG_HOURS) * factorForPosition) : 0;
        const peopleByPeak = Math.ceil(peakConcurrent * factorForPosition);
        const peopleNeededWithCycle = Math.max(peopleByHours, peopleByPeak);
        return {
            positionName: pos.positionName,
            monthHours,
            peakConcurrent,
            activeDays,
            peopleNeededWithCycle,
        };
    });

    const structuralDemandHours = perPosition.reduce((s, p) => s + p.monthHours, 0);
    const peakConcurrent = perPosition.reduce((s, p) => s + p.peakConcurrent, 0);
    const peopleNeededForStructure = perPosition.reduce((s, p) => s + p.peopleNeededWithCycle, 0);

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
    const defaultPos = ctx.defaultPositionByEmp || {};

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
    // Índice de semana ISO alineado a LUNES: dos días en la misma semana ISO
    // siempre devuelven el mismo número. Antes contábamos a partir del día 1
    // del mes, así que la "semana 0" arrancaba un miércoles cualquiera y el
    // corte mid-semana producía rotaciones raras.
    const monthStart = ctx.daysInMonth[0] ?? new Date();
    const mondayOf = (d: Date): Date => {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = (x.getDay() + 6) % 7; // 0=Mon ... 6=Sun
        x.setDate(x.getDate() - day);
        return x;
    };
    const baseMonday = mondayOf(monthStart);
    const weekIndexInMonth = (dateStr: string): number => {
        const d = new Date(dateStr + 'T12:00:00');
        const m = mondayOf(d);
        return Math.max(0, Math.round((m.getTime() - baseMonday.getTime()) / (7 * 86400000)));
    };
    const expectedShiftForDay = (empId: string, dateStr: string, posName: string): string | null => {
        const ring = shiftRingByPosition[posName];
        if (!ring || ring.length === 0) return empPrimaryShift[empId];
        const slot = empRotationSlot[empId] ?? 0;
        const wk = weekIndexInMonth(dateStr);
        return ring[(slot + wk) % ring.length];
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
        // Offsets de franco: distribuidos SOBRE TODO EL GRUPO del puesto.
        // Antes los repartíamos por subgrupo de shift (M/T/N), lo que hacía que
        // cada subgrupo arrancara en offset 0 → solapamiento de francos el mismo
        // día (causando columnas con 6 francos simultáneos y cobertura 5/6).
        // Ahora cada empleado del puesto cae en un offset distinto, garantizando
        // francos escalonados a lo largo del ciclo (cL+cF).
        const groupSize = empIds.length;
        empIds.forEach((empId, idx) => {
            const offset = Math.floor((idx * cycleLen) / Math.max(1, groupSize)) % cycleLen;
            empGroupIdx[empId] = offset;
        });
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
            const offset = (empGroupIdx[emp.id] ?? globalIdx) % cycleLen;
            ctx.daysInMonth.forEach((day, di) => {
                const slot = (di + offset) % cycleLen;
                if (slot < cL) set.add(ctx.getDateKey(day));
            });
        }
        cycleWorkDays[emp.id] = set;
    });

    const assignments: V2Assignment[] = [];
    const stats: V2GenerateStats = {
        totalAssignments: 0,
        totalBillableHours: 0,
        targetHours: feasibility.metrics.contractedHours || feasibility.metrics.structuralDemandHours,
        uncoveredSlots: 0,
        employeeMonthlyHours: {},
        employeeCycleHours: { current: {}, next: {} },
        employeesOver200: [],
        positionGroups: { ...positionGroups },
        idleEmployeeIds: Object.entries(empAssignedTo).filter(([, v]) => v === null).map(([k]) => k),
        primaryShiftByEmp: { ...empPrimaryShift },
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
    const targetHours = stats.targetHours;
    const tolerance = 1.05; // permitimos 5% sobre objetivo si así cierra la cobertura
    const billableCap = targetHours > 0 ? targetHours * tolerance : Infinity;

    const parseHour = (s: string | undefined): number | null => {
        if (!s) return null;
        const m = String(s).match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) + Number(m[2]) / 60;
    };
    const respectsRest = (
        st: EmpRuntimeState,
        dateStr: string,
        shiftCode: string,
        curStartTime?: string,
        curHrs?: number,
    ): boolean => {
        if (!st.lastWorkDate || !st.lastShiftCode) return true;
        const prev = new Date(st.lastWorkDate); prev.setHours(0, 0, 0, 0);
        const cur = new Date(dateStr); cur.setHours(0, 0, 0, 0);
        const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);
        if (diffDays >= 2) return true; // siempre OK si pasó >=1 día completo
        // Día consecutivo: usar startTime/duración reales si están disponibles.
        // Códigos no estándar (EN/RO/etc.) caen al fallback solo si no tenemos data.
        const lastStart = st.lastShiftStart != null ? st.lastShiftStart : (SHIFT_START_HOUR[st.lastShiftCode] ?? 6);
        const lastDur = st.lastShiftHours != null ? st.lastShiftHours : 8;
        const lastEnd = (lastStart + lastDur) % 24;
        const curStart = parseHour(curStartTime) ?? SHIFT_START_HOUR[shiftCode] ?? 6;
        const overnight = (lastStart + lastDur) >= 24;
        const gap = overnight
            ? ((curStart - lastEnd) + 24) % 24
            : ((curStart - lastEnd) + 24) % 24;
        // 12h CCT 422/05; permitimos 8h cuando el turno previo fue corto (≤6h)
        const required = (lastDur <= 6) ? 8 : 12;
        // marcar curHrs como usado (signatura mantenida para futuros chequeos)
        void curHrs;
        return gap >= required;
    };

    // pickEmployee — solo considera empleados del grupo del puesto y con primaryShift
    // coincidente. Si nadie del grupo encaja (p.ej. todos están en franco ese día),
    // permitimos un fallback dentro del mismo puesto con OTRO primaryShift (cobertura
    // de relevo). Empleados fuera del grupo (asignados a otro puesto o idle) nunca
    // toman turnos: así evitamos los RET salpicados.
    const pickEmployee = (
        dateStr: string,
        shiftCode: string,
        shiftHrs: number,
        positionName: string,
        inCurrentCycle: boolean,
        shiftStart?: string,
    ): string | null => {
        const groupIds = positionGroups[positionName] || [];
        if (groupIds.length === 0) return null;
        let bestPrimary: { id: string; score: number } | null = null;
        let bestRelief: { id: string; score: number } | null = null;
        for (const empId of groupIds) {
            const st = runtime[empId];
            if (st.assignedDays.has(dateStr)) continue;
            if (ctx.absences[empId]?.has(dateStr)) continue;
            if (!cycleWorkDays[empId]?.has(dateStr)) continue;
            const used = inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
            if (used + shiftHrs > HARD_MAX_HOURS) continue;
            const wkKey = isoWeekKey(new Date(dateStr));
            if ((st.weekHours[wkKey] || 0) + shiftHrs > WEEKLY_SOFT_CAP) continue;
            if (!respectsRest(st, dateStr, shiftCode, shiftStart, shiftHrs)) continue;

            const meta = empMeta[empId];
            const spareHard = HARD_MAX_HOURS - used - shiftHrs;
            const loadScore = Math.min(14, Math.max(0, spareHard / 4));
            // Priorizar quienes ya van ~192h pero aún tienen cupo hasta 200h en el ciclo
            // (evita dejar huecos 5/6 con gente en RET a 192h).
            const bufferBoost = used >= TARGET_AVG_HOURS && spareHard >= 0 ? 24 : 0;
            // Dueño del puesto (defaultPositionByEmp): SIEMPRE gana sobre refuerzos.
            // Bonus enorme para que no le roben turnos los flotantes asignados como overcap.
            const ownerBonus = defaultPos[empId] === positionName ? 10000 : 0;
            const baseScore = meta.priorityScore + loadScore + bufferBoost + ownerBonus;

            const expected = expectedShiftForDay(empId, dateStr, positionName);
            const isPrimary = expected === shiftCode;
            if (isPrimary) {
                if (!bestPrimary || baseScore > bestPrimary.score) bestPrimary = { id: empId, score: baseScore };
            } else {
                // Relief MUY penalizado: queremos que la rotación semanal M/T/N domine
                // sobre la inercia. Si el primary no entra hoy, el slot quedará uncovered
                // y se resolverá en el pase de relleno final (que ignora rotación).
                if (!bestRelief || baseScore > bestRelief.score) bestRelief = { id: empId, score: baseScore - 300 };
            }
        }
        return bestPrimary?.id || bestRelief?.id || null;
    };

    const objectiveName = ''; // lo llena el caller cuando arme el changes map
    void objectiveName;

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

    // Cola de slots uncovered para el rescue pass.
    type UncoveredSlot = { dateStr: string; positionName: string; sCode: string; sHrs: number; sStart: string; sName: string; inCurrentCycle: boolean };
    const uncoveredQueue: UncoveredSlot[] = [];

    const writeAssignment = (empId: string, dateStr: string, positionName: string, sCode: string, sName: string, sHrs: number, sStart: string, inCurrentCycle: boolean) => {
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
        assignments.push({ empId, dateStr, positionName, code: sCode, name: sName, hours: sHrs, startTime: sStart });
        stats.totalAssignments++;
        stats.totalBillableHours += sHrs;
    };

    // Recorremos día a día y vamos llenando slots por puesto/turno
    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        const inCurrentCycle = day.getDate() <= cutoffDay;

        for (const pos of ctx.positions) {
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            // Una sola modalidad por día (8h o 12h) en función del/los ciclo(s) elegidos.
            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);

            for (const sh of dayShifts) {
                const sCode = String(sh.code || '').toUpperCase();
                const sHrs = shiftHours(sh);
                const sStart = sh.startTime || DEFAULT_SHIFT_TIMES[sCode] || '07:00';
                const sName = sh.name || sCode;

                for (let slot = 0; slot < qty; slot++) {
                    if (stats.totalBillableHours + sHrs > billableCap) {
                        uncoveredQueue.push({ dateStr, positionName: pos.positionName, sCode, sHrs, sStart, sName, inCurrentCycle });
                        continue;
                    }
                    const empId = pickEmployee(dateStr, sCode, sHrs, pos.positionName, inCurrentCycle, sStart);
                    if (!empId) {
                        uncoveredQueue.push({ dateStr, positionName: pos.positionName, sCode, sHrs, sStart, sName, inCurrentCycle });
                        continue;
                    }
                    writeAssignment(empId, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrentCycle);
                }
            }
        }
    }

    // ── RESCUE PASS ─────────────────────────────────────────────────────
    // Si quedaron slots sin cubrir, intentamos rescatarlos con cualquier empleado
    // disponible ese día (incluyendo idles que iban a quedar en RET). El idle pasa
    // a integrarse al puesto y se le asigna un primaryShift, así sus otros días
    // siguen ordenados (no quedan turnos sueltos en mosaicos como antes).
    const isCandidateForRescue = (empId: string, slot: UncoveredSlot): boolean => {
        const st = runtime[empId];
        if (st.assignedDays.has(slot.dateStr)) return false;
        if (ctx.absences[empId]?.has(slot.dateStr)) return false;
        if (!cycleWorkDays[empId]?.has(slot.dateStr)) return false;
        const used = slot.inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
        if (used + slot.sHrs > HARD_MAX_HOURS) return false;
        const wkKey = isoWeekKey(new Date(slot.dateStr));
        if ((st.weekHours[wkKey] || 0) + slot.sHrs > WEEKLY_SOFT_CAP) return false;
        if (!respectsRest(st, slot.dateStr, slot.sCode, slot.sStart, slot.sHrs)) return false;
        return true;
    };

    for (const slot of uncoveredQueue) {
        if (stats.totalBillableHours + slot.sHrs > billableCap) {
            stats.uncoveredSlots++;
            continue;
        }
        let best: { id: string; score: number } | null = null;
        for (const emp of ctx.employees) {
            if (!isCandidateForRescue(emp.id, slot)) continue;
            const assignedTo = empAssignedTo[emp.id];
            // Regla dura: empleados con puesto fijo (defaultPositionByEmp) NUNCA se mueven
            // a otro puesto, ni siquiera para rescate. La asignación operativa manda.
            if (defaultPos[emp.id] && defaultPos[emp.id] !== slot.positionName) continue;
            // 1) Idle puro: candidato fuerte para rescate.
            // 2) Mismo puesto: ya lo intentamos como relief en el primer pase, pero
            //    podemos retentar si tiene horas libres.
            // 3) Otro puesto (sin puesto fijo): último recurso.
            let bias = 0;
            if (assignedTo === null) bias = 30;
            else if (assignedTo === slot.positionName) bias = 10;
            else bias = -40;
            const meta = empMeta[emp.id];
            const st = runtime[emp.id];
            const used = slot.inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
            const spareHard = HARD_MAX_HOURS - used - slot.sHrs;
            const bufferBoost = used >= TARGET_AVG_HOURS && spareHard >= 0 ? 28 : 0;
            const loadScore = Math.min(14, Math.max(0, spareHard / 4));
            const targetScore = bufferBoost + loadScore;
            const score = bias + meta.priorityScore + targetScore;
            if (!best || score > best.score) best = { id: emp.id, score };
        }
        if (best) {
            writeAssignment(best.id, slot.dateStr, slot.positionName, slot.sCode, slot.sName, slot.sHrs, slot.sStart, slot.inCurrentCycle);
            // Si era idle, lo convertimos en miembro del grupo y le marcamos primaryShift
            // para que el resto del mes siga con turnos coherentes (no salpicado).
            if (empAssignedTo[best.id] === null) {
                empAssignedTo[best.id] = slot.positionName;
                (positionGroups[slot.positionName] ||= []).push(best.id);
                const ring = shiftRingByPosition[slot.positionName] || [];
                const wk = weekIndexInMonth(slot.dateStr);
                const ix = ring.indexOf(slot.sCode);
                if (ring.length > 0 && ix >= 0) {
                    empRotationSlot[best.id] = ((ix - wk) % ring.length + ring.length) % ring.length;
                }
                empPrimaryShift[best.id] = slot.sCode;
                // Si el puesto tiene días limitados (ej. RON L-V), alineamos los días
                // del idle a los días activos del puesto para que pueda seguir cubriendo
                // huecos en ese mismo puesto el resto del mes.
                const rescuedPos = ctx.positions.find((p) => p.positionName === slot.positionName);
                if (rescuedPos && !positionOperatesAllWeek(rescuedPos)) {
                    const newSet = new Set<string>();
                    ctx.daysInMonth.forEach((day) => {
                        const dl = ctx.getDayLetter(ctx.getDateKey(day));
                        if (positionIsActiveOn(rescuedPos, dl)) newSet.add(ctx.getDateKey(day));
                    });
                    cycleWorkDays[best.id] = newSet;
                }
            }
        } else {
            stats.uncoveredSlots++;
        }
    }

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
            const fallbackCode = isWorkDayInCycle ? 'RET' : 'F';
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

    // ── PROMOCIÓN RET → turno facturable (cierra 5/6 usando buffer hasta 200h/ciclo) ──
    const stripRetAssignment = (empId: string, dateStr: string): boolean => {
        const idx = assignments.findIndex(
            (a) => a.empId === empId && a.dateStr === dateStr && String(a.code || '').toUpperCase() === 'RET'
        );
        if (idx < 0) return false;
        assignments.splice(idx, 1);
        runtime[empId].assignedDays.delete(dateStr);
        return true;
    };
    const countBillableSlot = (posName: string, dateStr: string, sCode: string): number =>
        assignments.filter(
            (a) =>
                a.positionName === posName &&
                a.dateStr === dateStr &&
                String(a.code || '').toUpperCase() === sCode &&
                !FRANCO_SET.has(String(a.code || '').toUpperCase())
        ).length;

    let promoSafety = 0;
    while (promoSafety++ < 2000) {
        let progressed = false;
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
                    const sName = sh.name || sCode;
                    let have = countBillableSlot(pos.positionName, dateStr, sCode);
                    while (have < qty && stats.totalBillableHours + sHrs <= billableCap) {
                        const pool = positionGroups[pos.positionName] || [];
                        let best: { id: string; score: number } | null = null;
                        for (const empId of pool) {
                            const st = runtime[empId];
                            if (!st.assignedDays.has(dateStr)) continue;
                            const hasRet = assignments.some(
                                (a) => a.empId === empId && a.dateStr === dateStr && String(a.code || '').toUpperCase() === 'RET'
                            );
                            if (!hasRet) continue;
                            if (ctx.absences[empId]?.has(dateStr)) continue;
                            if (!cycleWorkDays[empId]?.has(dateStr)) continue;
                            const used = inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
                            if (used + sHrs > HARD_MAX_HOURS) continue;
                            const wkKey = isoWeekKey(new Date(dateStr));
                            if ((st.weekHours[wkKey] || 0) + sHrs > WEEKLY_SOFT_CAP) continue;
                            if (!respectsRest(st, dateStr, sCode, sStart, sHrs)) continue;
                            const spare = HARD_MAX_HOURS - used - sHrs;
                            const boost = used >= TARGET_AVG_HOURS && spare >= 0 ? 30 : 0;
                            const ownerBonus = defaultPos[empId] === pos.positionName ? 10000 : 0;
                            const sc = ownerBonus + boost + Math.min(12, spare / 2) + empMeta[empId].priorityScore * 0.01;
                            if (!best || sc > best.score) best = { id: empId, score: sc };
                        }
                        if (!best) break;
                        if (!stripRetAssignment(best.id, dateStr)) break;
                        writeAssignment(best.id, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrentCycle);
                        have++;
                        progressed = true;
                    }
                }
            }
        }
        if (!progressed) break;
    }

    // ── FILL FINAL: relleno slots descubiertos ignorando rotación ─────
    // Si después de la promoción RET→turno quedan slots de un puesto sin cubrir,
    // metemos a cualquier empleado disponible del grupo (sin importar rotación).
    // Solo se respetan reglas duras: ciclo, 200h, 60h/semana, descanso.
    let fillSafety = 0;
    while (fillSafety++ < 2000) {
        let filled = false;
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
                    const sName = sh.name || sCode;
                    let have = countBillableSlot(pos.positionName, dateStr, sCode);
                    while (have < qty && stats.totalBillableHours + sHrs <= billableCap) {
                        // Buscamos cualquier emp del grupo que pueda + ahora idles también.
                        const pool: string[] = [
                            ...(positionGroups[pos.positionName] || []),
                            ...ctx.employees.filter((e) => empAssignedTo[e.id] === null).map((e) => e.id),
                        ];
                        let best: { id: string; score: number } | null = null;
                        for (const empId of pool) {
                            const st = runtime[empId];
                            if (st.assignedDays.has(dateStr)) {
                                const hasRet = assignments.some(
                                    (a) => a.empId === empId && a.dateStr === dateStr && String(a.code || '').toUpperCase() === 'RET'
                                );
                                if (!hasRet) continue;
                            }
                            if (ctx.absences[empId]?.has(dateStr)) continue;
                            if (defaultPos[empId] && defaultPos[empId] !== pos.positionName) continue;
                            if (!cycleWorkDays[empId]?.has(dateStr)) continue;
                            const used = inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed;
                            if (used + sHrs > HARD_MAX_HOURS) continue;
                            const wkKey = isoWeekKey(new Date(dateStr));
                            if ((st.weekHours[wkKey] || 0) + sHrs > WEEKLY_SOFT_CAP) continue;
                            if (!respectsRest(st, dateStr, sCode, sStart, sHrs)) continue;
                            // Preferir owner del puesto, después menos horas (balanceo).
                            const ownerBonus = defaultPos[empId] === pos.positionName ? 100000 : 0;
                            const sc = ownerBonus + (-st.monthHours);
                            if (!best || sc > best.score) best = { id: empId, score: sc };
                        }
                        if (!best) break;
                        // Si tenía RET ese día, lo eliminamos antes de asignar el turno.
                        stripRetAssignment(best.id, dateStr);
                        writeAssignment(best.id, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrentCycle);
                        // Si era idle, lo enrolamos al grupo.
                        if (empAssignedTo[best.id] === null) {
                            empAssignedTo[best.id] = pos.positionName;
                            (positionGroups[pos.positionName] ||= []).push(best.id);
                            empPrimaryShift[best.id] = sCode;
                        }
                        have++;
                        filled = true;
                    }
                }
            }
        }
        if (!filled) break;
    }

    // ── CONSOLIDACIÓN POR OWNER: si el titular del puesto está en RET y un suplente
    // está cubriendo ese día, swap para que el owner agarre su turno. Esto exprime
    // mejor la capacidad del titular y reduce dispersión de horas.
    let ownerSwapSafety = 0;
    while (ownerSwapSafety++ < 1000) {
        let didOwnerSwap = false;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const inCurrentCycle = day.getDate() <= cutoffDay;
            for (const pos of ctx.positions) {
                const posName = pos.positionName;
                const owners = (positionGroups[posName] || []).filter((eid) => defaultPos[eid] === posName);
                if (owners.length === 0) continue;
                for (const ownerId of owners) {
                    const ownerHasRet = assignments.some(
                        (a) => a.empId === ownerId && a.dateStr === dateStr && String(a.code || '').toUpperCase() === 'RET'
                    );
                    if (!ownerHasRet) continue;
                    if (ctx.absences[ownerId]?.has(dateStr)) continue;
                    if (!cycleWorkDays[ownerId]?.has(dateStr)) continue;
                    // Buscar un suplente cubriendo ese puesto ese día
                    const suplente = assignments.find(
                        (a) => a.positionName === posName && a.dateStr === dateStr &&
                            !FRANCO_SET.has(String(a.code || '').toUpperCase()) &&
                            a.code !== 'RET' &&
                            a.empId !== ownerId &&
                            defaultPos[a.empId] !== posName
                    );
                    if (!suplente) continue;
                    const sCode = String(suplente.code || '').toUpperCase();
                    const sHrs = Number(suplente.hours) || 8;
                    const sStart = suplente.startTime || '07:00';
                    const stO = runtime[ownerId];
                    const usedO = inCurrentCycle ? stO.cycleCurrentUsed : stO.cycleNextUsed;
                    if (usedO + sHrs > HARD_MAX_HOURS) continue;
                    const wkKey = isoWeekKey(new Date(dateStr));
                    if ((stO.weekHours[wkKey] || 0) + sHrs > WEEKLY_SOFT_CAP) continue;
                    if (!respectsRest(stO, dateStr, sCode, sStart, sHrs)) continue;
                    // Saco al suplente
                    const supIdx = assignments.findIndex((a) => a === suplente);
                    if (supIdx < 0) continue;
                    assignments.splice(supIdx, 1);
                    const stS = runtime[suplente.empId];
                    stS.assignedDays.delete(dateStr);
                    if (inCurrentCycle) { stS.cycleCurrentUsed -= sHrs; stats.employeeCycleHours.current[suplente.empId] = stS.cycleCurrentUsed; }
                    else { stS.cycleNextUsed -= sHrs; stats.employeeCycleHours.next[suplente.empId] = stS.cycleNextUsed; }
                    stS.monthHours -= sHrs;
                    stats.employeeMonthlyHours[suplente.empId] = stS.monthHours;
                    stS.weekHours[wkKey] = Math.max(0, (stS.weekHours[wkKey] || sHrs) - sHrs);
                    stats.totalAssignments--;
                    stats.totalBillableHours -= sHrs;
                    // El suplente queda con RET o F según ciclo
                    if (cycleWorkDays[suplente.empId]?.has(dateStr)) {
                        assignments.push({ empId: suplente.empId, dateStr, positionName: '', code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', isReten: true });
                    } else {
                        assignments.push({ empId: suplente.empId, dateStr, positionName: '', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true });
                    }
                    stS.assignedDays.add(dateStr);
                    // Saco RET del owner
                    stripRetAssignment(ownerId, dateStr);
                    // Asigno el turno al owner
                    writeAssignment(ownerId, dateStr, posName, sCode, suplente.name || sCode, sHrs, sStart, inCurrentCycle);
                    didOwnerSwap = true;
                }
            }
        }
        if (!didOwnerSwap) break;
    }

    // ── BALANCE DE HORAS: redistribuye RET ↔ turno entre empleados del mismo puesto ─
    // Objetivo: que dentro de un grupo nadie tenga (>8h) menos que otro mientras
    // queden RETs intercambiables. No se modifica cobertura, solo se intercambia
    // un turno facturable de un empleado cargado por un RET de un empleado menos
    // cargado en el mismo puesto/día.
    const BALANCE_DELTA = 8; // h (un turno corto)
    let balanceSafety = 0;
    while (balanceSafety++ < 2000) {
        let swapped = false;
        for (const posName of Object.keys(positionGroups)) {
            const pool = positionGroups[posName];
            if (pool.length < 2) continue;
            const sortedByHours = [...pool].sort(
                (a, b) => (runtime[a].monthHours) - (runtime[b].monthHours)
            );
            for (let i = 0; i < sortedByHours.length; i++) {
                const lowId = sortedByHours[i];
                for (let j = sortedByHours.length - 1; j > i; j--) {
                    const highId = sortedByHours[j];
                    const diff = runtime[highId].monthHours - runtime[lowId].monthHours;
                    if (diff <= BALANCE_DELTA) break;
                    // Buscar un día donde lowId tenga RET y highId tenga un turno facturable
                    // en este puesto, y verificar que el swap respete reglas duras.
                    const lowRets = assignments.filter(
                        (a) => a.empId === lowId && String(a.code || '').toUpperCase() === 'RET'
                    );
                    let didSwap = false;
                    for (const ret of lowRets) {
                        const dateStr = ret.dateStr;
                        const highShift = assignments.find(
                            (a) => a.empId === highId && a.dateStr === dateStr &&
                                a.positionName === posName &&
                                !FRANCO_SET.has(String(a.code || '').toUpperCase())
                        );
                        if (!highShift) continue;
                        // Verificar reglas duras para lowId tomando el turno
                        const stL = runtime[lowId];
                        if (!cycleWorkDays[lowId]?.has(dateStr)) continue;
                        const sCode = String(highShift.code || '').toUpperCase();
                        const sHrs = Number(highShift.hours) || 8;
                        const sStart = highShift.startTime || '07:00';
                        const inCurrentCycle = new Date(dateStr + 'T12:00:00').getDate() <= cutoffDay;
                        const usedL = inCurrentCycle ? stL.cycleCurrentUsed : stL.cycleNextUsed;
                        if (usedL + sHrs > HARD_MAX_HOURS) continue;
                        const wkKey = isoWeekKey(new Date(dateStr));
                        if ((stL.weekHours[wkKey] || 0) + sHrs > WEEKLY_SOFT_CAP) continue;
                        // Simulamos liberación del highId para el check de rest del lowId
                        // (no es perfecto: respectsRest mira lastShift global del lowId).
                        if (!respectsRest(stL, dateStr, sCode, sStart, sHrs)) continue;

                        // OK: ejecutamos el swap.
                        // 1) Saco el turno del highId
                        const hiIdx = assignments.findIndex(
                            (a) => a.empId === highId && a.dateStr === dateStr && a.positionName === posName &&
                                String(a.code || '').toUpperCase() === sCode
                        );
                        if (hiIdx < 0) continue;
                        assignments.splice(hiIdx, 1);
                        const stH = runtime[highId];
                        stH.assignedDays.delete(dateStr);
                        if (inCurrentCycle) { stH.cycleCurrentUsed -= sHrs; stats.employeeCycleHours.current[highId] = stH.cycleCurrentUsed; }
                        else { stH.cycleNextUsed -= sHrs; stats.employeeCycleHours.next[highId] = stH.cycleNextUsed; }
                        stH.monthHours -= sHrs;
                        stats.employeeMonthlyHours[highId] = stH.monthHours;
                        stH.weekHours[wkKey] = (stH.weekHours[wkKey] || sHrs) - sHrs;
                        stats.totalAssignments--;
                        stats.totalBillableHours -= sHrs;
                        // 2) Saco el RET del lowId
                        const loIdx = assignments.findIndex(
                            (a) => a.empId === lowId && a.dateStr === dateStr && String(a.code || '').toUpperCase() === 'RET'
                        );
                        if (loIdx >= 0) {
                            assignments.splice(loIdx, 1);
                            stL.assignedDays.delete(dateStr);
                        }
                        // 3) Asigno el turno al lowId
                        writeAssignment(lowId, dateStr, posName, sCode, highShift.name || sCode, sHrs, sStart, inCurrentCycle);
                        // 4) Marco RET al highId ese día (queda con menos horas, igual disponible)
                        if (cycleWorkDays[highId]?.has(dateStr)) {
                            assignments.push({
                                empId: highId,
                                dateStr,
                                positionName: '',
                                code: 'RET',
                                name: 'Retén',
                                hours: 0,
                                startTime: '00:00',
                                isReten: true,
                            });
                        } else {
                            assignments.push({
                                empId: highId,
                                dateStr,
                                positionName: '',
                                code: 'F',
                                name: 'Franco',
                                hours: 0,
                                startTime: '00:00',
                                isFranco: true,
                            });
                        }
                        stH.assignedDays.add(dateStr);
                        didSwap = true;
                        swapped = true;
                        break;
                    }
                    if (didSwap) break;
                }
            }
        }
        if (!swapped) break;
    }

    // Empleados que pasaron 200h en el ciclo actual (no debería pasar pero auditamos)
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        if (st.cycleCurrentUsed > HARD_MAX_HOURS || st.cycleNextUsed > HARD_MAX_HOURS) {
            stats.employeesOver200.push(emp.id);
        }
    }

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
