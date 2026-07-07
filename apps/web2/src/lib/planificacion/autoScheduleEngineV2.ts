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
 *     (capacidad ociosa) los excedentes quedan sin turnos facturables; uno puede
 *     designarse RET (stand-by para otro objetivo), el resto F en días de ciclo.
 *   - Banda fija: en puestos con varios códigos (M/T/N o D12/N12), cada
 *     empleado queda TODO el mes en la misma banda que le corresponde por su slot
 *     en el grupo (E1→M, E2→T, E3→N…). No hay rotación entre ciclos.
 *   - El ciclo manda: cada empleado tiene un patrón fijo de trabajo/franco.
 *       · Puesto con días limitados (ej. EN L-V) → días de trabajo = días activos del puesto.
 *       · Puesto 24/7 / empleado idle → ciclo genérico (4+2, 6+1, etc.) con offset
 *         desfasado por índice del grupo para que los francos no caigan a la vez.
 *     NUNCA se asigna un turno en un día que el ciclo del empleado marca como franco.
 *     Días libres del ciclo → F (descanso legal 6+2, mín. 35 h entre turnos).
 *     Antes de cada bloque F: mínimo 48 h trabajadas = **6 turnos × 8 h** o **4 turnos × 12 h**;
 *     máximo **2** F consecutivos (`francoStreakGuard.ts` corrige F ilegales → RET).
 *     RET ≠ F: solo el guardia sobrante designado (1 por objetivo) lleva RET en días
 *     laborables del ciclo sin turno; el resto queda en F o sin celda.
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
import type { CctSchemeCalendarProjectionBlock } from './cctSchemeMonthlyProjection2026';
import { buildCctSchemeCalendarProjectionBlock } from './cctSchemeMonthlyProjection2026';
import { fillScheduleFromDemand, shouldUseDemandDrivenScheduling, fillDemandGapsBeforeFrancos, fillDemandGapsWithFlexibleCycle, forceCloseRemainingSlaGaps, rebalanceEqual24hsPositionGroups, seedDemandDrivenCycleFrancos, alignAssignmentsToPendulum, restoreRotativeCycleFrancos, ensureRotativeCellsAssigned, finalizeApretarDayAssignments, stripUnauthorizedRetAssignments, recomputeUncoveredStats, repairForbiddenAfterNightTransitions, assignUnassignedWorkDayEmployeesToGaps, repairPositionDayTripletGaps, tryAssignEmployeeToDayGap } from './demandDrivenSchedule';
import { fillCycleBaseRotativeAssignments } from './cycleBaseSchedule';
import { buildFixedBandPlan, assignFixedBandOffsets, computeFixedBandGlobalStagger, enforceFixedBandFrancoRetCap, isFixedBandIntensiveMode } from './fixedBandScheduleEngine';
import { enforceFrancoStreakRules } from './francoStreakGuard';
import { isApretarCronoDay, isApretarScheduleActive, isContingencyApretarDay, isModo12Day, getModo12Days, usesExpandedRetPool } from './objectiveCoverageDemand';
import { assignmentBreaksBandTransition, nextAssignmentBreaksBandTransition, normBand } from './rotativeBandGuard';

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

/** Único ciclo permitido: 6+2. D12/N12 se activan por Modo12 (ajustar + V/L/E), no por ciclo. */
const AUTO_CYCLE_PREFERENCE = ['6+2'] as const;
const AJUSTAR_CRONO_CYCLE_PREFERENCE = ['6+2'] as const;

function scoreAutoCycleFeasibility(feas: V2FeasibilityReport, cycleKey: string, ajustarCrono?: boolean): number {
    if (!feas.ok) {
        const cmp = feas.metrics.cycleComparison.find(c => c.cycleKey === cycleKey);
        const gap = (cmp?.structuralPeakPeople ?? 99) - feas.metrics.peopleAvailable;
        return -5000 - gap * 200 - feas.reasons.length * 50;
    }
    const cmp = feas.metrics.cycleComparison.find(c => c.cycleKey === cycleKey);
    const buffer = cmp?.bufferHours ?? 0;
    const hourMargin = feas.metrics.offerHours - feas.metrics.effectiveTargetHours;
    const idle = feas.metrics.idleEmployees ?? 0;
    if (ajustarCrono) {
        const intensiveBonus = cycleKey === '4+2' ? 55 : cycleKey === '5+1' ? 35 : cycleKey === '6+1' ? 18 : 0;
        const softPenalty = cycleKey === '6+2' ? -80 : 0;
        return buffer + hourMargin * 0.25 - idle * 8 + intensiveBonus + softPenalty;
    }
    const d12Penalty = cycleKey === '4+2' ? 40 : 0;
    const spiritBonus = cycleKey === '6+2' ? 25 : cycleKey === '5+1' ? 10 : 0;
    return buffer + hourMargin * 0.3 - idle * 15 - d12Penalty + spiritBonus;
}

/**
 * Elige el esquema de ciclo más conveniente para la dotación y el SLA.
 * Regla COSP: el primer esquema VIABLE en orden de preferencia (6+2 → 5+1 → 6+1).
 * 4+2 (D12/N12) solo si ningún ciclo de 8h cierra la estructura.
 * Con `ajustarCrono`: invierte preferencia (4+2 → 5+1 → 6+1; no elige 6+2 si hay alternativa).
 */
export function pickOptimalAutoCycles(ctx: V2EngineContext): {
    cycles: string[];
    feasibility: V2FeasibilityReport;
    pickedKey: string;
    evaluated: Array<{ cycleKey: string; ok: boolean; score: number }>;
    ajustarCrono?: boolean;
    recommendedAlternative?: string;
} {
    const ajustarCrono = ctx.ajustarCrono === true;

    // Ciclo forzado externamente (override desde UI): usar directamente sin auto-selección
    if (ctx.autoCycles && ctx.autoCycles.length > 0) {
        const key = ctx.autoCycles[0];
        const feas = checkFeasibility({ ...ctx, autoCycles: [key] });
        return {
            cycles: [key],
            feasibility: feas,
            pickedKey: key,
            ajustarCrono,
            evaluated: [{ cycleKey: key, ok: feas.ok, score: Math.round(scoreAutoCycleFeasibility(feas, key, ajustarCrono)) }],
            recommendedAlternative: undefined,
        };
    }

    const evaluated = AUTO_CYCLE_PREFERENCE.map((key) => {
        const feas = checkFeasibility({ ...ctx, autoCycles: [key] });
        return { cycleKey: key, ok: feas.ok, score: scoreAutoCycleFeasibility(feas, key, ajustarCrono), feas };
    });
    const eightHour = new Set(['6+2', '6+1']);
    const intensiveSet = new Set<string>(AJUSTAR_CRONO_CYCLE_PREFERENCE);
    const firstViableIntensive = ajustarCrono
        ? evaluated.find(e => e.ok && intensiveSet.has(e.cycleKey))
        : undefined;
    const firstViable8h = !ajustarCrono
        ? evaluated.find(e => e.ok && eightHour.has(e.cycleKey))
        : undefined;
    const firstViableAny = evaluated.find(e => e.ok);
    const pick = firstViableIntensive ?? firstViable8h ?? firstViableAny ?? [...evaluated].sort((a, b) => b.score - a.score)[0];

    return {
        cycles: [pick.cycleKey],
        feasibility: pick.feas,
        pickedKey: pick.cycleKey,
        ajustarCrono,
        recommendedAlternative: undefined,
        evaluated: evaluated.map(e => ({ cycleKey: e.cycleKey, ok: e.ok, score: Math.round(e.score) })),
    };
}

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

export function hardMaxForCtx(ctx?: Pick<V2EngineContext, 'cctMaxBillableHours'>): number {
    const n = ctx?.cctMaxBillableHours;
    return typeof n === 'number' && n > 0 ? n : HARD_MAX_HOURS;
}

export function targetAvgForCtx(ctx?: Pick<V2EngineContext, 'targetAvgHoursPerEmployee'>): number {
    const n = ctx?.targetAvgHoursPerEmployee;
    return typeof n === 'number' && n > 0 ? n : TARGET_AVG_HOURS;
}
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
    specificDates?: string[]; // YYYY-MM-DD: fechas puntuales (refuerzos), no recurrentes
}

