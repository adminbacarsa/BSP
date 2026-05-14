/**
 * Motor de optimización de margen laboral vs SLA (referencia CCT / esquemas de rotación).
 * No reemplaza liquidación ni planificación; compara escenarios de dotación y extras.
 */

import defaultVariables from './serviceMarginOptimizer.variables.json';

export enum WorkScheme {
    SixTwo = '6x2',
    SixOne = '6x1',
    FourTwo = '4x2',
}

export const WORK_SCHEME_ORDER: WorkScheme[] = [WorkScheme.SixTwo, WorkScheme.SixOne, WorkScheme.FourTwo];

/** Redondeo de días trabajados dentro del mes (ver `billableHoursOneHeadInMonth`). */
export type BillableWorkDayRounding = 'rational_hours' | 'ceil_workdays';

const SCHEME_CYCLE: Record<WorkScheme, { cycleDays: number; workDaysPerCycle: number; shiftHours: number }> = {
    [WorkScheme.SixTwo]: { cycleDays: 8, workDaysPerCycle: 6, shiftHours: 8 },
    [WorkScheme.SixOne]: { cycleDays: 7, workDaysPerCycle: 6, shiftHours: 8 },
    [WorkScheme.FourTwo]: { cycleDays: 6, workDaysPerCycle: 4, shiftHours: 12 },
};

/** Días del mes calendario (28–31), sin asumir “4 semanas”. */
export function daysInCalendarMonth(year: number, monthIndex0to11: number): number {
    return new Date(year, monthIndex0to11 + 1, 0).getDate();
}

/**
 * Horas de presencia modelo por cabeza en un mes de `daysInMonth` días.
 * Días trabajados = (díasMes ÷ díasCiclo) × díasTrabajoPorCiclo (continuo), o techo de días enteros si `ceil_workdays`.
 */
export function billableHoursOneHeadInMonth(
    daysInMonth: number,
    scheme: WorkScheme,
    rounding: BillableWorkDayRounding,
): number {
    const { cycleDays, workDaysPerCycle, shiftHours } = SCHEME_CYCLE[scheme];
    if (!Number.isFinite(daysInMonth) || daysInMonth <= 0 || cycleDays <= 0) return 0;
    if (rounding === 'ceil_workdays') {
        const workDays = Math.ceil((daysInMonth * workDaysPerCycle) / cycleDays);
        return workDays * shiftHours;
    }
    return (daysInMonth / cycleDays) * workDaysPerCycle * shiftHours;
}

export function billableHoursBySchemeForMonthDays(
    daysInMonth: number,
    rounding: BillableWorkDayRounding,
): Record<WorkScheme, number> {
    const o = {} as Record<WorkScheme, number>;
    for (const s of WORK_SCHEME_ORDER) {
        o[s] = billableHoursOneHeadInMonth(daysInMonth, s, rounding);
    }
    return o;
}

function readSchemeBillableConfig(j: {
    schemeBillableHours?: { workDayRounding?: string; fallbackDaysInMonth?: number };
}): { rounding: BillableWorkDayRounding; fallbackDaysInMonth: number } {
    const rounding: BillableWorkDayRounding =
        j.schemeBillableHours?.workDayRounding === 'ceil_workdays' ? 'ceil_workdays' : 'rational_hours';
    const fd = Number(j.schemeBillableHours?.fallbackDaysInMonth);
    const fallbackDaysInMonth = Number.isFinite(fd) ? Math.min(31, Math.max(28, fd)) : 30;
    return { rounding, fallbackDaysInMonth };
}

export interface ServiceMarginVariables {
    totalSlaHours: number;
    sellingPricePerHour: number;
    /** Costo empresa cargado por empleado y mes (ARS), antes de extras. */
    baseEmployeeCostMonthlyARS: number;
    /** Tope de horas “normales” por empleado en la ventana (p. ej. 192 SUVICO). */
    maxNormalHoursPerEmployee: number;
    overtime50Multiplier: number;
    overtime100Multiplier: number;
    /** Horas de presencia modelo por cabeza/mes por esquema (ciclo rotación × días del mes; ver `billableHoursBySchemeForMonthDays`). */
    averageBillableHoursPerEmployeeByScheme: Record<WorkScheme, number>;
}

