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

/**
 * Evalúa los tres esquemas para un mismo SLA mensual y mismas variables económicas.
 */
export function evaluateServiceMargin(v: ServiceMarginVariables): ServiceMarginEvaluation {
    const sla = Math.max(0, Number(v.totalSlaHours) || 0);
    const revenueARS = sla * v.sellingPricePerHour;
    const normalHourCostARS = v.baseEmployeeCostMonthlyARS / Math.max(1, v.maxNormalHoursPerEmployee);

    const rows: SchemeMarginRow[] = WORK_SCHEME_ORDER.map((scheme) => {
        const avgBillable = Math.max(1, v.averageBillableHoursPerEmployeeByScheme[scheme] || 192);
        const employeesNeeded = sla <= 0 ? 0 : Math.ceil(sla / avgBillable);
        const capacityNormal = employeesNeeded * v.maxNormalHoursPerEmployee;
        const overtimeHours = Math.max(0, sla - capacityNormal);
        const reserveHours = Math.max(0, capacityNormal - sla);
        const otMult = effectiveOvertimeMultiplier(scheme, v);
        const marginalOvertimeCostPerHourARS = normalHourCostARS * otMult;
        const overtimeCostARS = overtimeHours * marginalOvertimeCostPerHourARS;
        const baseLaborARS = employeesNeeded * v.baseEmployeeCostMonthlyARS;
        const totalLaborARS = baseLaborARS + overtimeCostARS;
        const grossMarginARS = revenueARS - totalLaborARS;
        const marginPct = revenueARS > 1e-6 ? (grossMarginARS / revenueARS) * 100 : 0;
        const losesMoneyOnOvertime = marginalOvertimeCostPerHourARS > v.sellingPricePerHour + 1e-6;
        return {
            scheme,
            employeesNeeded,
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