export interface V2PositionDef {
    positionName: string;
    qty?: number;
    shifts?: V2ShiftDef[];
    activeDays?: string[]; // si <7, manda esta lista
    /** '24hs' = meta 24h × pax/día (no se suman variantes M/T/N + D12/N12). 'custom' u otro = suma de bandas o modalidad elegida. */
    coverageType?: string;
    /** Fechas YYYY-MM-DD sin servicio para este puesto. El guardia pasa a RET y no se exige cobertura. */
    excludedDates?: string[];
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
     * Cupo CCT vs mes de venta (dos calendarios):
     * - **Venta/SLA:** días 1→último del mes en pantalla → cobertura slot×día y horas vendidas.
     * - **Liquidación CCT:** tramo 26→25; en un mes calendario hay dos tramos:
     *   T1 = cola (26 mes anterior → día cutoff, default 25) + horas planificadas ≤200;
     *   T2 = días cutoff+1→fin del mes con tope 200 h nuevo (26→25 del mes siguiente).
     * - 'cct': respeta ambos; 'calendar': solo tope 200 h netas en el mes calendario.
     */
    budgetMode?: V2BudgetMode;
    /** Último día del tramo CCT T1 dentro del mes calendario en pantalla (default 25). */
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
    /**
     * Índice de día global (desde ancla fija) del día 1 del mes.
     * Permite péndulo M→T→N→T continuo mes a mes sin reiniciar en día 1.
     */
    monthStartGlobalDayIndex?: number;
    /**
     * Horas por código custom (RO, RON, etc.) según definición del SLA activo.
     * Fallback para `shiftHours` cuando el código no está en SHIFT_HRS_DEFAULT ni
     * la definición del turno trae `hours`/`startTime`/`endTime` válidos.
     */
    codeHoursHint?: Record<string, number>;
    /**
     * Días de trabajo consecutivos al final del mes anterior por empId.
     * Permite al motor calcular la fase de ciclo correcta para el día 1 del mes
     * y evitar rachas que crucen el límite de mes (ej. 3 días en mayo + 6 en junio = 9 seguidos).
     */
    prevMonthTrailingWorkDays?: Record<string, number>;
    /**
     * Días de franco consecutivos al final del mes anterior por empId.
     * Si > 0 y < cF: el empleado está a mitad de su bloque de descanso y junio arranca con franco.
     */
    prevMonthTrailingRestDays?: Record<string, number>;
    /** Código del último día del mes anterior (M/T/N/F…) — ancla ciclo 24d M→T→N. */
    prevMonthLastShiftByEmp?: Record<string, string>;
    /** Última banda M/T/N antes del bloque de F al cierre de mayo (si el 31 es F). */
    prevMonthLastWorkBandBeforeRest?: Record<string, string>;
    /** Slot de apertura del ciclo (0-23 en CYCLE_24_MTN) usado el mes anterior por empId. Fallback cuando
     *  Firestore no tiene datos del mes anterior (ej. mes generado pero no publicado). */
    prevMonthOpeningSlotByEmp?: Record<string, number>;
    /** Cantidad de días del mes anterior. Permite calcular la continuación exacta del ciclo. */
    prevMonthDaysCount?: number;
    /**
     * Mapa empId → código de turno fijo (M/T/N/D12/N12) asignado por el operador
     * desde el selector "puesto prefijado + turno". Si está presente, el empleado
     * trabajará ese turno todo el mes, sin importar el orden dentro del grupo.
     */
    defaultShiftByEmp?: Record<string, string>;
    /**
     * Semilla de variación para los offsets distribuidos (0..cycleLen-1).
     * Al probar múltiples seeds en el caller se pueden encontrar distribuciones de francos
     * que cierren la cobertura sin incidencias.
     */
    distributedOffsetSeed?: number;
    /**
     * Pool de empleados de la empresa que NO están asignados al objetivo en curso.
     * El motor V3 los usa como flotantes de último recurso (Fase 3) para cubrir slots
     * que quedan sin personal tras la pasada de regulares y FLEX.
     * No se les aplica cap CCT ni verificación de descanso; se los registra con el
     * código de turno del slot (M/T/N/etc.) en el objetivo pedido.
     */
    globalRetPool?: Array<{ id: string; nombre?: string; name?: string }>;
    /** Tope CCT facturable por ciclo (desde `planning_rules/{empresaId}`). */
    cctMaxBillableHours?: number;
    /** Target promedio informativo por empleado/mes (desde reglas de planificación). */
    targetAvgHoursPerEmployee?: number;
    /**
     * IDs de empleados autorizados por supervisor para superar el tope CCT de 200h.
     * El motor omite el chequeo `used + hrs > HARD_MAX_HOURS` para estos empleados.
     * El límite semanal de 48h sigue aplicando.
     */
    authorizedOver200Ids?: Set<string>;
    /**
     * Planificación demand-driven: llena slots SLA (M/T/N por puesto/día) antes de francos.
     * Default true si hay puestos 24hs.
     */
    demandDriven?: boolean;
    /** Offsets de ciclo tras rebalance demand-driven (0..perPos-1 por puesto). */
    demandDrivenStaggerByEmp?: Record<string, number>;
    /**
     * Ajustar crono: prioriza esquemas intensivos (4+2 / 5+1 / 6+1), mezcla por guardia,
     * maximiza RET stand-by para otros objetivos / eventos. No usa 6+2 si hay alternativa viable.
     */
    ajustarCrono?: boolean;
    /**
     * Días YYYY-MM-DD con demanda D12+N12 (ausencias V/L/E + contingencia).
     * Alias legacy: si falta `modo12Days`, se usa este array.
     */
    modo12Days?: string[];
    /** Subconjunto manual: pool RET / liberación. Ausencias auto no activan RET masivo. */
    contingencyApretarDays?: string[];
    /**
     * @deprecated Preferir `modo12Days`. Días D12+N12 (ausencias + contingencia).
     */
    apretarCronoDays?: string[];
    /**
     * Franco trabajado (F→turno): costo extra. Solo si true el motor puede promover F a turno
     * para cerrar huecos. Default false — Contingencia y ausencias usan Modo 12, no francos.
     */
    allowFrancoWorkedRescue?: boolean;
    /** Si true: 6+2 estricto — sin flex 5+1/6+1 ni F→turno agresivo en cierre SLA. */
    strictSixTwo?: boolean;
    /** Si true: todos los empleados usan el mismo ciclo global (sin mezcla 5+1/6+1). */
    noFlexSchemeEmployees?: boolean;
    /**
     * Etapa 3 pura: solo ciclo + péndulo + francos. Sin fillScheduleFromDemand ni forceClose SLA.
     */
    cycleBaseOnly?: boolean;
    /** Fase de offset 0..cycleLen-1 (solo bandas fijas; búsqueda de cobertura). */
    fixedBandOffsetPhase?: number;
    /** Escalonado global M/T/N (interno, bandas fijas). */
    fixedBandGlobalStaggerByEmp?: Record<string, number>;
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
        /** Comparativa de personas necesarias y buffer por esquema de ciclo (4+2, 5+1, 6+1, 6+2).
         *  hrsPerPerson = horas facturables reales tras aplicar el tope por turno:
         *    6+2 × 8h → 180h/mes (22.5d × 8h), 6+1 → 200h, 5+1 → 200h, 4+2 × 12h → 192h (16d × 12h). */
        cycleComparison: Array<{
            cycleKey: string;
            /** Personas en simultáneo en el pico estructural para este esquema. */
            structuralPeakPeople: number;
            /** Horas facturables REALES por empleado/mes (después del tope CCT por tipo de turno). */
            hrsPerPerson: number;
            /** Días de trabajo promedio por mes (puede ser decimal, ej. 22.5 para 6+2). */
            avgWorkDays: number;
            /** Horas del turno correspondiente al ciclo (8 ó 12). */
            shiftHours: number;
            bufferHours: number;
            retEstimate: number;
        }>;
        /**
         * Solo 2026: proyección calendario por esquemas seleccionados (tabla comparativa COSP).
         * Complementa el tope por ciclo CCT (26→25); no sustituye `empMonthlyInitial` ni la liquidación.
         */
        cctSchemeCalendarProjection?: CctSchemeCalendarProjectionBlock;
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
 *  Prefiere 6+2 (mayor descanso); 4+2 solo para ajustar/licencias. 6+1 y 5+1 eliminados. */
export function pickRepresentativeCycle(autoCycles: string[]): { key: string; cL: number; cF: number } {
    const ordered = ['6+2', '4+2'];
    for (const key of ordered) {
        if (autoCycles.includes(key)) {
            const [cL, cF] = CYCLE_MAP[key];
            return { key, cL, cF };
        }
    }
    return { key: '6+2', cL: 6, cF: 2 };
}

/**
 * Slot del ciclo 6+2 que debe tener el guardia el día 1 del mes, según racha de mayo.
 * tw = días consecutivos de trabajo al cierre; tr = días consecutivos de F al cierre.
 */
function openingCycleSlotFromMayTrail(
    empId: string,
    cL: number,
    cF: number,
    ctx: V2EngineContext,
): number | null {
    const tw = ctx.prevMonthTrailingWorkDays?.[empId];
    const tr = ctx.prevMonthTrailingRestDays?.[empId];
    if (tw !== undefined && tw > 0) {
        return tw >= cL ? cL : tw;
    }
    if (tr !== undefined && tr > 0) {
        return tr >= cF ? 0 : cL + tr;
    }
    return null;
}

function offsetFromOpeningCycleSlot(openingSlot: number, absDay: number, cycleLen: number): number {
    return ((openingSlot - absDay) % cycleLen + cycleLen) % cycleLen;
}

/**
 * Con N guardias y ciclo L días: ~N/L por offset → 4 francos/día en plantilla 16×6+2.
 * Sin esto, cada puesto repite el mismo offset y 8 guardias descansan el mismo día.
 */
function balanceGlobalCycleOffsets(
    pool: string[],
    empGroupIdx: Record<string, number>,
    cycleLen: number,
    hasTrailing?: (empId: string) => boolean,
): void {
    if (pool.length === 0 || cycleLen <= 0) return;
    const target = Math.max(1, Math.floor(pool.length / cycleLen));
    const buckets = new Map<number, string[]>();
    for (const id of pool) {
        const o = ((empGroupIdx[id] ?? 0) % cycleLen + cycleLen) % cycleLen;
        empGroupIdx[id] = o;
        if (!buckets.has(o)) buckets.set(o, []);
        buckets.get(o)!.push(id);
    }
    const pickMovable = (ids: string[]): string | undefined => {
        const idx = ids.findIndex(id => !hasTrailing?.(id));
        if (idx >= 0) return ids.splice(idx, 1)[0];
        // No mover empleados con datos de cola del mes anterior:
        // su offset fue derivado de la racha real y moverlos quiebra la continuidad CCT.
        return undefined;
    };
    for (let guard = 0; guard < pool.length * cycleLen; guard++) {
        let moved = false;
        for (let o = 0; o < cycleLen; o++) {
            const ids = buckets.get(o) || [];
            while (ids.length > target) {
                let placed = false;
                for (let t = 0; t < cycleLen; t++) {
                    const other = buckets.get(t) || [];
                    if (other.length >= target) continue;
                    const empId = pickMovable(ids);
                    if (!empId) break;
                    empGroupIdx[empId] = t;
                    other.push(empId);
                    buckets.set(t, other);
                    buckets.set(o, ids);
                    moved = true;
                    placed = true;
                    break;
                }
                if (!placed) break;
            }
        }
        if (!moved) break;
    }
}

/** Reserva flex por puesto: solo 4+2 para ajustar/licencias. 6+1 y 5+1 eliminados. */
function pickFlexSchemeEmployees(
    ctx: V2EngineContext,
    positionGroups: Record<string, string[]>,
    staggerByEmp: Record<string, number> | undefined,
): { sixOne: string[]; fiveOne: string[]; fourTwo: string[] } {
    const empty = { sixOne: [] as string[], fiveOne: [] as string[], fourTwo: [] as string[] };
    if (!ctx.ajustarCrono) return empty;
    if (ctx.strictSixTwo === true || ctx.noFlexSchemeEmployees === true) return empty;
    if (!shouldUseDemandDrivenScheduling(ctx) || ctx.rotateShifts === false) return empty;

    const fourTwo: string[] = [];
    for (const pos of ctx.positions) {
        const cov = String(pos.coverageType || '').toLowerCase();
        if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
        const group = positionGroups[pos.positionName] || [];
        group.forEach((empId, idxInGroup) => {
            const stagger = staggerByEmp?.[empId] ?? idxInGroup;
            if (stagger % 3 === 0 && !fourTwo.includes(empId)) fourTwo.push(empId);
        });
    }
    return { sixOne: [], fiveOne: [], fourTwo };
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

export function positionIsActiveOn(pos: V2PositionDef, dayLetter: string, dateStr?: string): boolean {
    // Turnos de fechas específicas activan el puesto solo en esas fechas
    if (dateStr && (pos.shifts || []).some(
        (s) => !isFrancoCode(s.code) && Array.isArray(s.specificDates) && s.specificDates.length > 0 && s.specificDates.includes(dateStr)
    )) return true;

    if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    // Excluir turnos de fechas específicas del cálculo de días-de-semana
    const workingShifts = (pos.shifts || []).filter(
        (s) => !isFrancoCode(s.code) && !(Array.isArray(s.specificDates) && s.specificDates!.length > 0)
    );
    const withDays = workingShifts.filter((s) => Array.isArray(s.days) && s.days!.length > 0);
    if (withDays.length === 0 || withDays.length < workingShifts.length) return true;
    return withDays.some((s) => s.days!.includes(dayLetter));
}

/** Bandas activas un día (sin francos). */
function shiftsActiveOnDay(pos: V2PositionDef, dayLetter: string, dateStr?: string): V2ShiftDef[] {
    return (pos.shifts || []).filter((s) => {
        if (isFrancoCode(s.code)) return false;
        // Turnos de fechas específicas: solo incluir si el dateStr coincide
        if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
            return dateStr ? s.specificDates.includes(dateStr) : false;
        }
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
    autoCycles?: string[],
    dateStr?: string,
): V2ShiftDef[] {
    if (!positionIsActiveOn(pos, dayLetter, dateStr)) return [];
    const dayShifts = shiftsActiveOnDay(pos, dayLetter, dateStr);
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
    const hardMax = hardMaxForCtx(ctx);
    const targetAvg = targetAvgForCtx(ctx);
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
        // Personas = (slots/día) × factorCiclo
        // slots/día = totalSlots / activeDays
        // NO usar monthHours / TARGET_AVG_HOURS × factor: ese cálculo sobre-estima (dobla el factor).
        // Ejemplo 24h qty=4: totalSlots=360, activeDays=30, factor=8/6 → ceil(12 × 1.33) = 16 ✓
        const peopleBySlots = activeDays > 0
            ? Math.ceil((totalSlots / activeDays) * factorForPosition)
            : 0;
        const peopleByPeak = Math.ceil(peakConcurrent * factorForPosition);
        const peopleNeededWithCycle = Math.max(peopleBySlots, peopleByPeak);
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
    const peopleNeededForTarget = Math.ceil(effectiveTargetHours / targetAvg);
    /** Heurística: con francos del ciclo a veces conviene +1 cabeza; no bloquea si ya cierran las horas. */
    const peopleSuggestedWithCycle = Math.ceil((effectiveTargetHours / targetAvg) * cycleFactor);

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
            const availableHours = Math.max(0, hardMax - absenceDays * 8);
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
        const remainingHardCurrent = Math.max(0, hardMax - priorHours);
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
        const availableNextCycle = Math.max(0, Math.min(hardMax, capacityNext));

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
            `Dotación insuficiente por horas: hacen falta al menos ${peopleNeededForTarget} personas con ~${targetAvg}h c/u para ${Math.round(effectiveTargetHours)}h y hay ${peopleAvailable}.`
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
            `Estos empleados van a quedar sin turnos facturables (como mucho 1 en RET stand-by; el resto en Franco).`
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

    const firstDay = ctx.daysInMonth[0];
    let cctSchemeCalendarProjection: CctSchemeCalendarProjectionBlock | undefined;
    if (firstDay) {
        const y = firstDay.getFullYear();
        const mo = firstDay.getMonth() + 1;
        const block = buildCctSchemeCalendarProjectionBlock(y, mo, ctx.autoCycles);
        if (block) {
            cctSchemeCalendarProjection = block;
            for (const line of block.messages) warnings.push(line);
        }
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
                // Días promedio EXACTOS (decimal): 6+2 → 22.5d, 4+2 → 20d, 5+1 → 25d.
                const avgWorkDays = (cLc / (cLc + cFc)) * ctx.daysInMonth.length;
                // Tope facturable por tipo de turno: 8h→200h (25d), 12h→192h (16d).
                // floor(MAX/shiftHrs)*shiftHrs evita fracciones: 200/12=16.67→16×12=192.
                const billableCap = Math.floor(hardMax / avgHrs) * avgHrs;
                const hrsPerPerson = Math.min(avgWorkDays * avgHrs, billableCap);
                const buffer = spp * hrsPerPerson - structuralDemandHours;
                return {
                    cycleKey: ck,
                    structuralPeakPeople: spp,
                    hrsPerPerson: Math.round(hrsPerPerson * 10) / 10,
                    avgWorkDays: Math.round(avgWorkDays * 10) / 10,
                    shiftHours: avgHrs,
                    bufferHours: Math.round(buffer),
                    retEstimate: Math.max(0, Math.floor(buffer / avgHrs)),
                };
            }),
            cctSchemeCalendarProjection,
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
    /** Empleados redistribuidos desde puestos con dotación insuficiente para el ciclo 6+2. */
    strandedEmployeeIds?: string[];
    /** Empleados movidos automáticamente desde su puesto asignado en legajos a otro puesto con déficit. */
    relocatedEmployeeIds?: string[];
    /** Slots sin cobertura por día: key=dateStr → lista de {positionName, code, missing}. */
    uncoveredSlotsByDay?: Record<string, { positionName: string; code: string; missing: number }[]>;
    /** Puestos con más empleados asignados que los necesarios según el ciclo. */
    excessPositionEmployees?: { positionName: string; assigned: number; needed: number; excess: number }[];
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
    /** F convertidos a RET por regla 48h (6×8 o 4×12) / máx. 2 F seguidos. */
    francoGuardConvertedToRet?: number;
    francoGuardRejectedMissing48h?: number;
    francoGuardRejectedOverTwoConsecutive?: number;
    totalRetHoursPotential?: number;
    /**
     * Semanas ISO (facturación acumulada en `writeAssignment`) por encima del umbral semanal
     * en `SUVICO_POLICY.ALERTS` (48h por defecto, 50h en puestos limitados).
     * Solo alerta operativa: el cumplimiento legal de racha + descanso prolongado
     * sigue validándose con `verifyScheduleCoverage` / `checkRestBetweenShifts`.
     */
    suvicoWeekBillableOver48?: Array<{ empId: string; weekKey: string; hours: number }>;
    /** Copia de `feasibility.metrics.cctSchemeCalendarProjection` tras generar (solo 2026 con datos). */
    cctSchemeCalendarProjection?: CctSchemeCalendarProjectionBlock;
    /** Horas que faltaron para igualar slaVendidas tras el pase de cierre (0 = cerró). */
    slaDeficitRemaining?: number;
    /** true si totalBillableHours alcanzó slaVendidas (±0.5h) y no hay slots sin cubrir. */
    slaHoursClosed?: boolean;
    /** Guardias con esquema 6+1 mezclado (resto en 6+2). */
    flexSchemeEmpIds?: string[];
    /** Esquema asignado por guardia en bandas fijas (6+2 / 6+1 / 5+1). */
    fixedBandSchemeByEmp?: Record<string, string>;
    /** Índice de apertura (0-23 en CYCLE_24_MTN) por empleado — solo motor fixedBandFloater. */
    openingSlotByEmp?: Record<string, number>;
    /** F convertidos en turno para cerrar SLA (6+2→6+1 puntual). */
    flexCycleRescues?: number;
    /** Modo ajustar crono activo en esta generación. */
    ajustarCrono?: boolean;
    /** Días con 2+ guardias RET simultáneos (señal de sobrecobertura). */
    overCoverageRetDays?: number;
    /** Máximo RET simultáneos en un solo día. */
    maxRetConcurrent?: number;
    /** Días con demanda D12+N12 aplicada en esta generación. */
    apretarCronoDays?: string[];
    flexSchemeRescues?: number;
}

export interface CapOverflowSlot {
    empId: string;
    dateStr: string;
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTime: string;
    endTime?: string;
}

export interface V2GenerateResult {
    feasibility: V2FeasibilityReport;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    /** Turnos bloqueados SOLO por el cap de 200h que pasarían el check CCT. Requieren autorización de supervisor. */
    capOverflowSlots: CapOverflowSlot[];
    /** Suma de slots sin cubrir (días × posición donde la dotación real < qty). 0 = cobertura cerrada. */
    coverageViolations: number;
}

const OVERNIGHT_CODES = new Set(['N', 'N12']);
const SHIFT_END_HOUR: Record<string, number> = { M: 14, T: 22, N: 6, D12: 19, N12: 7 };
const SHIFT_START_HOUR: Record<string, number> = { M: 6, T: 14, N: 22, D12: 7, N12: 19 };
const DEFAULT_SHIFT_TIMES: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };

const STANDARD_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);