export interface SchemeMarginRow {
    scheme: WorkScheme;
    /** Cabezas usadas en el cálculo (manual o sugeridas). */
    headcountUsed: number;
    /** Sugerencia automática ceil(SLA / hs promedio esquema). */
    suggestedHeadcount: number;
    /** Cabezas mínimas para cubrir el SLA al ritmo medio de facturación del esquema. */
    employeesNeeded: number;
    /** max(0, N×tope hs normales − SLA): holgura bajo cupo normativo (p. ej. 192 h). */
    reserveHours: number;
    /** max(0, SLA − N×tope hs normales): suplementarias bajo ese mismo cupo. */
    overtimeHours: number;
    baseLaborARS: number;
    overtimeCostARS: number;
    totalLaborARS: number;
    revenueARS: number;
    grossMarginARS: number;
    marginPct: number;
    /** Costo marginal estimado de 1h extra vs precio vendido. */
    marginalOvertimeCostPerHourARS: number;
    losesMoneyOnOvertime: boolean;
}

export interface ServiceMarginEvaluation {
    variables: ServiceMarginVariables;
    rows: SchemeMarginRow[];
    winnerByMargin: WorkScheme;
    winnerByOperationalSafety: WorkScheme;
    /** Avisos de negocio (pérdida por extra, déficit de reserva, etc.). */
    alerts: string[];
}

export function mergeDefaultServiceMarginVariables(partial: Partial<ServiceMarginVariables>): ServiceMarginVariables {
    const j = defaultVariables as Omit<ServiceMarginVariables, 'totalSlaHours' | 'averageBillableHoursPerEmployeeByScheme'> & {
        averageBillableHoursPerEmployeeByScheme?: Record<string, number>;
        schemeBillableHours?: { workDayRounding?: string; fallbackDaysInMonth?: number };
    };
    const schemes: WorkScheme[] = [WorkScheme.SixTwo, WorkScheme.SixOne, WorkScheme.FourTwo];
    const { rounding, fallbackDaysInMonth } = readSchemeBillableConfig(j);
    const computedFallback = billableHoursBySchemeForMonthDays(fallbackDaysInMonth, rounding);
    const avg: Record<WorkScheme, number> = { ...partial.averageBillableHoursPerEmployeeByScheme } as Record<WorkScheme, number>;
    for (const s of schemes) {
        if (avg[s] == null || !Number.isFinite(avg[s])) {
            const legacy = j.averageBillableHoursPerEmployeeByScheme?.[s];
            avg[s] = Number.isFinite(Number(legacy)) ? Number(legacy) : computedFallback[s];
        }
    }
    return {
        totalSlaHours: partial.totalSlaHours ?? 0,
        sellingPricePerHour: partial.sellingPricePerHour ?? j.sellingPricePerHour,
        baseEmployeeCostMonthlyARS: partial.baseEmployeeCostMonthlyARS ?? j.baseEmployeeCostMonthlyARS,
        maxNormalHoursPerEmployee: partial.maxNormalHoursPerEmployee ?? j.maxNormalHoursPerEmployee,
        overtime50Multiplier: partial.overtime50Multiplier ?? j.overtime50Multiplier,
        overtime100Multiplier: partial.overtime100Multiplier ?? j.overtime100Multiplier,
        averageBillableHoursPerEmployeeByScheme: avg,
    };
}

export type LaborCostInputMode = 'monthly_loaded' | 'hourly_loaded' | 'salary_structure';

export type LaborCostFormInput = {
    sellingPricePerHour: number | '';
    laborMode: LaborCostInputMode;
    monthlyLoaded: number | '';
    hourlyLoaded: number | '';
    salaryMonthly: number | '';
    structureMonthly: number | '';
    overtime50Multiplier: number | '';
    overtime100Multiplier: number | '';
    /** Si viene, las hs/cabeza por esquema usan los días reales de ese mes (no “4 semanas”). */
    billableCalendarYear?: number;
    billableCalendarMonth?: number;
    /** Si se omite, se usa `schemeBillableHours.workDayRounding` del JSON. */
    billableRounding?: BillableWorkDayRounding;
};

