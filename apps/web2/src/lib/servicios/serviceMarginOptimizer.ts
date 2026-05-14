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

export interface ServiceMarginVariables {
    totalSlaHours: number;
    sellingPricePerHour: number;
    /** Costo empresa cargado por empleado y mes (ARS), antes de extras. */
    baseEmployeeCostMonthlyARS: number;
    /** Tope de horas “normales” por empleado en la ventana (p. ej. 192 SUVICO). */
    maxNormalHoursPerEmployee: number;
    overtime50Multiplier: number;
    overtime100Multiplier: number;
    /** Promedio mensual de horas facturables por cabeza según esquema (calendario típico). */
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
    /** max(0, N×192 − SLA): holgura operativa sin disparar extras por tope 192. */
    reserveHours: number;
    /** max(0, SLA − N×192): horas que caen como suplementarias en el modelo. */
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
        averageBillableHoursPerEmployeeByScheme: Record<string, number>;
    };
    const schemes: WorkScheme[] = [WorkScheme.SixTwo, WorkScheme.SixOne, WorkScheme.FourTwo];
    const avg: Record<WorkScheme, number> = { ...partial.averageBillableHoursPerEmployeeByScheme } as Record<WorkScheme, number>;
    for (const s of schemes) {
        if (avg[s] == null || !Number.isFinite(avg[s])) {
            const raw = j.averageBillableHoursPerEmployeeByScheme[s];
            avg[s] = Number.isFinite(raw) ? Number(raw) : 192;
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

function effectiveOvertimeMultiplier(scheme: WorkScheme, v: ServiceMarginVariables): number {
    if (scheme === WorkScheme.FourTwo) {
        return 0.5 * v.overtime100Multiplier + 0.5 * v.overtime50Multiplier;
    }
    return v.overtime50Multiplier;
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
    capacityTotal192: number;
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

/**
 * Comparativa de costo real y margen con dotación fija por columna (nómina ajustada).
 * Horas normales = min(SLA, N×192); extras = max(0, SLA − N×192).
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
        const cap = N * variables.maxNormalHoursPerEmployee;
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
            capacityTotal192: cap,
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
