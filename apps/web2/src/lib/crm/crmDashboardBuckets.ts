export type CrmRangeMode = 'month' | 'quarter' | 'semester' | 'year' | 'all';

export type CrmTrendBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function crmCalendarQuarter(month: number): number {
  return Math.floor(Math.max(0, Math.min(11, month)) / 3);
}

export function crmCalendarSemester(month: number): number {
  return Math.max(0, Math.min(11, month)) < 6 ? 0 : 1;
}

function monthBucket(year: number, month: number): CrmTrendBucket {
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    label: `${MONTH_SHORT[month]} ${year}`,
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

export function crmRangeSpan(
  mode: CrmRangeMode,
  month: number,
  year: number,
): { start: Date | null; end: Date | null } {
  if (mode === 'all') return { start: null, end: null };
  if (mode === 'year') {
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
  }
  if (mode === 'quarter') {
    const q = crmCalendarQuarter(month);
    return {
      start: new Date(year, q * 3, 1),
      end: new Date(year, q * 3 + 3, 0, 23, 59, 59, 999),
    };
  }
  if (mode === 'semester') {
    const s = crmCalendarSemester(month);
    return {
      start: new Date(year, s * 6, 1),
      end: new Date(year, s * 6 + 6, 0, 23, 59, 59, 999),
    };
  }
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

export function crmRangeLabel(mode: CrmRangeMode, month: number, year: number): string {
  if (mode === 'all') return 'Todo el histórico';
  if (mode === 'year') return `Año ${year}`;
  if (mode === 'quarter') {
    const q = crmCalendarQuarter(month);
    const startM = q * 3;
    return `T${q + 1} ${year} (${MONTH_SHORT[startM]}–${MONTH_SHORT[startM + 2]})`;
  }
  if (mode === 'semester') {
    return crmCalendarSemester(month) === 0 ? `S1 ${year} (Ene–Jun)` : `S2 ${year} (Jul–Dic)`;
  }
  const last = new Date(year, month + 1, 0).getDate();
  return `${MONTHS_ES[month]} ${year} (1–${last})`;
}

/** Buckets del gráfico = meses del período elegido (misma base que los KPIs). */
export function buildCrmTrendBuckets(
  mode: CrmRangeMode,
  month: number,
  year: number,
): CrmTrendBucket[] {
  if (mode === 'all') {
    const now = new Date();
    const buckets: CrmTrendBucket[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push(monthBucket(d.getFullYear(), d.getMonth()));
    }
    return buckets;
  }
  const { start, end } = crmRangeSpan(mode, month, year);
  if (!start || !end) return [];
  const buckets: CrmTrendBucket[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    buckets.push(monthBucket(y, m));
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return buckets;
}

export function crmTrendChartTitle(mode: CrmRangeMode, month: number, year: number): string {
  if (mode === 'year') return `Tendencia · ${year} (mensual)`;
  if (mode === 'quarter') {
    const q = crmCalendarQuarter(month);
    return `Tendencia · T${q + 1} ${year} (mensual)`;
  }
  if (mode === 'semester') {
    const s = crmCalendarSemester(month);
    return `Tendencia · S${s + 1} ${year} (mensual)`;
  }
  if (mode === 'month') return `Tendencia · ${MONTHS_ES[month]} ${year}`;
  return 'Tendencia · últimos 12 meses (histórico)';
}

export function crmMetricsCacheKey(
  empresaId: string,
  version: number,
  mode: CrmRangeMode,
  month: number,
  year: number,
): string {
  const emp = String(empresaId || '').trim() || '_';
  if (mode === 'all') return `${emp}__v${version}__all`;
  if (mode === 'year') return `${emp}__v${version}__year__${year}`;
  if (mode === 'quarter') return `${emp}__v${version}__quarter__${year}-T${crmCalendarQuarter(month) + 1}`;
  if (mode === 'semester') return `${emp}__v${version}__semester__${year}-S${crmCalendarSemester(month) + 1}`;
  return `${emp}__v${version}__month__${year}-${String(month + 1).padStart(2, '0')}`;
}

export function spanFromBuckets(buckets: CrmTrendBucket[]): { start: Date; end: Date } | null {
  if (!buckets.length) return null;
  return { start: buckets[0].start, end: buckets[buckets.length - 1].end };
}