/** Arma variables del simulador a partir de lo que el usuario ingresa en el modal (modos de costo laboral). */
export function buildServiceMarginVariablesForUi(slaHours: number, input: LaborCostFormInput): ServiceMarginVariables {
    const j = defaultVariables as {
        schemeBillableHours?: { workDayRounding?: string; fallbackDaysInMonth?: number };
    };
    const { rounding: jsonRounding, fallbackDaysInMonth } = readSchemeBillableConfig(j);
    const rounding: BillableWorkDayRounding = input.billableRounding ?? jsonRounding;

    const p: Partial<ServiceMarginVariables> = {
        totalSlaHours: slaHours,
    };
    if (input.sellingPricePerHour !== '') p.sellingPricePerHour = Number(input.sellingPricePerHour);
    if (input.overtime50Multiplier !== '') p.overtime50Multiplier = Number(input.overtime50Multiplier);
    if (input.overtime100Multiplier !== '') p.overtime100Multiplier = Number(input.overtime100Multiplier);

    const merged = mergeDefaultServiceMarginVariables(p);
    const maxH = Math.max(1, merged.maxNormalHoursPerEmployee);
    let base = merged.baseEmployeeCostMonthlyARS;

    if (input.laborMode === 'monthly_loaded') {
        if (input.monthlyLoaded !== '') base = Math.max(0, Number(input.monthlyLoaded));
    } else if (input.laborMode === 'hourly_loaded') {
        if (input.hourlyLoaded !== '') base = Math.max(0, Number(input.hourlyLoaded)) * maxH;
    } else {
        const sa = input.salaryMonthly === '' ? 0 : Math.max(0, Number(input.salaryMonthly));
        const st = input.structureMonthly === '' ? 0 : Math.max(0, Number(input.structureMonthly));
        if (sa > 0 || st > 0) base = sa + st;
    }

    const useCal =
        input.billableCalendarYear != null &&
        input.billableCalendarMonth != null &&
        Number.isFinite(input.billableCalendarYear) &&
        Number.isFinite(input.billableCalendarMonth);
    const daysInMonth = useCal
        ? daysInCalendarMonth(input.billableCalendarYear!, input.billableCalendarMonth!)
        : fallbackDaysInMonth;
    const avgMap = billableHoursBySchemeForMonthDays(daysInMonth, rounding);

    return mergeDefaultServiceMarginVariables({ ...p, baseEmployeeCostMonthlyARS: base, averageBillableHoursPerEmployeeByScheme: avgMap });
}

function effectiveOvertimeMultiplier(scheme: WorkScheme, v: ServiceMarginVariables): number {
    if (scheme === WorkScheme.FourTwo) {
        return 0.5 * v.overtime100Multiplier + 0.5 * v.overtime50Multiplier;
    }
    return v.overtime50Multiplier;
}

/** Ayuda UI: cómo se arma el costo variable de extras (alineado a `effectiveOvertimeMultiplier`). */
export function overtimeVariableCostExplanationLines(
    v: Pick<ServiceMarginVariables, 'maxNormalHoursPerEmployee' | 'overtime50Multiplier' | 'overtime100Multiplier'>,
): string[] {
    const maxH = Math.max(1, Math.round(v.maxNormalHoursPerEmployee));
    const m50 = v.overtime50Multiplier;
    const m100 = v.overtime100Multiplier;
    const mix = 0.5 * m100 + 0.5 * m50;
    const mixStr = Number.isInteger(mix) ? String(mix) : mix.toFixed(2).replace(/\.?0+$/, '');
    return [
        `Costo hora “normal” modelo = (costo mensual por empleado) ÷ ${maxH} (tope de horas normales del período).`,
        `Cada hora que excede N×${maxH} se valora al costo marginal: (costo hora normal) × recargo del esquema.`,
        `6×2 y 6×1: recargo ×${m50}. 4×2: 50% al ×${m100} + 50% al ×${m50} → efectivo ×${mixStr}.`,
        'Costo extras (variable) = horas extra necesarias × costo marginal hora extra.',
    ];
}

