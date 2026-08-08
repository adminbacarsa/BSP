/** Período de liquidación CCT: del día 26 al día 25 del mes siguiente (cierre = mes del día 25). */

export type CctPayrollPeriod = {
    start: string;
    end: string;
    /** Mes de cierre (1–12), nombre del período en liquidación. */
    closingMonth: number;
    closingYear: number;
};

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/** YYYY-MM-DD en calendario local (sin UTC). */
export function toLocalYmd(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Período CCT cuyo cierre es el mes `closingMonth` (1–12) de `closingYear`. */
export function cctPayrollPeriodForClosingMonth(closingYear: number, closingMonth: number): CctPayrollPeriod {
    const end = new Date(closingYear, closingMonth - 1, 25);
    const start = new Date(closingYear, closingMonth - 2, 26);
    return {
        start: toLocalYmd(start),
        end: toLocalYmd(end),
        closingMonth,
        closingYear,
    };
}

/** Mes de cierre del período CCT que contiene `ref`. */
export function cctClosingMonthForDate(ref: Date = new Date()): { closingYear: number; closingMonth: number } {
    const day = ref.getDate();
    const y = ref.getFullYear();
    const m = ref.getMonth();
    if (day >= 26) {
        const next = new Date(y, m + 1, 1);
        return { closingYear: next.getFullYear(), closingMonth: next.getMonth() + 1 };
    }
    return { closingYear: y, closingMonth: m + 1 };
}

export function getCctPayrollPeriodContaining(ref: Date = new Date()): CctPayrollPeriod {
    const { closingYear, closingMonth } = cctClosingMonthForDate(ref);
    return cctPayrollPeriodForClosingMonth(closingYear, closingMonth);
}

/** offset 0 = período actual, 1 = anterior, etc. */
export function getCctPayrollPeriodByOffset(offsetMonths: number, ref: Date = new Date()): CctPayrollPeriod {
    const { closingYear, closingMonth } = cctClosingMonthForDate(ref);
    const anchor = new Date(closingYear, closingMonth - 1, 1);
    anchor.setMonth(anchor.getMonth() - offsetMonths);
    return cctPayrollPeriodForClosingMonth(anchor.getFullYear(), anchor.getMonth() + 1);
}

export function formatCctPeriodLabel(period: CctPayrollPeriod, locale = 'es-AR'): string {
    const d = new Date(period.closingYear, period.closingMonth - 1, 1);
    const month = d.toLocaleDateString(locale, { month: 'short' });
    return `${month} ${String(period.closingYear).slice(-2)}`;
}

export function formatCctPeriodRangeDisplay(period: CctPayrollPeriod, locale = 'es-AR'): string {
    const fmt = (ymd: string) => {
        const [yy, mm, dd] = ymd.split('-').map(Number);
        return new Date(yy, mm - 1, dd).toLocaleDateString(locale);
    };
    return `${fmt(period.start)} – ${fmt(period.end)}`;
}

export function isSameCctPeriod(
    a: { start: string; end: string },
    b: { start: string; end: string },
): boolean {
    return a.start === b.start && a.end === b.end;
}
