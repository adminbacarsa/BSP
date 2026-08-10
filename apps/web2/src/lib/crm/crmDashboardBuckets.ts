export type CrmRangeMode = 'month' | 'year' | 'all';

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

function monthBucket(year: number, month: number): CrmTrendBucket {
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    label: `${MONTH_SHORT[month]} ${year}`,
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

/** Buckets del gráfico según modo de período (misma selección que KPIs del listado). */
export function buildCrmTrendBuckets(
  mode: CrmRangeMode,
  month: number,
  year: number,
): CrmTrendBucket[] {
  if (mode === 'year') {
    return Array.from({ length: 12 }, (_, m) => monthBucket(year, m));
  }
  if (mode === 'month') {
    const buckets: CrmTrendBucket[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      buckets.push(monthBucket(d.getFullYear(), d.getMonth()));
    }
    return buckets;
  }
  const now = new Date();
  const buckets: CrmTrendBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push(monthBucket(d.getFullYear(), d.getMonth()));
  }
  return buckets;
}

export function crmTrendChartTitle(mode: CrmRangeMode, month: number, year: number): string {
  if (mode === 'year') return `Tendencia · ${year} (mensual)`;
  if (mode === 'month') {
    return `Tendencia · ${MONTHS_ES[month]} ${year} y 3 meses previos`;
  }
  return 'Tendencia · últimos 12 meses (histórico)';
}

export function spanFromBuckets(buckets: CrmTrendBucket[]): { start: Date; end: Date } | null {
  if (!buckets.length) return null;
  return { start: buckets[0].start, end: buckets[buckets.length - 1].end };
}
