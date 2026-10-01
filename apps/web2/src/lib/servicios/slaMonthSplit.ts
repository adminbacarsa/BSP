/**
 * Vigencia de un SLA por meses: agrupados (un doc) o individuales (un doc por mes calendario).
 * Sin Firebase. Lo usa el alta/edición de Servicios y el eval S8.
 */

export type SlaMonthsMode = 'agrupados' | 'individuales';

export type SlaMonthSegment = {
  startDate: string;
  endDate: string;
  /** yyyy-mm */
  monthKey: string;
  /** «nov 2026» */
  label: string;
  partial: boolean;
};

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (n: number) => String(n).padStart(2, '0');

function parseYmd(v: string): { y: number; m: number; d: number } | null {
  const s = String(v || '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null;
  return { y, m, d };
}

export function formatDmy(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : String(ymd || '');
}

/** null si las fechas sirven. Mensaje claro si falta una o si hasta < desde. */
export function validateSlaRange(startDate: string, endDate: string): string | null {
  const s = parseYmd(startDate);
  const e = parseYmd(endDate);
  if (!s || !e) return 'Completá la fecha desde y la fecha hasta';
  if (endDate.slice(0, 10) < startDate.slice(0, 10)) {
    return `La fecha hasta (${formatDmy(endDate)}) es anterior a la fecha desde (${formatDmy(startDate)})`;
  }
  return null;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS_SHORT[(m || 1) - 1]} ${y}`;
}

/** Un segmento por mes calendario. El primero arranca en desde; el último termina en hasta. */
export function splitRangeByCalendarMonth(startDate: string, endDate: string): SlaMonthSegment[] {
  if (validateSlaRange(startDate, endDate)) return [];
  const s = parseYmd(startDate)!;
  const e = parseYmd(endDate)!;
  const out: SlaMonthSegment[] = [];
  let y = s.y;
  let m = s.m;
  while (y < e.y || (y === e.y && m <= e.m)) {
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${y}-${pad(m)}-01`;
    const monthEnd = `${y}-${pad(m)}-${pad(lastDay)}`;
    const segStart = monthStart < startDate ? startDate.slice(0, 10) : monthStart;
    const segEnd = monthEnd > endDate ? endDate.slice(0, 10) : monthEnd;
    const monthKey = `${y}-${pad(m)}`;
    out.push({
      startDate: segStart,
      endDate: segEnd,
      monthKey,
      label: monthLabel(monthKey),
      partial: segStart !== monthStart || segEnd !== monthEnd,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Agrupados = un segmento con la vigencia entera. Individuales = uno por mes. */
export function slaSegmentsForMode(mode: SlaMonthsMode, startDate: string, endDate: string): SlaMonthSegment[] {
  if (validateSlaRange(startDate, endDate)) return [];
  if (mode === 'individuales') return splitRangeByCalendarMonth(startDate, endDate);
  const months = splitRangeByCalendarMonth(startDate, endDate);
  return [{
    startDate: startDate.slice(0, 10),
    endDate: endDate.slice(0, 10),
    monthKey: months[0]?.monthKey || startDate.slice(0, 7),
    label: months.length > 1 ? `${months[0].label} → ${months[months.length - 1].label}` : months[0]?.label || '',
    partial: false,
  }];
}

export function summarizeSlaSplit(segments: SlaMonthSegment[]): string {
  if (segments.length <= 1) return segments.length === 1 ? 'Se va a crear 1 servicio' : 'No hay meses para crear';
  return `Se van a crear ${segments.length} servicios: ${segments.map((s) => s.label).join(', ')}`;
}

export type SlaRangeLike = {
  id?: string;
  clientId?: string;
  objectiveId?: string;
  startDate?: string;
  endDate?: string;
};

function rangesTouch(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Meses de los segmentos que pisan otro SLA del mismo cliente y objetivo.
 * El propio doc (excludeId) no cuenta. Sin fechas no hay solape.
 */
export function overlappingSegments(
  segments: SlaMonthSegment[],
  existing: SlaRangeLike[],
  target: { clientId: string; objectiveId: string },
  excludeId?: string | null,
): SlaMonthSegment[] {
  const others = existing.filter((s) => {
    if (!s.startDate || !s.endDate) return false;
    if (excludeId && s.id === excludeId) return false;
    return String(s.clientId || '') === target.clientId && String(s.objectiveId || '') === target.objectiveId;
  });
  return segments.filter((seg) =>
    others.some((o) => rangesTouch(seg.startDate, seg.endDate, String(o.startDate).slice(0, 10), String(o.endDate).slice(0, 10))),
  );
}

export function newSlaSeriesId(now = Date.now()): string {
  return `sla_series_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Un borrador por segmento con la misma estructura. Cada doc tiene su vigencia;
 * `slaSeriesId` los enlaza. En agrupados no se agrega serie.
 */
export function buildSlaDraftsForSegments<T extends { startDate: string; endDate: string }>(
  base: T,
  segments: SlaMonthSegment[],
  seriesId?: string | null,
): T[] {
  return segments.map((seg) => ({
    ...base,
    startDate: seg.startDate,
    endDate: seg.endDate,
    ...(segments.length > 1 && seriesId ? { slaSeriesId: seriesId } : {}),
  }));
}