function buildSchemeRow(
    scheme: WorkScheme,
    v: ServiceMarginVariables,
    sla: number,
    revenueARS: number,
    normalHourCostARS: number,
    headcountOverride: number | undefined,
): SchemeMarginRow {
    const avgBillable = Math.max(1, v.averageBillableHoursPerEmployeeByScheme[scheme] || 192);
    const suggestedHeadcount = sla <= 0 ? 0 : Math.ceil(sla / avgBillable);
    const headcountUsed =
        headcountOverride != null && Number.isFinite(headcountOverride)
            ? Math.max(0, Math.floor(headcountOverride))
            : suggestedHeadcount;
    const capacityNormal = headcountUsed * v.maxNormalHoursPerEmployee;
    const overtimeHours = Math.max(0, sla - capacityNormal);
    const reserveHours = Math.max(0, capacityNormal - sla);
    const otMult = effectiveOvertimeMultiplier(scheme, v);
    const marginalOvertimeCostPerHourARS = normalHourCostARS * otMult;
    const overtimeCostARS = overtimeHours * marginalOvertimeCostPerHourARS;
    const baseLaborARS = headcountUsed * v.baseEmployeeCostMonthlyARS;
    const totalLaborARS = baseLaborARS + overtimeCostARS;
    const grossMarginARS = revenueARS - totalLaborARS;
    const marginPct = revenueARS > 1e-6 ? (grossMarginARS / revenueARS) * 100 : 0;
    const losesMoneyOnOvertime = marginalOvertimeCostPerHourARS > v.sellingPricePerHour + 1e-6;
    return {
        scheme,
        headcountUsed,
        suggestedHeadcount,
        employeesNeeded: suggestedHeadcount,
        reserveHours,
        overtimeHours,
        baseLaborARS,
        overtimeCostARS,
        totalLaborARS,
        revenueARS,
        grossMarginARS,
        marginPct,
        marginalOvertimeCostPerHourARS,
        losesMoneyOnOvertime,
    };
}

/**
 * Evalúa los tres esquemas para un mismo SLA mensual y mismas variables económicas.
 * `headcounts`: si se pasa un número para un esquema, se usa como dotación fija (p. ej. 15 en 4×2 vs 18 en 6×2).
 */
export function evaluateServiceMargin(
    v: ServiceMarginVariables,
    headcounts?: Partial<Record<WorkScheme, number | null | undefined>>,
): ServiceMarginEvaluation {
    const sla = Math.max(0, Number(v.totalSlaHours) || 0);
    const revenueARS = sla * v.sellingPricePerHour;
    const normalHourCostARS = v.baseEmployeeCostMonthlyARS / Math.max(1, v.maxNormalHoursPerEmployee);

    const rows: SchemeMarginRow[] = WORK_SCHEME_ORDER.map((scheme) => {
        const raw = headcounts?.[scheme];
        const override =
            raw === undefined || raw === null || !Number.isFinite(Number(raw))
                ? undefined
                : Math.floor(Number(raw));
        return buildSchemeRow(scheme, v, sla, revenueARS, normalHourCostARS, override);
    });

    const winnerByMargin =
        rows.length === 0 ? WorkScheme.SixTwo : rows.reduce((a, b) => (b.grossMarginARS > a.grossMarginARS ? b : a)).scheme;
    const winnerByOperationalSafety =
        rows.length === 0
            ? WorkScheme.SixTwo
            : rows.reduce((best, r) => {
                  if (r.reserveHours !== best.reserveHours) return r.reserveHours > best.reserveHours ? r : best;
                  if (r.overtimeHours !== best.overtimeHours) return r.overtimeHours < best.overtimeHours ? r : best;
                  return best;
              }).scheme;

    const alerts: string[] = [];
    if (sla > 0) {
        for (const r of rows) {
            if (r.losesMoneyOnOvertime && r.overtimeHours > 0) {
                alerts.push(
                    `Esquema ${r.scheme}: el costo marginal estimado de hora extra (~$${Math.round(r.marginalOvertimeCostPerHourARS).toLocaleString('es-AR')}) supera el valor hora vendido ($${Math.round(v.sellingPricePerHour).toLocaleString('es-AR')}).`,
                );
            }
            if (r.reserveHours < 0) {
                /* reservadas nunca <0 con fórmula actual; por si cambia modelo */
            }
        }
        const worstReserve = rows.reduce((a, b) => (a.reserveHours < b.reserveHours ? a : b));
        if (worstReserve.reserveHours <= 0 && worstReserve.overtimeHours > 0) {
            alerts.push(
                `Con ${worstReserve.scheme} no hay “colchón” de reserva bajo el modelo N×${v.maxNormalHoursPerEmployee}h: todo el cupo normal se consume y hay ${Math.round(worstReserve.overtimeHours)}h modeladas como extra.`,
            );
        }
    }

    return {
        variables: v,
        rows,
        winnerByMargin,
        winnerByOperationalSafety,
        alerts,
    };
}