/** EN/RO/etc.: titular cubre L–V; puede superar 200h. */
function isCustomCoverPosition(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    if (cov === '24hs' || cov === '24' || cov === '24h') return false;
    const working = (pos.shifts || []).filter(s => !FRANCO_SET.has(String(s.code ?? '').toUpperCase()));
    if (working.length === 0) return false;
    return working.every(s => !STANDARD_BANDS.has(String(s.code ?? '').toUpperCase()));
}

function findPrimary24hsPosition(positions: V2PositionDef[]): V2PositionDef | undefined {
    return positions.find(p => {
        const cov = String(p.coverageType || '').toLowerCase();
        return !isCustomCoverPosition(p) && (cov === '24hs' || cov === '24' || cov === '24h');
    });
}

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

/** Genera asignaciones respetando ciclo CCT (4+2, 6+1...), 200h/ciclo, ausencias y horas vendidas.
 *  V4 (alias generateScheduleV4): + D12/N12 por ausencia T; EN/RO titular + backup Puesto 24hs. */
export function generateScheduleV2(ctx: V2EngineContext): V2GenerateResult {
    const hardMax = hardMaxForCtx(ctx);
    const targetAvg = targetAvgForCtx(ctx);
    // Wrapper de shiftHours que usa ctx.codeHoursHint como fallback para códigos custom (RO, RON, etc.).
    const _hint = ctx.codeHoursHint || {};
    const shiftHoursH = (s: V2ShiftDef): number => {
        const code = String(s.code || '').toUpperCase();
        const h = Number(s.hours);
        if (Number.isFinite(h) && h > 0) return h;
        const start = parseShiftHourFloat(s.startTime);
        const end = parseShiftHourFloat(s.endTime);
        if (start !== null && end !== null) {
            let dur = end - start;
            if (dur <= 0) dur += 24;
            if (dur > 0 && dur <= 24) return dur;
        }
        return _hint[code] ?? SHIFT_HRS_DEFAULT[code] ?? 8;
    };

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
        empMeta[e.id] = { preferMatch, distanceKm, absenceRate, targetHours: targetAvg, priorityScore };
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
    const overcapFactor = ctx.ajustarCrono ? 1.0 : 1.05;

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
        // Usa el máximo entre el need del ciclo y el need del cap 200h para no
        // dejar empleados ociosos cuando al incluirlos evitarías horas extras.
        if (!target) {
            let minRatio = Infinity;
            for (const pos of ctx.positions) {
                const cyclicN = Math.max(1, positionNeed[pos.positionName] || 1);
                const posPerf = feasibility.perPosition.find(p => p.positionName === pos.positionName);
                const capN = posPerf && posPerf.monthHours > 0
                    ? Math.ceil(posPerf.monthHours / hardMax)
                    : cyclicN;
                const need = Math.max(cyclicN, capN);
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
    // Solo cuando el grupo supera MAX(need_ciclo, need_cap200h). Sin +1 retén artificial:
    // con dotación justa (18 cubren 6+2) nadie queda idle ni recibe RET.
    const initialGroupSizes: Record<string, number> = {};
    Object.entries(positionGroups).forEach(([pos, g]) => { initialGroupSizes[pos] = g.length; });
    for (const posName of Object.keys(positionGroups)) {
        const cyclicNeed = Math.max(1, positionNeed[posName] || 1);
        const posPerf = feasibility.perPosition.find(p => p.positionName === posName);
        const capNeed = posPerf && posPerf.monthHours > 0
            ? Math.ceil(posPerf.monthHours / hardMax)
            : cyclicNeed;
        const need = Math.max(cyclicNeed, capNeed);
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

    const primary24hsPosition = findPrimary24hsPosition(ctx.positions);
    for (const pos of ctx.positions) {
        if (!isCustomCoverPosition(pos)) continue;
        const cap = Math.max(1, Number(pos.qty) || 1);
        const group = positionGroups[pos.positionName] ?? [];
        while (group.length > cap && primary24hsPosition) {
            const titularId = group.find(eid => defaultPos[eid] === pos.positionName) ?? group[0];
            const excessId = group.find(eid => eid !== titularId);
            if (!excessId) break;
            group.splice(group.indexOf(excessId), 1);
            positionGroups[primary24hsPosition.positionName].push(excessId);
            empAssignedTo[excessId] = primary24hsPosition.positionName;
        }
    }
    const customTitular: Record<string, string> = {};
    for (const pos of ctx.positions) {
        if (!isCustomCoverPosition(pos)) continue;
        const group = positionGroups[pos.positionName] ?? [];
        const owner = group.find(eid => defaultPos[eid] === pos.positionName) ?? group[0];
        if (owner) customTitular[pos.positionName] = owner;
    }
    const customCoverEmps = new Set<string>(
        ctx.employees
            .filter(emp => {
                const pn = empAssignedTo[emp.id];
                if (!pn) return false;
                const p = ctx.positions.find(x => x.positionName === pn);
                return !!p && isCustomCoverPosition(p);
            })
            .map(e => e.id),
    );

    if (shouldUseDemandDrivenScheduling(ctx)) {
        const stagger: Record<string, number> = {};
        rebalanceEqual24hsPositionGroups(ctx.positions, positionGroups, empAssignedTo, stagger);
        ctx.demandDrivenStaggerByEmp = stagger;
    }

    // ── ALERTA DE EXCESO DE EMPLEADOS POR PUESTO ─────────────────────────────
    const excessPositionEmployees: { positionName: string; assigned: number; needed: number; excess: number }[] = [];
    Object.entries(initialGroupSizes).forEach(([posName, initial]) => {
        const need = positionNeed[posName] || 1;
        if (initial > Math.ceil(need)) {
            excessPositionEmployees.push({ positionName: posName, assigned: initial, needed: Math.ceil(need), excess: initial - Math.ceil(need) });
        }
    });

    // ── RET-DESIGNATE: una sola persona por objetivo, solo si hay excedente ──
    // RET = sobrante (0 h) disponible para otro objetivo. Dotación justa → sin RET.
    const retDesignateSet = new Set<string>();
    const _firstDay = ctx.daysInMonth[0];
    const _retMonth = _firstDay ? (_firstDay.getFullYear() * 12 + _firstDay.getMonth()) : 0;
    const structuralIdle = Math.max(0, feasibility.metrics.idleEmployees ?? 0);
    const idleForRet = ctx.employees.filter(e => empAssignedTo[e.id] === null).map(e => e.id);
    if (idleForRet.length > 0) {
        const sorted = [...idleForRet].sort((a, b) => empMeta[a].priorityScore - empMeta[b].priorityScore);
        retDesignateSet.add(sorted[_retMonth % sorted.length]);
    } else if (structuralIdle > 0) {
        const primary24 = ctx.positions.find(p => {
            const cov = String(p.coverageType || '').toLowerCase();
            return cov === '24hs' || cov === '24' || cov === '24h';
        });
        if (primary24) {
            const group = positionGroups[primary24.positionName] ?? [];
            const need = positionNeed[primary24.positionName] ?? group.length;
            const candidates = group.filter(id => userLockedPos[id] !== primary24.positionName);
            if (candidates.length > need) {
                const sorted = [...candidates].sort((a, b) => empMeta[a].priorityScore - empMeta[b].priorityScore);
                retDesignateSet.add(sorted[_retMonth % sorted.length]);
            }
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
    const empCycleLen: Record<string, number> = {};
    const empCL_map: Record<string, number> = {};
    // Índice de día en el mes (di=0 para día 1) — usado para rotación y sort justo.
    const dayIndexMap: Map<string, number> = new Map(
        ctx.daysInMonth.map((d, i) => [ctx.getDateKey(d), i])
    );
    const monthStartGlobalDayIndex = ctx.monthStartGlobalDayIndex ?? (() => {
        const d0 = ctx.daysInMonth[0];
        if (!d0) return 0;
        const ANCHOR = new Date(2020, 0, 1);
        return Math.round((d0.getTime() - ANCHOR.getTime()) / 86_400_000);
    })();
    /**
     * Banda esperada para un empleado en un día dado.
     * - rotateShifts=true: rotación por bloque de ciclo CCT (6+2, 4+2…): mismo turno
     *   todo el tramo laboral (MMMMMM + FF, luego siguiente banda en péndulo M→T→N→T…).
     *   Ejemplo 6+2: MMMMMMFF → TTTTTTFF → NNNNNNFF → TTTTTTFF…
     * - rotateShifts=false: banda fija todo el mes (solo M, solo T o solo N).
     */
    const expectedShiftForDay = (empId: string, dateStr: string, posName: string): string | null => {
        const ring = shiftRingByPosition[posName];
        if (!ring || ring.length === 0) return empPrimaryShift[empId];
        const slot = empRotationSlot[empId] ?? 0;
        if (ring.length === 1) return ring[0];
        if (ctx.rotateShifts !== false) {
            const di = dayIndexMap.get(dateStr) ?? 0;
            const eCycleLen = empCycleLen[empId] ?? cycleLen;
            const eCL = empCL_map[empId] ?? cL;
            const offset = empGroupIdx[empId] ?? 0;
            const absDay = monthStartGlobalDayIndex + di;
            const cycleSlot = (absDay + offset) % eCycleLen;
            if (cycleSlot >= eCL) return null;
            const cycleStartAbs = absDay + offset - cycleSlot;
            const pendulumBlock = Math.floor(cycleStartAbs / eCycleLen);
            if (ring.length >= 3) {
                const period = 2 * (ring.length - 1);
                const pos = (slot + pendulumBlock) % period;
                const idx = pos < ring.length ? pos : period - pos;
                return ring[idx];
            }
            return ring[(slot + pendulumBlock) % ring.length];
        }
        // Banda fija: el empleado trabaja el mismo turno todo el mes.
        return ring[slot % ring.length];
    };

    // ── BAND BASE: offset inicial por banda de turno ──────────────────────────
    // Cada banda (N, T, M, rotativo) recibe un offset base distinto, uniformemente
    // espaciado dentro del ciclo. Todos los empleados de la misma banda arrancan
    // en el mismo offset → descansan los mismos días. Las bandas distintas tienen
    // offsets escalonados → nunca descansan a la vez → cobertura sin RETs.
    const positionBandBase: Record<string, number> = {};
    {
        const BAND_ORDER: Record<string, number> = { N: 0, N12: 1, T: 2, M: 3, D12: 4 };
        const bandToPositions = new Map<string, string[]>();
        Object.entries(positionGroups).forEach(([pName, empIds]) => {
            if (empIds.length === 0) return;
            const p = ctx.positions.find(pp => pp.positionName === pName);
            if (!p) return;
            const sd = ctx.daysInMonth.find(d => positionIsActiveOn(p, ctx.getDayLetter(ctx.getDateKey(d))));
            const sl = sd ? ctx.getDayLetter(ctx.getDateKey(sd)) : 'L';
            const codes = effectiveShiftsForPositionDay(p, sl, ctx.autoCycles)
                .map(s => String(s.code || '').toUpperCase()).filter(Boolean);
            const band = codes.length === 1 ? codes[0] : (codes.length > 1 ? '__ROT__' : '__NONE__');
            if (!bandToPositions.has(band)) bandToPositions.set(band, []);
            bandToPositions.get(band)!.push(pName);
        });
        const sortedBands = [...bandToPositions.keys()].sort((a, b) => {
            if (a === '__ROT__') return 1; if (b === '__ROT__') return -1;
            if (a === '__NONE__') return 1; if (b === '__NONE__') return -1;
            return (BAND_ORDER[a] ?? 50) - (BAND_ORDER[b] ?? 50);
        });
        const nb = Math.max(1, sortedBands.length);
        sortedBands.forEach((band, i) => {
            const base = Math.round(i * cycleLen / nb);
            const posNames = bandToPositions.get(band)!;
            if (band === '__ROT__' && posNames.length > 1) {
                posNames.forEach((pName, pi) => {
                    positionBandBase[pName] = Math.round(pi * cycleLen / posNames.length);
                });
            } else {
                posNames.forEach(pName => { positionBandBase[pName] = base; });
            }
        });
    }

    // Bandas fijas: plan global M/T/N + ciclos mixtos por banda (6+2 en M, 5+1 en T/N con 16 guardias).
    let fixedBandPlan: ReturnType<typeof buildFixedBandPlan> | null = null;
    const emp24Fixed: string[] = [];
    if (ctx.rotateShifts === false) {
        const seen24 = new Set<string>();
        for (const pos of ctx.positions) {
            const cov = String(pos.coverageType || '').toLowerCase();
            if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
            if (isCustomCoverPosition(pos)) continue;
            for (const empId of positionGroups[pos.positionName] || []) {
                if (seen24.has(empId)) continue;
                seen24.add(empId);
                emp24Fixed.push(empId);
            }
        }
        fixedBandPlan = buildFixedBandPlan(ctx, emp24Fixed);
    }

    const assignOffsetsForGroup = (
        group: string[],
        eCL: number,
        eCF: number,
        bandBase: number,
        shiftCodes: string[],
    ) => {
        const eCycleLen = eCL + eCF;
        const assignedOffsets = new Map<string, number>();
        const bandOff = bandBase % eCycleLen;
        const staggerRotating = shiftCodes.length > 1;
        const spreadStep = ctx.strictSixTwo === true
            ? Math.max(1, Math.floor(eCycleLen / Math.max(1, group.length)))
            : 1;
        const absDay0 = monthStartGlobalDayIndex;

        if (ctx.strictSixTwo === true && staggerRotating && group.length > 0) {
            let anchorSlot = bandOff % eCycleLen;
            for (const id of group) {
                const trailSlot = openingCycleSlotFromMayTrail(id, eCL, eCF, ctx);
                if (trailSlot !== null) {
                    anchorSlot = trailSlot;
                    break;
                }
            }
            const openingSlots = group.map((_, i) => (anchorSlot + spreadStep * i) % eCycleLen);
            const usedSlots = new Set<number>();

            const trailFirst = [...group].sort((a, b) => {
                const ta = openingCycleSlotFromMayTrail(a, eCL, eCF, ctx);
                const tb = openingCycleSlotFromMayTrail(b, eCL, eCF, ctx);
                if (ta !== null && tb === null) return -1;
                if (tb !== null && ta === null) return 1;
                return (ctx.demandDrivenStaggerByEmp?.[a] ?? group.indexOf(a))
                    - (ctx.demandDrivenStaggerByEmp?.[b] ?? group.indexOf(b));
            });

            for (const empId of trailFirst) {
                const want = openingCycleSlotFromMayTrail(empId, eCL, eCF, ctx);
                let slot = openingSlots.find(s => !usedSlots.has(s) && want !== null && s === want);
                if (slot === undefined) {
                    slot = openingSlots.find(s => !usedSlots.has(s));
                }
                if (slot === undefined) continue;
                usedSlots.add(slot);
                assignedOffsets.set(empId, offsetFromOpeningCycleSlot(slot, absDay0, eCycleLen));
            }
        } else {
            const desiredByEmp = new Map<string, number>();
            group.forEach(empId => {
                const slot = openingCycleSlotFromMayTrail(empId, eCL, eCF, ctx);
                if (slot !== null) {
                    desiredByEmp.set(empId, offsetFromOpeningCycleSlot(slot, absDay0, eCycleLen));
                }
            });
            const usedOffsets = new Set<number>();

            const pickSpreadOffset = (empId: string, idxInGroup: number): number => {
                const staggerIdx = ctx.rotateShifts === false
                    ? ctx.fixedBandGlobalStaggerByEmp?.[empId]
                    : ctx.demandDrivenStaggerByEmp?.[empId];
                const empBand = String(empPrimaryShift[empId] || '').toUpperCase();
                const fixedBandOff = ctx.rotateShifts === false && empBand
                    ? ({ N: 0, N12: 1, T: 2, D12: 4, M: 5 }[empBand] ?? bandOff) % eCycleLen
                    : bandOff;
                if (!staggerRotating) return fixedBandOff;
                let off = (fixedBandOff + spreadStep * (staggerIdx !== undefined ? staggerIdx : idxInGroup)) % eCycleLen;
                let guard = 0;
                while (usedOffsets.has(off) && guard < eCycleLen) {
                    off = (off + spreadStep) % eCycleLen;
                    guard++;
                }
                return off;
            };

            group.filter(id => desiredByEmp.has(id)).forEach(empId => {
                const off = desiredByEmp.get(empId)!;
                assignedOffsets.set(empId, off);
                usedOffsets.add(off);
            });
            group.filter(id => !desiredByEmp.has(id)).forEach((empId) => {
                const off = pickSpreadOffset(empId, group.indexOf(empId));
                assignedOffsets.set(empId, off);
                usedOffsets.add(off);
            });
        }

        group.forEach(empId => {
            empGroupIdx[empId] = assignedOffsets.get(empId) ?? 0;
            empCycleLen[empId] = eCycleLen;
            empCL_map[empId] = eCL;
        });
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
        if (ctx.rotateShifts === false && fixedBandPlan) {
            empIds.forEach(empId => {
                const code = fixedBandPlan!.primaryByEmp[empId];
                if (!code) return;
                const ringIdx = shiftCodes.indexOf(code);
                empPrimaryShift[empId] = code;
                empRotationSlot[empId] = ringIdx >= 0 ? ringIdx : 0;
            });
        } else if (ctx.rotateShifts !== false) {
            empIds.forEach((empId, idx) => {
                const code = shiftCodes[idx % shiftCodes.length];
                empPrimaryShift[empId] = code;
                empRotationSlot[empId] = idx % shiftCodes.length;
            });
        }
        const SHIFT_ALIAS_MAP: Record<string, string[]> = {
            M:   ['M',   'D12'],
            N:   ['N',   'N12'],
            D12: ['D12', 'M'  ],
            N12: ['N12', 'N'  ],
        };
        empIds.forEach(empId => {
            const fixedCode = (ctx.defaultShiftByEmp?.[empId] || '').toUpperCase();
            if (!fixedCode) return;
            const aliases = SHIFT_ALIAS_MAP[fixedCode] ?? [fixedCode];
            let ringIdx = -1;
            let resolvedCode = fixedCode;
            for (const alias of aliases) {
                ringIdx = shiftCodes.indexOf(alias);
                if (ringIdx >= 0) { resolvedCode = alias; break; }
            }
            if (ringIdx < 0) return;
            empPrimaryShift[empId] = resolvedCode;
            empRotationSlot[empId] = ringIdx;
        });
    });

    if (ctx.rotateShifts === false && fixedBandPlan) {
        ctx.fixedBandGlobalStaggerByEmp = computeFixedBandGlobalStagger(ctx.employees, empPrimaryShift);
        const offsets = assignFixedBandOffsets(
            emp24Fixed,
            empPrimaryShift,
            ctx.fixedBandGlobalStaggerByEmp,
            fixedBandPlan.clByEmp,
            fixedBandPlan.cycleLenByEmp,
        );
        for (const empId of emp24Fixed) {
            empGroupIdx[empId] = offsets[empId] ?? 0;
            empCL_map[empId] = fixedBandPlan.clByEmp[empId] ?? cL;
            empCycleLen[empId] = fixedBandPlan.cycleLenByEmp[empId] ?? cycleLen;
        }
    } else if (ctx.rotateShifts === false) {
        ctx.fixedBandGlobalStaggerByEmp = computeFixedBandGlobalStagger(ctx.employees, empPrimaryShift);
    }

    if (ctx.rotateShifts !== false) {
    Object.entries(positionGroups).forEach(([posName, empIds]) => {
        const pos = ctx.positions.find((p) => p.positionName === posName);
        if (!pos) return;
        const shiftCodes = shiftRingByPosition[posName] || [];
        if (shiftCodes.length === 0) return;
        const empIds8h = empIds.filter(id => !(has4x2 && (SHIFT_HRS_DEFAULT[(empPrimaryShift[id] || '').toUpperCase()] ?? 8) >= 12));
        const empIds12h = empIds.filter(id => has4x2 && (SHIFT_HRS_DEFAULT[(empPrimaryShift[id] || '').toUpperCase()] ?? 8) >= 12);
        const bandBase = positionBandBase[posName] ?? (ctx.distributedOffsetSeed ?? 0);
        assignOffsetsForGroup(empIds8h, cL, cF, bandBase, shiftCodes);
        assignOffsetsForGroup(empIds12h, 4, 2, bandBase, shiftCodes);
    });
    }

    if (ctx.rotateShifts === false) {
        const phase = ctx.fixedBandOffsetPhase ?? 0;
        if (phase !== 0) {
            ctx.employees.forEach(emp => {
                if (empGroupIdx[emp.id] === undefined) return;
                const eCycleLen = empCycleLen[emp.id] ?? cycleLen;
                empGroupIdx[emp.id] = (empGroupIdx[emp.id] + phase) % eCycleLen;
            });
        }
    }

    if (ctx.rotateShifts !== false && shouldUseDemandDrivenScheduling(ctx)) {
        const rotPool: string[] = [];
        for (const pos of ctx.positions) {
            if (isCustomCoverPosition(pos)) continue;
            const cov = String(pos.coverageType || '').toLowerCase();
            if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
            for (const id of positionGroups[pos.positionName] || []) {
                if (!rotPool.includes(id)) rotPool.push(id);
            }
        }
        if (rotPool.length > 0 && ctx.strictSixTwo !== true) {
            const hasTrail = (id: string) =>
                ((ctx.prevMonthTrailingWorkDays?.[id] ?? 0) as number) > 0 ||
                ((ctx.prevMonthTrailingRestDays?.[id] ?? 0) as number) > 0;
            balanceGlobalCycleOffsets(rotPool, empGroupIdx, cycleLen, hasTrail);
        }
    }

    // Rotativo 24hs demand-driven: slot de péndulo desfasado +1 respecto al stagger del
    // cuarteto (cuando descansa el stagger-0, los otros tres cubren M/T/N).
    if (ctx.rotateShifts !== false && shouldUseDemandDrivenScheduling(ctx)) {
        for (const pos of ctx.positions) {
            if (isCustomCoverPosition(pos)) continue;
            const cov = String(pos.coverageType || '').toLowerCase();
            if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
            const group = positionGroups[pos.positionName] || [];
            const ring = shiftRingByPosition[pos.positionName] || ['M', 'T', 'N'];
            const ringLen = Math.max(1, ring.length);
            group.forEach((empId, idxInGroup) => {
                const staggerIdx = ctx.demandDrivenStaggerByEmp?.[empId] ?? idxInGroup;
                const slot = ringLen > 1 ? (staggerIdx + 1) % ringLen : 0;
                empRotationSlot[empId] = slot;
                empPrimaryShift[empId] = ring[slot] ?? ring[0];
            });
        }
    }

    const {
        sixOne: flexSixOneRaw,
        fiveOne: flexFiveOneRaw,
        fourTwo: flexFourTwoRaw,
    } = pickFlexSchemeEmployees(ctx, positionGroups, ctx.demandDrivenStaggerByEmp);
    // noFlexSchemeEmployees = ciclo 6+2 puro para todos: ningún empleado recibe ciclo alternativo.
    const flexSixOne = ctx.noFlexSchemeEmployees ? [] : flexSixOneRaw;
    const flexFiveOne = ctx.noFlexSchemeEmployees ? [] : flexFiveOneRaw;
    const flexFourTwo = ctx.noFlexSchemeEmployees ? [] : flexFourTwoRaw;
    const fixedFlexSixOne = ctx.noFlexSchemeEmployees ? [] : (fixedBandPlan?.flexSixOne ?? []);
    const fixedFlexFiveOne = ctx.noFlexSchemeEmployees ? [] : (fixedBandPlan?.flexFiveOne ?? []);
    const flexSchemeEmpIds = [
        ...flexFourTwo,
        ...flexSixOne,
        ...flexFiveOne,
        ...fixedFlexSixOne,
        ...fixedFlexFiveOne,
    ];
    for (const empId of flexFourTwo) {
        empCL_map[empId] = 4;
        empCycleLen[empId] = 6;
    }
    for (const empId of flexSixOne) {
        empCL_map[empId] = 6;
        empCycleLen[empId] = 7;
    }
    for (const empId of flexFiveOne) {
        empCL_map[empId] = 5;
        empCycleLen[empId] = 6;
    }

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
            const eCF = eCycleLen - eCL;
            const seed = ctx.distributedOffsetSeed ?? 0;
            let offset: number;
            if (empGroupIdx[emp.id] !== undefined) {
                // Empleado asignado a puesto: offset calculado en PASO 2 (incluye trailing + seed)
                offset = empGroupIdx[emp.id] % eCycleLen;
            } else {
                // Empleado idle: trailing propio si disponible, si no → globalIdx + seed
                const tw = ctx.prevMonthTrailingWorkDays?.[emp.id];
                const tr = ctx.prevMonthTrailingRestDays?.[emp.id];
                if (tw !== undefined && tw > 0) {
                    offset = tw % eCycleLen;
                } else if (tr !== undefined && tr > 0 && tr < eCF) {
                    offset = (eCL + tr) % eCycleLen;
                } else {
                    offset = (globalIdx + seed) % eCycleLen;
                }
            }
            ctx.daysInMonth.forEach((day, di) => {
                const absDay = monthStartGlobalDayIndex + di;
                const slot = (absDay + offset) % eCycleLen;
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

    // ── PASO 3b: esquema 6+2 / 5+1 = días laborables del mes calendario de venta ──
    // Dos calendarios: venta 1→fin (cobertura SLA) vs liquidación 26→25 (tope 200 h/tramo).
    // NO recortar cycleWorkDays por tope CCT; el cupo se aplica al asignar (cctTrancheUsed).

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
        uncoveredSlotsByDay: {},
        excessPositionEmployees,
        employeeMonthlyHours: {},
        employeeCycleHours: { current: {}, next: {} },
        employeesOver200: [],
        positionGroups: { ...positionGroups },
        idleEmployeeIds: Object.entries(empAssignedTo).filter(([, v]) => v === null).map(([k]) => k),
        primaryShiftByEmp: { ...empPrimaryShift },
        suvicoWeekBillableOver48: [],
        cctSchemeCalendarProjection: feasibility.metrics.cctSchemeCalendarProjection,
        flexSchemeEmpIds: flexSchemeEmpIds.length > 0 ? [...flexSchemeEmpIds] : undefined,
        fixedBandSchemeByEmp: fixedBandPlan?.schemeByEmp
            ? { ...fixedBandPlan.schemeByEmp }
            : undefined,
    };

    const flexSchemeEmpSet = new Set(flexSchemeEmpIds);

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

    // Asignaciones sintéticas del mes anterior: permiten que passesAgreementRest
    // vea la racha real que viene del mes previo y evite violaciones cross-mes.
    // No se incluyen en el array assignments devuelto al caller.
    const syntheticPrevAssignments: V2Assignment[] = [];
    const skipSyntheticPrev = ctx.rotateShifts === false;
    if (ctx.daysInMonth.length > 0 && !skipSyntheticPrev) {
        const _fmd = ctx.daysInMonth[0];
        ctx.employees.forEach(emp => {
            const eCLsyn = empCL_map[emp.id] ?? cL;
            const eCycleLenSyn = empCycleLen[emp.id] ?? cycleLen;
            const eCFsyn = eCycleLenSyn - eCLsyn;
            const tw = ctx.prevMonthTrailingWorkDays?.[emp.id];
            const tr = ctx.prevMonthTrailingRestDays?.[emp.id];
            const scSyn = (empPrimaryShift[emp.id] || 'M').toUpperCase();
            const hSyn = SHIFT_HRS_DEFAULT[scSyn] ?? 8;
            const stSyn = DEFAULT_SHIFT_TIMES[scSyn] || '07:00';
            if (tw && tw > 0) {
                for (let i = 1; i <= Math.min(tw, eCLsyn); i++) {
                    const pd = new Date(_fmd.getFullYear(), _fmd.getMonth(), _fmd.getDate() - i);
                    syntheticPrevAssignments.push({
                        empId: emp.id, dateStr: ctx.getDateKey(pd),
                        positionName: '', code: scSyn, name: scSyn,
                        hours: hSyn, startTime: stSyn,
                    });
                }
            }
            if (tr && tr > 0) {
                for (let i = 1; i <= Math.min(tr, eCFsyn); i++) {
                    const pd = new Date(_fmd.getFullYear(), _fmd.getMonth(), _fmd.getDate() - i);
                    syntheticPrevAssignments.push({
                        empId: emp.id, dateStr: ctx.getDateKey(pd),
                        positionName: '', code: 'F', name: 'Franco',
                        hours: 0, startTime: '00:00', isFranco: true,
                    });
                }
            }
        });
    }

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
            const a = assignments.find((x) => x.empId === eid && x.dateStr === ds)
                ?? syntheticPrevAssignments.find((x) => x.empId === eid && x.dateStr === ds);
            if (!a) {
                // Día de ciclo-trabajo aún no asignado (el fallback F/RET aún no corrió):
                // tratarlo como día ocupado (0h) para que el check de días consecutivos
                // vea la racha completa y bloquee antes de llegar a 7+.
                if (cycleWorkDays[eid]?.has(ds)) return { code: 'RET', hours: 0, startTime: '00:00' };
                return null;
            }
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

    const FRANCO_BREAK_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
    const cctTrancheUsed = (empId: string, inCur: boolean) =>
        limitedEmpIds.has(empId)
            ? runtime[empId].cycleCurrentUsed + runtime[empId].cycleNextUsed
            : (inCur ? runtime[empId].cycleCurrentUsed : runtime[empId].cycleNextUsed);
    const sortByFewerHours = (empIds: string[], inCur: boolean) =>
        [...empIds].sort((a, b) => cctTrancheUsed(a, inCur) - cctTrancheUsed(b, inCur));

    const tryAssignBandSlot = (
        empId: string,
        pos: V2PositionDef,
        dateStr: string,
        sCode: string,
        sh: V2ShiftDef,
        inCurrent: boolean,
    ): boolean => {
        if (runtime[empId].assignedDays.has(dateStr)) return false;
        if (ctx.absences[empId]?.has(dateStr)) return false;
        if (!cycleWorkDays[empId]?.has(dateStr)) return false;
        const primary = expectedShiftForDay(empId, dateStr, pos.positionName);
        if (primary && primary !== sCode) return false;
        const slotQty = Math.max(1, Number(pos.qty) || 1);
        const slotFilled = assignments.filter(a =>
            a.dateStr === dateStr &&
            a.positionName === pos.positionName &&
            String(a.code || '').toUpperCase() === sCode &&
            (a.hours ?? 0) > 0,
        ).length;
        if (slotFilled >= slotQty) return false;
        const sHrs = shiftHoursH(sh);
        const sStart = sh.startTime || DEFAULT_SHIFT_TIMES[sCode] || '07:00';
        const sEnd = sh.endTime || undefined;
        if (!customCoverEmps.has(empId) && cctTrancheUsed(empId, inCurrent) + sHrs > hardMax) return false;
        if (assignmentBreaksBandTransition(assignments, empId, dateStr, sCode)) return false;
        if (nextAssignmentBreaksBandTransition(assignments, empId, dateStr, sCode)) return false;
        if (!passesAgreementRest(empId, dateStr, sCode, sStart, sHrs)) return false;
        writeAssignment(empId, dateStr, pos.positionName, sCode, sh.name || sCode, sHrs, sStart, inCurrent, sEnd);
        return true;
    };

    // Mapa de turnos bloqueados SOLO por el cap 200h (key = posName||dateStr||code).
    // Al final de los dos pases, filtramos los que corresponden a slots que quedaron sin cubrir.
    const capBlockedMap = new Map<string, CapOverflowSlot[]>();
    const capBlockedEmpSeen = new Set<string>();

    const writeCustomCoverShift = (
        empId: string,
        pos: V2PositionDef,
        dateStr: string,
        dayLetter: string,
        inCurrentCycle: boolean,
        opts?: { strictRest?: boolean },
    ): boolean => {
        if (runtime[empId].assignedDays.has(dateStr)) return false;
        if (ctx.absences[empId]?.has(dateStr)) return false;
        if (!positionIsActiveOn(pos, dayLetter)) return false;
        const dayBands = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
        if (dayBands.length === 0) return false;
        const sh = dayBands[0];
        const sCode = String(sh.code ?? '').toUpperCase();
        const sHrs = shiftHoursH(sh);
        const sStart = sh.startTime || DEFAULT_SHIFT_TIMES[sCode] || '07:00';
        const sEnd = sh.endTime || undefined;
        const sName = sh.name || sCode;
        if (opts?.strictRest) {
            if (!passesAgreementRest(empId, dateStr, sCode, sStart, sHrs)) return false;
        }
        writeAssignment(empId, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrentCycle, sEnd);
        return true;
    };

    // Pre-asignación titulares EN/RO (L–V)
    for (const pos of ctx.positions) {
        if (!isCustomCoverPosition(pos)) continue;
        const titular = customTitular[pos.positionName];
        const qty = Math.max(1, Number(pos.qty) || 1);
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const inCur = day.getDate() <= cutoffDay;
            let covered = assignments.filter(a =>
                a.dateStr === dateStr && a.positionName === pos.positionName && a.hours > 0
                && !FRANCO_SET.has(String(a.code ?? '').toUpperCase()),
            ).length;
            if (covered >= qty) continue;
            if (titular && covered < qty) writeCustomCoverShift(titular, pos, dateStr, dayLetter, inCur);
        }
    }

    const useDemandDriven = shouldUseDemandDrivenScheduling(ctx);
    const cycleBaseOnly = ctx.cycleBaseOnly === true;
    // Rotativo ON → demand-driven + péndulo. Rotativo OFF → loop clásico banda fija (abajo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dayDemandsFromFill: any[] = [];
    if (useDemandDriven) {
        seedDemandDrivenCycleFrancos(ctx, cycleWorkDays, assignments, runtime);
        if (cycleBaseOnly) {
            fillCycleBaseRotativeAssignments({
                ctx,
                assignments,
                runtime,
                cycleWorkDays,
                empAssignedTo,
                cutoffDay,
                isCustomCoverPosition,
                expectedShiftForDay,
                tryAssignBandSlot,
            });
        } else {
            dayDemandsFromFill = fillScheduleFromDemand({
                ctx,
                positionGroups,
                cycleWorkDays,
                customCoverEmps,
                limitedEmpIds,
                assignments,
                stats,
                runtime,
                cutoffDay,
                shiftHoursH,
                writeAssignment,
                passesAgreementRest,
                empMeta,
                isCustomCoverPosition,
                expectedShiftForDay,
                retDesignateSet,
                flexSchemeEmpIds: flexSchemeEmpSet,
            });
            fillDemandGapsBeforeFrancos({
                ctx,
                positionGroups,
                cycleWorkDays,
                customCoverEmps,
                limitedEmpIds,
                assignments,
                stats,
                runtime,
                cutoffDay,
                shiftHoursH,
                writeAssignment,
                passesAgreementRest,
                empMeta,
                isCustomCoverPosition,
                expectedShiftForDay,
                retDesignateSet,
                flexSchemeEmpIds: flexSchemeEmpSet,
            }, dayDemandsFromFill);
        }
    }

    // ── GENERACIÓN clásica (banda fija por empleado) ──────────────────────────
    if (!useDemandDriven) {
    const fixedBandPoolByCode: Record<string, string[]> = {};
    if (ctx.rotateShifts === false) {
        for (const emp of ctx.employees) {
            const posName = empAssignedTo[emp.id];
            if (!posName) continue;
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            const cov = String(pos.coverageType || '').toLowerCase();
            if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
            const band = String(empPrimaryShift[emp.id] || '').toUpperCase();
            if (!band) continue;
            if (!fixedBandPoolByCode[band]) fixedBandPoolByCode[band] = [];
            if (!fixedBandPoolByCode[band].includes(emp.id)) fixedBandPoolByCode[band].push(emp.id);
        }
    }
    // ── GENERACIÓN: loop único día×puesto×banda ──────────────────────────
    // Regla de oro: cada empleado trabaja SOLO su banda asignada todo el mes.
    // No hay cross-banda rescue. Los slots sin cobertura se reportan como vacantes.
    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        const inCurrentCycle = day.getDate() <= cutoffDay;

        for (const pos of ctx.positions) {
            if (!positionIsActiveOn(pos, dayLetter, dateStr)) continue;
            if (isCustomCoverPosition(pos)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles, dateStr);
            const group = positionGroups[pos.positionName] || [];
            const extD12Assigns: V2Assignment[] = [];
            const extN12Assigns: V2Assignment[] = [];
            const bandCodes = dayShifts.map(x => String(x.code || '').toUpperCase());
            let extensionMode = false;
            if (bandCodes.includes('M') && bandCodes.includes('T') && bandCodes.includes('N')) {
                extensionMode = isModo12Day(dateStr, ctx);
            }

            for (const sh of dayShifts) {
                const sCode = String(sh.code || '').toUpperCase();
                if (extensionMode && sCode === 'T') continue;

                const baseHrs = shiftHoursH(sh);
                const baseStart = sh.startTime || DEFAULT_SHIFT_TIMES[sCode] || '07:00';
                const baseEnd = sh.endTime || undefined;
                const sName = sh.name || sCode;

                let assignCode = sCode;
                let assignHrs = baseHrs;
                let assignStart = baseStart;
                let assignEnd = baseEnd;
                if (extensionMode && sCode === 'M') {
                    assignCode = 'D12';
                    assignHrs = SHIFT_HRS_DEFAULT.D12;
                    assignStart = DEFAULT_SHIFT_TIMES.D12;
                } else if (extensionMode && sCode === 'N') {
                    assignCode = 'N12';
                    assignHrs = SHIFT_HRS_DEFAULT.N12;
                    assignStart = DEFAULT_SHIFT_TIMES.N12;
                }

                // Empleados disponibles del puesto con la banda correcta.
                // Si hay menos de qty en la banda correcta, suplementar con
                // cualquier disponible del posPool (nunca cruzar posición).
                const bandInGroupAvailable = group.filter(id => {
                    const primary = String(empPrimaryShift[id] || '').toUpperCase();
                    return primary === sCode
                        && !runtime[id].assignedDays.has(dateStr)
                        && !ctx.absences[id]?.has(dateStr)
                        && cycleWorkDays[id]?.has(dateStr);
                });
                const anyInGroupAvailable = bandInGroupAvailable.length < qty
                    ? group.filter(id =>
                        !runtime[id].assignedDays.has(dateStr)
                        && !ctx.absences[id]?.has(dateStr)
                        && cycleWorkDays[id]?.has(dateStr))
                    : null;
                // Preferred: banda correcta first, luego suplemento del grupo.
                const candidates = anyInGroupAvailable !== null
                    ? [
                        ...bandInGroupAvailable,
                        ...anyInGroupAvailable.filter(id => !bandInGroupAvailable.includes(id)),
                    ]
                    : bandInGroupAvailable;

                // Sort: owner → cupo CCT libre (repartir carga T1) → rotación justa por banda.
                const di = dayIndexMap.get(dateStr) ?? 0;
                const cctRemain = (empId: string) =>
                    hardMax - cctTrancheUsed(empId, inCurrentCycle);
                candidates.sort((a, b) => {
                    const ao = defaultPos[a] === pos.positionName ? 1 : 0;
                    const bo = defaultPos[b] === pos.positionName ? 1 : 0;
                    if (ao !== bo) return bo - ao;
                    if (ctx.budgetMode !== 'calendar') {
                        const remA = cctRemain(a);
                        const remB = cctRemain(b);
                        if (Math.abs(remA - remB) > 0.5) return remB - remA;
                    }
                    const lenA = empCycleLen[a] ?? cycleLen;
                    const lenB = empCycleLen[b] ?? cycleLen;
                    const ra = ((empGroupIdx[a] ?? 0) - di % lenA + lenA * 10) % lenA;
                    const rb = ((empGroupIdx[b] ?? 0) - di % lenB + lenB * 10) % lenB;
                    return ra - rb;
                });

                let covered = 0;
                for (const empId of candidates) {
                    if (covered >= qty) break;
                    const st = runtime[empId];
                    // Puestos L-V: cap sobre el total del mes (ambos ciclos sumados),
                    // porque trabajan todos los días hábiles sin importar el corte del ciclo CCT.
                    const used = limitedEmpIds.has(empId)
                        ? st.cycleCurrentUsed + st.cycleNextUsed
                        : (inCurrentCycle ? st.cycleCurrentUsed : st.cycleNextUsed);
                    if (used + assignHrs > hardMax) {
                        const seenKey = `${empId}||${dateStr}||${assignCode}`;
                        if (!capBlockedEmpSeen.has(seenKey) && passesAgreementRest(empId, dateStr, assignCode, assignStart, assignHrs)) {
                            capBlockedEmpSeen.add(seenKey);
                            const capKey = `${pos.positionName}||${dateStr}||${assignCode}`;
                            if (!capBlockedMap.has(capKey)) capBlockedMap.set(capKey, []);
                            capBlockedMap.get(capKey)!.push({ empId, dateStr, positionName: pos.positionName, code: assignCode, name: sh.name || assignCode, hours: assignHrs, startTime: assignStart, ...(assignEnd ? { endTime: assignEnd } : {}) });
                        }
                        continue;
                    }
                    if (assignmentBreaksBandTransition(assignments, empId, dateStr, assignCode)) continue;
                    if (nextAssignmentBreaksBandTransition(assignments, empId, dateStr, assignCode)) continue;
                    if (!passesAgreementRest(empId, dateStr, assignCode, assignStart, assignHrs)) continue;
                    writeAssignment(empId, dateStr, pos.positionName, assignCode, sh.name || assignCode, assignHrs, assignStart, inCurrentCycle, assignEnd);
                    if (extensionMode && assignCode === 'D12') extD12Assigns.push(assignments[assignments.length - 1]);
                    if (extensionMode && assignCode === 'N12') extN12Assigns.push(assignments[assignments.length - 1]);
                    covered++;
                }

                if (covered < qty && !(extensionMode && sCode === 'T')) {
                    const missing = qty - covered;
                    stats.uncoveredSlots += missing;
                    if (!stats.uncoveredSlotsByDay![dateStr]) stats.uncoveredSlotsByDay![dateStr] = [];
                    stats.uncoveredSlotsByDay![dateStr].push({ positionName: pos.positionName, code: sCode, missing });
                }
            }

            if (extensionMode && (extD12Assigns.length > 0) !== (extN12Assigns.length > 0)) {
                const toRevert = extD12Assigns.length > 0 ? extD12Assigns : extN12Assigns;
                const isD12Side = extD12Assigns.length > 0;
                const baseCode = isD12Side ? 'M' : 'N';
                const baseSh = dayShifts.find(x => String(x.code || '').toUpperCase() === baseCode);
                const baseHrsRev = baseSh ? shiftHoursH(baseSh) : 8;
                const baseStartRev = baseSh?.startTime || DEFAULT_SHIFT_TIMES[baseCode] || '07:00';
                const baseEndRev = baseSh?.endTime || undefined;
                for (const a of toRevert) {
                    const diff = a.hours - baseHrsRev;
                    const st = runtime[a.empId];
                    const wk = isoWeekKey(new Date(a.dateStr));
                    const inCur = parseInt(a.dateStr.split('-')[2]) <= cutoffDay;
                    st.weekHours[wk] = (st.weekHours[wk] ?? 0) - diff;
                    if (inCur) {
                        st.cycleCurrentUsed -= diff;
                        stats.employeeCycleHours.current[a.empId] = st.cycleCurrentUsed;
                    } else {
                        st.cycleNextUsed -= diff;
                        stats.employeeCycleHours.next[a.empId] = st.cycleNextUsed;
                    }
                    st.monthHours -= diff;
                    stats.employeeMonthlyHours[a.empId] = st.monthHours;
                    stats.totalBillableHours -= diff;
                    a.code = baseCode;
                    a.name = baseSh?.name || baseCode;
                    a.hours = baseHrsRev;
                    a.startTime = baseStartRev;
                    if (baseEndRev) a.endTime = baseEndRev; else delete a.endTime;
                    st.lastShiftCode = baseCode;
                }
            }
        }
    }

    // ── SEGUNDO PASE: banda cruzada ──────────────────────────────────────────
    // Para empleados asignados a un puesto que no recibieron turno en su día de
    // trabajo del ciclo: intentar cubrir cualquier banda sin llenar en su puesto.
    // Esto permite que el empleado de relevo (mismo slot que el primario) cubra la
    // banda que necesita el puesto ese día en vez de quedar en RET innecesario.
    // Condición: el día debe ser de trabajo para el empleado (cycleWorkDays) y el
    // puesto debe tener un slot libre.
    for (const day of ctx.daysInMonth) {
        const dateStr2 = ctx.getDateKey(day);
        const dayLetter2 = ctx.getDayLetter(dateStr2);
        const inCurr2 = day.getDate() <= cutoffDay;
        for (const emp of ctx.employees) {
            if (runtime[emp.id].assignedDays.has(dateStr2)) continue;
            const posName2 = empAssignedTo[emp.id];
            if (!posName2) continue;
            if (!cycleWorkDays[emp.id]?.has(dateStr2)) continue;
            const pos2 = ctx.positions.find(p => p.positionName === posName2);
            if (!pos2 || !positionIsActiveOn(pos2, dayLetter2, dateStr2)) continue;
            const dayShifts2 = effectiveShiftsForPositionDay(pos2, dayLetter2, ctx.autoCycles, dateStr2);
            for (const sh2 of dayShifts2) {
                const sCode2 = String(sh2.code || '').toUpperCase();
                // Banda fija: el segundo pase NO puede asignar fuera de la banda primaria del empleado.
                const primary2 = expectedShiftForDay(emp.id, dateStr2, posName2);
                if (primary2 && primary2 !== sCode2) continue;
                const sHrs2 = shiftHoursH(sh2);
                const sStart2 = sh2.startTime || DEFAULT_SHIFT_TIMES[sCode2] || '07:00';
                const sEnd2 = sh2.endTime || undefined;
                const qty2 = Math.max(1, Number(pos2.qty) || 1);
                const covd2 = assignments.filter(a =>
                    a.dateStr === dateStr2 &&
                    a.positionName === posName2 &&
                    a.code === sCode2 &&
                    !a.isFranco && !(a as any).isReten
                ).length;
                if (covd2 >= qty2) continue;
                const used2 = limitedEmpIds.has(emp.id)
                    ? runtime[emp.id].cycleCurrentUsed + runtime[emp.id].cycleNextUsed
                    : (inCurr2 ? runtime[emp.id].cycleCurrentUsed : runtime[emp.id].cycleNextUsed);
                if (used2 + sHrs2 > hardMax) {
                    const seenKey2 = `${emp.id}||${dateStr2}||${sCode2}`;
                    if (!capBlockedEmpSeen.has(seenKey2) && passesAgreementRest(emp.id, dateStr2, sCode2, sStart2, sHrs2)) {
                        capBlockedEmpSeen.add(seenKey2);
                        const capKey2 = `${posName2}||${dateStr2}||${sCode2}`;
                        if (!capBlockedMap.has(capKey2)) capBlockedMap.set(capKey2, []);
                        capBlockedMap.get(capKey2)!.push({ empId: emp.id, dateStr: dateStr2, positionName: posName2, code: sCode2, name: sh2.name || sCode2, hours: sHrs2, startTime: sStart2, ...(sEnd2 ? { endTime: sEnd2 } : {}) });
                    }
                    continue;
                }
                if (assignmentBreaksBandTransition(assignments, emp.id, dateStr2, sCode2)) continue;
                if (nextAssignmentBreaksBandTransition(assignments, emp.id, dateStr2, sCode2)) continue;
                if (!passesAgreementRest(emp.id, dateStr2, sCode2, sStart2, sHrs2)) continue;
                writeAssignment(emp.id, dateStr2, posName2, sCode2, sh2.name || sCode2, sHrs2, sStart2, inCurr2, sEnd2);
                // Eliminar del uncoveredSlotsByDay si la brecha se cerró
                const gapDay = stats.uncoveredSlotsByDay![dateStr2];
                if (gapDay) {
                    const gi = gapDay.findIndex(g => g.positionName === posName2 && g.code === sCode2);
                    if (gi >= 0) {
                        gapDay[gi].missing--;
                        stats.uncoveredSlots--;
                        if (gapDay[gi].missing <= 0) gapDay.splice(gi, 1);
                    }
                }
                break;
            }
        }
    }

    const assignCustomBackupOrSubstitute = (
        empId: string,
        pos: V2PositionDef,
        dateStr: string,
        dayLetter: string,
        inCurrent: boolean,
    ): boolean => {
        if (runtime[empId].assignedDays.has(dateStr)) return false;
        if (ctx.absences[empId]?.has(dateStr)) return false;
        if (writeCustomCoverShift(empId, pos, dateStr, dayLetter, inCurrent, { strictRest: true })) return true;
        if (primary24hsPosition) {
            const p1Bands = effectiveShiftsForPositionDay(primary24hsPosition, dayLetter, ctx.autoCycles);
            for (const sh of p1Bands) {
                const code = String(sh.code ?? '').toUpperCase();
                const sHrs = shiftHoursH(sh);
                const sStart = sh.startTime || DEFAULT_SHIFT_TIMES[code] || '07:00';
                const sEnd = sh.endTime || undefined;
                if (!customCoverEmps.has(empId) && cctTrancheUsed(empId, inCurrent) + sHrs > hardMax) continue;
                if (!passesAgreementRest(empId, dateStr, code, sStart, sHrs)) continue;
                writeAssignment(empId, dateStr, pos.positionName, code, sh.name || code, sHrs, sStart, inCurrent, sEnd);
                return true;
            }
        }
        return false;
    };

    const stripFrancoOnCustomActiveDay = (
        empId: string, pos: V2PositionDef, dateStr: string,
    ): boolean => {
        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr);
        if (!a || !FRANCO_BREAK_SET.has(String(a.code ?? '').toUpperCase())) return false;
        runtime[empId].assignedDays.delete(dateStr);
        const idx = assignments.indexOf(a);
        if (idx >= 0) assignments.splice(idx, 1);
        if (stats.totalAssignments > 0) stats.totalAssignments--;
        return true;
    };

    // Cobertura custom EN/RO: titular L–V; respaldo desde Puesto 24hs (M/T/N/RO), nunca RET.
    for (const pos of ctx.positions) {
        if (!isCustomCoverPosition(pos)) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const titular = customTitular[pos.positionName];
        const backupPool = primary24hsPosition
            ? sortByFewerHours(positionGroups[primary24hsPosition.positionName] ?? [], true)
            : [];
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const inCurrent = day.getDate() <= cutoffDay;

            if (titular && stripFrancoOnCustomActiveDay(titular, pos, dateStr)) {
                writeCustomCoverShift(titular, pos, dateStr, dayLetter, inCurrent);
            }

            const countCover = () => assignments.filter(a =>
                a.dateStr === dateStr &&
                a.positionName === pos.positionName &&
                a.hours > 0 &&
                !FRANCO_BREAK_SET.has(String(a.code ?? '').toUpperCase()),
            ).length;

            let covered = countCover();
            while (covered < qty) {
                let filled = false;
                if (titular && !runtime[titular].assignedDays.has(dateStr) && !ctx.absences[titular]?.has(dateStr)) {
                    filled = writeCustomCoverShift(titular, pos, dateStr, dayLetter, inCurrent);
                }
                if (!filled) {
                    for (const eid of backupPool) {
                        if (eid === titular) continue;
                        if (assignCustomBackupOrSubstitute(eid, pos, dateStr, dayLetter, inCurrent)) {
                            filled = true;
                            break;
                        }
                    }
                }
                if (!filled) break;
                covered = countCover();
            }
        }
    }

    // ── TERCER PASE: cerrar slots y días laborables 24/7 sin turno ───────────
    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        const inCurrent = day.getDate() <= cutoffDay;
        for (const pos of ctx.positions) {
            if (isCustomCoverPosition(pos)) continue;
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const group = positionGroups[pos.positionName] || [];
            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
            const bandCodes = dayShifts.map(x => String(x.code || '').toUpperCase());
            const extensionMode = bandCodes.includes('M') && bandCodes.includes('T') && bandCodes.includes('N')
                && group.some(eid => {
                    const primary = expectedShiftForDay(eid, dateStr, pos.positionName);
                    return primary === 'T' && ctx.absences[eid]?.has(dateStr);
                });
            for (const sh of dayShifts) {
                const sCode = String(sh.code || '').toUpperCase();
                if (extensionMode && sCode === 'T') continue;
                let assignCode = sCode;
                let assignSh = sh;
                if (extensionMode && sCode === 'M') {
                    assignCode = 'D12';
                    assignSh = { ...sh, code: 'D12', hours: SHIFT_HRS_DEFAULT.D12, startTime: DEFAULT_SHIFT_TIMES.D12 };
                } else if (extensionMode && sCode === 'N') {
                    assignCode = 'N12';
                    assignSh = { ...sh, code: 'N12', hours: SHIFT_HRS_DEFAULT.N12, startTime: DEFAULT_SHIFT_TIMES.N12 };
                }
                let covered = assignments.filter(a =>
                    a.dateStr === dateStr && a.positionName === pos.positionName
                    && String(a.code).toUpperCase() === assignCode && a.hours > 0,
                ).length;
                if (covered >= qty) continue;
                const poolSource = ctx.rotateShifts === false && (fixedBandPoolByCode[sCode]?.length ?? 0) > 0
                    ? fixedBandPoolByCode[sCode]
                    : group;
                const candidates = sortByFewerHours(poolSource.filter(empId => {
                    if (runtime[empId].assignedDays.has(dateStr)) return false;
                    if (ctx.absences[empId]?.has(dateStr)) return false;
                    if (!cycleWorkDays[empId]?.has(dateStr)) return false;
                    const primary = expectedShiftForDay(empId, dateStr, pos.positionName);
                    if (primary && primary !== sCode) return false;
                    return true;
                }), inCurrent);
                for (const empId of candidates) {
                    if (covered >= qty) break;
                    if (tryAssignBandSlot(empId, pos, dateStr, assignCode, assignSh, inCurrent)) covered++;
                }
            }
        }
        for (const emp of ctx.employees) {
            const posName = empAssignedTo[emp.id];
            if (!posName) continue;
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            const letters = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
            const operatesAllWeek = letters.every(l => positionIsActiveOn(pos, l));
            if (!operatesAllWeek) continue;
            if (runtime[emp.id].assignedDays.has(dateStr)) continue;
            if (!cycleWorkDays[emp.id]?.has(dateStr)) continue;
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
            const primary = expectedShiftForDay(emp.id, dateStr, posName);
            const sh = primary
                ? dayShifts.find(s => String(s.code || '').toUpperCase() === primary)
                : dayShifts[0];
            if (!sh) continue;
            const code = String(sh.code || '').toUpperCase();
            tryAssignBandSlot(emp.id, pos, dateStr, code, sh, inCurrent);
        }
    }
    } // fin !useDemandDriven

    // ── CIERRE SLA: total facturable = horas vendidas (imperativo operativo) ──
    // Con demand-driven + rotativo la cobertura es por slot M/T/N; no forzar horas sueltas.
    {
        const slaTarget = Math.round(Math.max(0, ctx.slaVendidas || contractedH || 0));
        if (slaTarget > 0 && !(useDemandDriven && ctx.rotateShifts !== false)) {
            let deficit = slaTarget - stats.totalBillableHours;
            let guard = 0;
            while (deficit > 0.5 && guard++ < 1200) {
                const before = stats.totalBillableHours;
                type SlotTry = { hrs: number; run: () => boolean };
                const tries: SlotTry[] = [];

                for (const pos of ctx.positions) {
                    if (!isCustomCoverPosition(pos)) continue;
                    const qty = Math.max(1, Number(pos.qty) || 1);
                    const titular = customTitular[pos.positionName];
                    const backupPool = primary24hsPosition
                        ? sortByFewerHours(positionGroups[primary24hsPosition.positionName] ?? [], true)
                        : [];
                    for (const day of ctx.daysInMonth) {
                        const dateStr = ctx.getDateKey(day);
                        const dayLetter = ctx.getDayLetter(dateStr);
                        if (!positionIsActiveOn(pos, dayLetter)) continue;
                        const inCurrent = day.getDate() <= cutoffDay;
                        const covered = assignments.filter(a =>
                            a.dateStr === dateStr && a.positionName === pos.positionName && a.hours > 0
                            && !FRANCO_BREAK_SET.has(String(a.code ?? '').toUpperCase()),
                        ).length;
                        if (covered >= qty) continue;
                        const dayBands = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
                        const sh0 = dayBands[0];
                        const h0 = sh0 ? shiftHoursH(sh0) : 8;
                        tries.push({
                            hrs: h0,
                            run: () => {
                                if (titular && writeCustomCoverShift(titular, pos, dateStr, dayLetter, inCurrent)) return true;
                                for (const eid of backupPool) {
                                    if (eid === titular) continue;
                                    if (assignCustomBackupOrSubstitute(eid, pos, dateStr, dayLetter, inCurrent)) return true;
                                }
                                return false;
                            },
                        });
                    }
                }

                for (const day of ctx.daysInMonth) {
                    const dateStr = ctx.getDateKey(day);
                    const dayLetter = ctx.getDayLetter(dateStr);
                    const inCurrent = day.getDate() <= cutoffDay;
                    for (const pos of ctx.positions) {
                        if (isCustomCoverPosition(pos)) continue;
                        if (!positionIsActiveOn(pos, dayLetter)) continue;
                        const qty = Math.max(1, Number(pos.qty) || 1);
                        const group = positionGroups[pos.positionName] || [];
                        const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
                        for (const sh of dayShifts) {
                            const sCode = String(sh.code || '').toUpperCase();
                            const assignHrs = shiftHoursH(sh);
                            let covered = assignments.filter(a =>
                                a.dateStr === dateStr && a.positionName === pos.positionName
                                && String(a.code).toUpperCase() === sCode && a.hours > 0,
                            ).length;
                            if (covered >= qty) continue;
                            const candidates = sortByFewerHours(group.filter(empId => {
                                if (runtime[empId].assignedDays.has(dateStr)) return false;
                                if (ctx.absences[empId]?.has(dateStr)) return false;
                                if (!cycleWorkDays[empId]?.has(dateStr)) return false;
                                const primary = expectedShiftForDay(empId, dateStr, pos.positionName);
                                if (primary && primary !== sCode) return false;
                                return true;
                            }), inCurrent);
                            for (const empId of candidates) {
                                tries.push({
                                    hrs: assignHrs,
                                    run: () => tryAssignBandSlot(empId, pos, dateStr, sCode, sh, inCurrent),
                                });
                            }
                        }
                    }
                }

                tries.sort((a, b) => {
                    const da = Math.abs(a.hrs - deficit);
                    const db = Math.abs(b.hrs - deficit);
                    if (da !== db) return da - db;
                    return b.hrs - a.hrs;
                });
                let progressed = false;
                for (const t of tries) {
                    if (t.hrs > deficit + 0.5) continue;
                    if (t.run()) { progressed = true; break; }
                }
                if (!progressed) break;
                deficit = slaTarget - stats.totalBillableHours;
                if (stats.totalBillableHours - before < 0.5) break;
            }
            stats.slaDeficitRemaining = Math.max(0, Math.round((slaTarget - stats.totalBillableHours) * 10) / 10);
            stats.slaHoursClosed = stats.slaDeficitRemaining <= 0.5;
        }
    }

    // ── CAP OVERFLOW: slots bloqueados por 200h que quedaron sin cubrir ──────
    const capOverflowSlots: CapOverflowSlot[] = [];
    const seenEmpDayOverflow = new Set<string>(); // un solo turno por (empId, dateStr)
    capBlockedMap.forEach((blocked, key) => {
        const [posName, dateStr, code] = key.split('||');
        const gapDay = stats.uncoveredSlotsByDay![dateStr];
        const gapEntry = gapDay?.find(g => g.positionName === posName && g.code === code);
        if (!gapEntry) return;
        // Agregar tantos empleados como hagan falta para cubrir el faltante (no solo 1).
        let addedForSlot = 0;
        for (const entry of blocked) {
            if (addedForSlot >= gapEntry.missing) break;
            const empDateKey = `${entry.empId}||${entry.dateStr}`;
            if (seenEmpDayOverflow.has(empDateKey)) continue;
            seenEmpDayOverflow.add(empDateKey);
            capOverflowSlots.push(entry);
            addedForSlot++;
        }
    });

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

    let gapFillParamsForFallback: Parameters<typeof fillDemandGapsBeforeFrancos>[0] | null = null;
    if (useDemandDriven && !cycleBaseOnly && dayDemandsFromFill.length > 0) {
        gapFillParamsForFallback = {
            ctx,
            positionGroups,
            cycleWorkDays,
            customCoverEmps,
            limitedEmpIds,
            assignments,
            stats,
            runtime,
            cutoffDay,
            shiftHoursH,
            writeAssignment,
            passesAgreementRest,
            empMeta,
            isCustomCoverPosition,
            expectedShiftForDay,
            retDesignateSet,
            flexSchemeEmpIds: flexSchemeEmpSet,
        };
        fillDemandGapsBeforeFrancos(gapFillParamsForFallback, dayDemandsFromFill);
    }

    // Días sobrantes:
    //   · Día de franco del ciclo (6+2) → F siempre (descanso legal, no RET).
    //   · Día laborable del ciclo sin turno → RET solo si está en retDesignateSet
    //     (único guardia sobrante del objetivo); el resto → F.
    //   · Día no operativo del puesto limitado → F.
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        const ownerPosName = defaultPos[emp.id];
        const ownerPos = ownerPosName ? ctx.positions.find((p) => p.positionName === ownerPosName) : null;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;
            const dayLetter = ctx.getDayLetter(dateStr);
            // Owner de puesto limitado en día NO operativo del puesto → F.
            const ownerLimitedInactive = !!ownerPos && !positionIsActiveOn(ownerPos, dayLetter);
            const isWorkDayInCycle = !ownerLimitedInactive && cycleWorkDays[emp.id]?.has(dateStr);
            const assignedPosForFallback = empAssignedTo[emp.id];
            // En 6+1, el único franco entre bloques da ~32h de descanso.
            // Tras 48h de racha (bloque N/T/M completo), el CCT exige 35h → 32h < 35h → violación.
            // Al detectar esa situación damos F extra (el empleado descansa; retoma al día siguiente).
            const lastCode = (st.lastShiftCode || '').toUpperCase();
            const isPostStreakShortCycle = cF === 1 && (lastCode === 'N' || lastCode === 'N12');
            const inCurrent = day.getDate() <= cutoffDay;

            const customPosName = empAssignedTo[emp.id];
            const customPos = customPosName
                ? ctx.positions.find(p => p.positionName === customPosName && isCustomCoverPosition(p))
                : null;
            if (customPos && positionIsActiveOn(customPos, dayLetter)) {
                if (writeCustomCoverShift(emp.id, customPos, dateStr, dayLetter, inCurrent)) continue;
                if (assignCustomBackupOrSubstitute(emp.id, customPos, dateStr, dayLetter, inCurrent)) continue;
                continue;
            }

            const assignedPosName = empAssignedTo[emp.id];
            const assignedPos = assignedPosName
                ? ctx.positions.find(p => p.positionName === assignedPosName)
                : null;
            const is24hsAssigned = !!assignedPos
                && !isCustomCoverPosition(assignedPos)
                && ['L', 'M', 'X', 'J', 'V', 'S', 'D'].every(l => positionIsActiveOn(assignedPos, l));
            if (is24hsAssigned && isWorkDayInCycle && positionIsActiveOn(assignedPos!, dayLetter)) {
                if (isModo12Day(dateStr, ctx)) {
                    const primary = expectedShiftForDay(emp.id, dateStr, assignedPosName!);
                    const bc = normBand(primary || '');
                    if (bc === 'M' || bc === 'D12' || bc === 'N' || bc === 'N12') {
                        const slotCode = bc === 'N' || bc === 'N12' ? 'N12' : 'D12';
                        const dayShifts = effectiveShiftsForPositionDay(assignedPos!, dayLetter, ctx.autoCycles);
                        const sh = dayShifts.find(s => String(s.code || '').toUpperCase() === slotCode);
                        if (sh && tryAssignBandSlot(emp.id, assignedPos!, dateStr, slotCode, sh, inCurrent)) {
                            continue;
                        }
                    }
                } else {
                    const dayShifts = effectiveShiftsForPositionDay(assignedPos!, dayLetter, ctx.autoCycles);
                    const primary = expectedShiftForDay(emp.id, dateStr, assignedPosName!);
                    const sh = primary
                        ? dayShifts.find(s => String(s.code || '').toUpperCase() === primary)
                        : dayShifts[0];
                    if (sh && tryAssignBandSlot(emp.id, assignedPos!, dateStr, String(sh.code || '').toUpperCase(), sh, inCurrent)) {
                        continue;
                    }
                }
            }

            const isAssignedHere = empAssignedTo[emp.id] != null;
            const contingencyDay = isContingencyApretarDay(dateStr, ctx);
            const optionalRetPool = usesExpandedRetPool(ctx, dateStr);
            let fallbackCode = isWorkDayInCycle
                ? (contingencyDay
                    ? 'RET'
                    : isPostStreakShortCycle ? 'F'
                        : optionalRetPool
                            ? (isAssignedHere ? 'RET' : 'F')
                            : (retDesignateSet.has(emp.id) ? 'RET' : 'F'))
                : 'F';

            if (ctx.rotateShifts === false && isFixedBandIntensiveMode(ctx)) {
                const di = dayIndexMap.get(dateStr) ?? 0;
                let consecF = 0;
                for (let i = di - 1; i >= 0; i--) {
                    const ds = ctx.getDateKey(ctx.daysInMonth[i]);
                    const prev = assignments.find(x => x.empId === emp.id && x.dateStr === ds);
                    if (String(prev?.code || '').toUpperCase() === 'F') consecF++;
                    else break;
                }
                if (isWorkDayInCycle && isAssignedHere) {
                    // Banda fija: día laborable del ciclo sin slot → RET (preserva bloque 6+2).
                    fallbackCode = 'RET';
                } else if (fallbackCode === 'F' && consecF >= 2) {
                    fallbackCode = 'RET';
                }
            }

            // Rotativo: empleado 24hs en día de trabajo pero sin asignación por extensionMode
            // (T slot absorbido por D12/N12) → RET para no partir el bloque 6+2 del CCT.
            if (ctx.rotateShifts !== false && isModo12Day(dateStr, ctx) && isWorkDayInCycle && is24hsAssigned) {
                fallbackCode = 'RET';
            }

            if (
                fallbackCode === 'F'
                && isWorkDayInCycle
                && gapFillParamsForFallback
                && ctx.rotateShifts !== false
            ) {
                if (tryAssignEmployeeToDayGap(gapFillParamsForFallback, dayDemandsFromFill, emp.id, dateStr, inCurrent)) {
                    continue;
                }
            }

            if (cycleBaseOnly && isWorkDayInCycle) {
                continue;
            }

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

    restoreRotativeCycleFrancos(assignments, ctx, expectedShiftForDay, defaultPos, cycleWorkDays);

    let gapFillFinal: Parameters<typeof fillDemandGapsBeforeFrancos>[0] | null = null;
    if (useDemandDriven && !cycleBaseOnly && dayDemandsFromFill.length > 0 && ctx.rotateShifts !== false) {
        gapFillFinal = {
            ctx,
            positionGroups,
            cycleWorkDays,
            customCoverEmps,
            limitedEmpIds,
            assignments,
            stats,
            runtime,
            cutoffDay,
            shiftHoursH,
            writeAssignment,
            passesAgreementRest,
            empMeta,
            isCustomCoverPosition,
            expectedShiftForDay,
            empAssignedTo,
            retDesignateSet,
            flexSchemeEmpIds: flexSchemeEmpSet,
        };
        fillDemandGapsBeforeFrancos(gapFillFinal, dayDemandsFromFill);
        fillDemandGapsWithFlexibleCycle(gapFillFinal, dayDemandsFromFill);
        alignAssignmentsToPendulum(
            assignments, ctx, expectedShiftForDay, isCustomCoverPosition, passesAgreementRest,
        );
        for (let repairPass = 0; repairPass < 3; repairPass++) {
            repairForbiddenAfterNightTransitions(assignments, ctx, passesAgreementRest);
            fillDemandGapsBeforeFrancos(gapFillFinal, dayDemandsFromFill);
            fillDemandGapsWithFlexibleCycle(gapFillFinal, dayDemandsFromFill);
            if ((stats.uncoveredSlots ?? 0) <= 0) break;
        }
        ensureRotativeCellsAssigned(gapFillFinal);
        assignUnassignedWorkDayEmployeesToGaps(gapFillFinal, dayDemandsFromFill);
        finalizeApretarDayAssignments(gapFillFinal, dayDemandsFromFill);
        forceCloseRemainingSlaGaps(gapFillFinal, dayDemandsFromFill);
        repairPositionDayTripletGaps(gapFillFinal, dayDemandsFromFill);
        assignUnassignedWorkDayEmployeesToGaps(gapFillFinal, dayDemandsFromFill);
        forceCloseRemainingSlaGaps(gapFillFinal, dayDemandsFromFill);
        if (ctx.strictSixTwo === true && (stats.uncoveredSlots ?? 0) > 0) {
            for (let strictRound = 0; strictRound < 12 && (stats.uncoveredSlots ?? 0) > 0; strictRound++) {
                assignUnassignedWorkDayEmployeesToGaps(gapFillFinal, dayDemandsFromFill);
                repairPositionDayTripletGaps(gapFillFinal, dayDemandsFromFill);
                forceCloseRemainingSlaGaps(gapFillFinal, dayDemandsFromFill);
                recomputeUncoveredStats(gapFillFinal, dayDemandsFromFill);
            }
        }
        recomputeUncoveredStats(gapFillFinal, dayDemandsFromFill);
    }

    stripUnauthorizedRetAssignments(assignments, ctx, retDesignateSet);

    const francoGuard = enforceFrancoStreakRules({
        assignments,
        ctx,
        priorAssignments: syntheticPrevAssignments,
        cycleWorkDays,
    });
    stats.francoGuardConvertedToRet = francoGuard.convertedToRet;
    stats.francoGuardRejectedMissing48h = francoGuard.rejectedMissing48h;
    stats.francoGuardRejectedOverTwoConsecutive = francoGuard.rejectedOverTwoConsecutive;

    if (gapFillFinal && ((stats.uncoveredSlots ?? 0) > 0 || (!ctx.strictSixTwo && francoGuard.convertedToRet > 0))) {
        fillDemandGapsBeforeFrancos(gapFillFinal, dayDemandsFromFill);
        if (!ctx.strictSixTwo) {
            fillDemandGapsWithFlexibleCycle(gapFillFinal, dayDemandsFromFill);
        }
        forceCloseRemainingSlaGaps(gapFillFinal, dayDemandsFromFill);
        recomputeUncoveredStats(gapFillFinal, dayDemandsFromFill);
        stripUnauthorizedRetAssignments(assignments, ctx, retDesignateSet);
    }

    if (ctx.rotateShifts === false) {
        enforceFixedBandFrancoRetCap(assignments, ctx, cycleWorkDays);
    }

    // Segundo pase del franco guard: captura F consecutivos generados en pases finales.
    if (ctx.rotateShifts !== false) {
        enforceFrancoStreakRules({
            assignments,
            ctx,
            priorAssignments: syntheticPrevAssignments,
            cycleWorkDays,
        });
    }

    // Último pase: convertir a RET cualquier transición N→T/M o T→M que sobrevivió todos los guards.
    if (ctx.rotateShifts !== false) {
        for (const emp of ctx.employees) {
            for (const day of ctx.daysInMonth) {
                const dateStr = ctx.getDateKey(day);
                const a = assignments.find(x =>
                    x.empId === emp.id && x.dateStr === dateStr && (x.hours ?? 0) > 0 && !x.isFranco,
                );
                if (!a) continue;
                if (assignmentBreaksBandTransition(assignments, emp.id, dateStr, String(a.code))) {
                    stats.totalBillableHours = Math.max(0, (stats.totalBillableHours || 0) - (Number(a.hours) || 0));
                    a.code = 'RET';
                    a.name = 'Retén';
                    a.hours = 0;
                    a.positionName = '';
                    a.startTime = '00:00';
                    a.isReten = true;
                    delete a.endTime;
                }
            }
        }
    }

    // Empleados que pasaron 200h en el ciclo actual (no debería pasar pero auditamos)
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        if (customCoverEmps.has(emp.id)) continue;
        if (st.cycleCurrentUsed > hardMax || st.cycleNextUsed > hardMax) {
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

    {
        const retByDay: Record<string, number> = {};
        for (const a of assignments) {
            if (String(a.code || '').toUpperCase() !== 'RET') continue;
            retByDay[a.dateStr] = (retByDay[a.dateStr] || 0) + 1;
        }
        const counts = Object.values(retByDay);
        stats.overCoverageRetDays = counts.filter(n => n >= 2).length;
        stats.maxRetConcurrent = counts.length > 0 ? Math.max(...counts) : 0;
    }
    stats.ajustarCrono = ctx.ajustarCrono === true;
    stats.apretarCronoDays = ctx.apretarCronoDays?.length ? [...ctx.apretarCronoDays] : undefined;

    // Métricas SLA finales (siempre; rotativo demand-driven no usa CIERRE SLA inflado).
    {
        const slaTarget = Math.round(Math.max(0, ctx.slaVendidas || contractedH || 0));
        if (slaTarget > 0) {
            stats.slaDeficitRemaining = Math.max(0, Math.round((slaTarget - stats.totalBillableHours) * 10) / 10);
            const slotsOk = (stats.uncoveredSlots ?? 0) <= 0;
            stats.slaHoursClosed = stats.slaDeficitRemaining <= 0.5 && slotsOk;
        }
    }

    // Cobertura por ciclo: contar slots faltantes (qty − trabajadores reales por día y puesto).
    // Un slot faltante = un día en que la dotación del puesto queda por debajo de lo requerido.
    let coverageViolations = 0;
    ctx.daysInMonth.forEach(day => {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        ctx.positions.forEach(pos => {
            if (!positionIsActiveOn(pos, dayLetter)) return;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const group = positionGroups[pos.positionName] || [];
            const workers = group.filter(eid => cycleWorkDays[eid]?.has(dateStr)).length;
            if (workers < qty) coverageViolations += qty - workers;
        });
    });

    return { feasibility, assignments, stats, capOverflowSlots, coverageViolations };
}

/**
 * Punto de entrada del motor V2 — fase viabilidad (no genera celdas todavía).
 * Usar `generateScheduleV2(ctx)` para obtener asignaciones.
 */
export function runAutoScheduleV2(ctx: V2EngineContext): V2EngineResult {
    const explicit = ctx.autoCycles?.length;
    if (explicit) {
        return { feasibility: checkFeasibility(ctx), changes: {} };
    }
    const picked = pickOptimalAutoCycles(ctx);
    return { feasibility: picked.feasibility, changes: {} };
}