export function formatARS(n: number): string {
    return Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

/** Tres columnas tipo “18 pers. 6×2 / 17 pers. 6×1 / 15 pers. 4×2” con la misma demanda SLA. */
export interface NominaScenarioColumnInput {
    id: string;
    label: string;
    scheme: WorkScheme;
    headcount: number;
}

export interface NominaScenarioColumnResult {
    id: string;
    label: string;
    scheme: WorkScheme;
    headcount: number;
    /** N × hs/mes promedio según esquema de rotación (ver `averageBillableHoursPerEmployeeByScheme`). */
    capacityBillableHours: number;
    /** Hs promedio por empleado usadas para la capacidad de esa columna. */
    billableHoursPerEmployee: number;
    slaDemand: number;
    normalHours: number;
    overtimeHours: number;
    payrollFixedARS: number;
    overtimeVariableARS: number;
    totalLaborARS: number;
    revenueARS: number;
    grossMarginARS: number;
    marginPct: number;
    marginalOvertimeCostPerHourARS: number;
    losesMoneyOnOvertime: boolean;
}

export interface AdjustedNominaEvaluation {
    variables: ServiceMarginVariables;
    columns: NominaScenarioColumnResult[];
    winnerColumnId: string;
    winnerLabel: string;
    alerts: string[];
}

export function defaultNominaComparisonScenarios(): NominaScenarioColumnInput[] {
    return [
        { id: 's62', label: '18 pers. 6×2', scheme: WorkScheme.SixTwo, headcount: 18 },
        { id: 's61', label: '17 pers. 6×1', scheme: WorkScheme.SixOne, headcount: 17 },
        { id: 'f42', label: '15 pers. 4×2', scheme: WorkScheme.FourTwo, headcount: 15 },
    ];
}

export function schemeLabelShort(scheme: WorkScheme): string {
    if (scheme === WorkScheme.SixTwo) return '6×2';
    if (scheme === WorkScheme.SixOne) return '6×1';
    return '4×2';
}

/** Texto de cabecera alineado con N y el esquema (p. ej. "17 pers. 6×1"). */
export function suggestedNominaColumnLabel(n: number, scheme: WorkScheme): string {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    return `${k} pers. ${schemeLabelShort(scheme)}`;
}

/**
 * Comparativa de costo real y margen con dotación fija por columna (nómina ajustada).
 * Capacidad = N × hs/cabeza del mes según ciclo (6×2: 8d, 6×1: 7d, 4×2: 6d; días del mes calendario, no “× 4 semanas”).
 * Horas normales = min(SLA, capacidad); extras = resto. Costo hora base extras = costo mensual ÷ tope (p. ej. 192 h SUVICO).
 */
export function evaluateAdjustedNominaScenarios(
    slaHours: number,
    variables: ServiceMarginVariables,
    scenarios: NominaScenarioColumnInput[],
): AdjustedNominaEvaluation {
    const sla = Math.max(0, Number(slaHours) || 0);
    const revenue = sla * variables.sellingPricePerHour;
    const costPerNormalHour = variables.baseEmployeeCostMonthlyARS / Math.max(1, variables.maxNormalHoursPerEmployee);

    const columns: NominaScenarioColumnResult[] = scenarios.map((sc) => {
        const N = Math.max(0, Math.floor(Number(sc.headcount) || 0));
        const rawAvg = variables.averageBillableHoursPerEmployeeByScheme[sc.scheme];
        const hrsPerHead = Math.max(
            1,
            typeof rawAvg === 'number' && Number.isFinite(rawAvg) && rawAvg > 0 ? rawAvg : variables.maxNormalHoursPerEmployee,
        );
        const cap = N * hrsPerHead;
        const normalH = Math.min(sla, cap);
        const otH = Math.max(0, sla - cap);
        const otMult = effectiveOvertimeMultiplier(sc.scheme, variables);
        const marginalOvertimeCostPerHourARS = costPerNormalHour * otMult;
        const payrollFixed = N * variables.baseEmployeeCostMonthlyARS;
        const overtimeVariable = otH * marginalOvertimeCostPerHourARS;
        const totalLabor = payrollFixed + overtimeVariable;
        const grossMargin = revenue - totalLabor;
        const marginPct = revenue > 1e-6 ? (grossMargin / revenue) * 100 : 0;
        const losesMoneyOnOvertime = marginalOvertimeCostPerHourARS > variables.sellingPricePerHour + 1e-6;
        return {
            id: sc.id,
            label: sc.label,
            scheme: sc.scheme,
            headcount: N,
            capacityBillableHours: cap,
            billableHoursPerEmployee: hrsPerHead,
            slaDemand: sla,
            normalHours: normalH,
            overtimeHours: otH,
            payrollFixedARS: payrollFixed,
            overtimeVariableARS: overtimeVariable,
            totalLaborARS: totalLabor,
            revenueARS: revenue,
            grossMarginARS: grossMargin,
            marginPct,
            marginalOvertimeCostPerHourARS,
            losesMoneyOnOvertime,
        };
    });

    const winner =
        columns.length === 0
            ? null
            : columns.reduce((a, b) => (b.grossMarginARS > a.grossMarginARS ? b : a), columns[0]);
    const winnerColumnId = winner?.id ?? '';
    const winnerLabel = winner?.label ?? '';

    const alerts: string[] = [];
    if (sla > 0) {
        for (const c of columns) {
            if (c.losesMoneyOnOvertime && c.overtimeHours > 0) {
                alerts.push(
                    `${c.label}: costo marginal hora extra (~$${Math.round(c.marginalOvertimeCostPerHourARS).toLocaleString('es-AR')}) > precio vendido ($${Math.round(variables.sellingPricePerHour).toLocaleString('es-AR')}).`,
                );
            }
        }
    }

    return {
        variables,
        columns,
        winnerColumnId,
        winnerLabel,
        alerts,
    };
}

/** Icono en listado: usa la comparativa estándar 18/17/15 vs SLA. */
export function marginNominaScenariosIconMeta(slaHours: number, variables: ServiceMarginVariables): {
    tone: 'emerald' | 'amber' | 'rose' | 'slate';
    shortLabel: string;
    hint: string;
} {
    const sla = Math.max(0, Number(slaHours) || 0);
    if (sla <= 0) {
        return { tone: 'slate', shortLabel: '—', hint: 'Sin horas SLA para simular (elegí un mes con contrato activo).' };
    }
    const ev = evaluateAdjustedNominaScenarios(sla, variables, defaultNominaComparisonScenarios());
    const best = ev.columns.reduce((a, b) => (b.grossMarginARS > a.grossMarginARS ? b : a));
    const anyNeg = ev.columns.some((c) => c.grossMarginARS < 0);
    if (best.grossMarginARS < 0) {
        return {
            tone: 'rose',
            shortLabel: 'Riesgo',
            hint: `Con el ejemplo 18/17/15 nadie cierra margen positivo a ${Math.round(sla)} h.`,
        };
    }
    if (best.losesMoneyOnOvertime && best.overtimeHours > 0) {
        return { tone: 'amber', shortLabel: 'Extras', hint: `Mejor: ${best.label}, pero con extras caras vs precio hora.` };
    }
    if (anyNeg) {
        return { tone: 'amber', shortLabel: 'Mixto', hint: `Mejor margen: ${best.label}. Otra columna queda en rojo.` };
    }
    return {
        tone: 'emerald',
        shortLabel: 'OK',
        hint: `Mejor escenario ejemplo: ${best.label} (${best.marginPct.toFixed(1)}% margen).`,
    };
}

/** @deprecated usar marginNominaScenariosIconMeta para UI de nómina ajustada */
export function marginEvaluationIconMeta(ev: ServiceMarginEvaluation): {
    tone: 'emerald' | 'amber' | 'rose' | 'slate';
    shortLabel: string;
    hint: string;
} {
    return marginNominaScenariosIconMeta(ev.variables.totalSlaHours, ev.variables);
}
