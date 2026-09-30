/**
 * Art. 197 LCT: entre dos jornadas del mismo legajo tienen que quedar 12 h.
 * El fin de la jornada es el tope de cierre (inicio + 12:59), no el fin planificado:
 * un T 15:00 que cierra por tope a las 03:59 y el T siguiente a las 15:00 deja 11 h 01 min.
 * Mismo objetivo o distintos. Solo aviso: no bloquea guardar ni publicar.
 */
export const LCT_MIN_REST_HOURS = 12;
export const LCT_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;
const CONTINUOUS_MS = 30 * 60 * 1000;
const AR = 'America/Argentina/Buenos_Aires';

const NON_WORK = new Set(['F', 'FF', 'FP', 'V', 'L', 'A', 'E', 'PG', 'AA', 'ART', 'SGS', 'SUS', 'RET']);
const HOURS_BY_CODE: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, ESC: 8, REF: 8, FT: 8, EN: 9 };
const START_HM: Record<string, string> = { M: '07:00', T: '15:00', N: '23:00', D12: '07:00', N12: '19:00', EN: '09:00' };

export type LctShiftInput = {
  employeeId: string;
  employeeName?: string;
  code?: string;
  startTime?: unknown;
  endTime?: unknown;
  hours?: number;
  objectiveId?: string;
  objectiveName?: string;
  /** Día calendario si startTime viene como HH:mm. */
  dateStr?: string;
  origin?: string;
};

export type LctRestGap = {
  employeeId: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  fromCode: string;
  toCode: string;
  fromObjectiveId: string;
  toObjectiveId: string;
  fromObjectiveName: string;
  toObjectiveName: string;
  crossObjective: boolean;
  closeAtLabel: string;
  nextStartLabel: string;
  gapHours: number;
  gapLabel: string;
  cellKeys: string[];
  message: string;
};

function arDateStr(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function arHm(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: AR, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === 'hour')?.value || '00';
  const m = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${h}:${m}`;
}

function instantMs(value: unknown, dateStr?: string): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  const sec = o.seconds ?? o._seconds;
  if (typeof sec === 'number' && sec > 0) return sec * 1000;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const raw = value.trim();
    const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hm && dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(`${dateStr}T${hm[1].padStart(2, '0')}:${hm[2]}:00.000-03:00`).getTime();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00.000-03:00`).getTime();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

function gapLabel(gapHours: number): string {
  const totalMin = Math.round(gapHours * 60);
  const sign = totalMin < 0 ? '-' : '';
  const abs = Math.abs(totalMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${sign}${h} h ${String(m).padStart(2, '0')} min` : `${sign}${h} h`;
}

type Item = {
  employeeId: string;
  employeeName: string;
  start: number;
  end: number;
  code: string;
  objectiveId: string;
  objectiveName: string;
  dateStr: string;
  cellKey: string;
};

function toItem(sh: LctShiftInput): Item | null {
  const employeeId = String(sh.employeeId || '').trim();
  if (!employeeId || employeeId === 'VACANTE') return null;
  if (String(sh.origin || '').toUpperCase() === 'SLA_VIRTUAL') return null;
  const code = String(sh.code || '').toUpperCase();
  if (!code || NON_WORK.has(code)) return null;
  const dateHint = String(sh.dateStr || '').slice(0, 10);
  let start = instantMs(sh.startTime, dateHint);
  if (start == null && dateHint && START_HM[code]) start = instantMs(START_HM[code], dateHint);
  if (start == null) return null;
  const hours = Number(sh.hours) > 0 ? Number(sh.hours) : (HOURS_BY_CODE[code] ?? 8);
  let end = instantMs(sh.endTime, dateHint);
  if (end == null) end = start + hours * 3600000;
  if (end <= start) end += 24 * 3600000;
  const dateStr = arDateStr(start);
  const objectiveId = String(sh.objectiveId || '').trim();
  return {
    employeeId,
    employeeName: String(sh.employeeName || '').trim(),
    start,
    end,
    code,
    objectiveId,
    objectiveName: String(sh.objectiveName || objectiveId),
    dateStr,
    cellKey: `${employeeId}_${dateStr}`,
  };
}

/** Pares de jornadas del mismo legajo con menos de 12 h entre el tope de cierre y el próximo inicio. */
export function findLctRestGaps(shifts: LctShiftInput[]): LctRestGap[] {
  const byEmp = new Map<string, Item[]>();
  for (const sh of shifts) {
    const item = toItem(sh);
    if (!item) continue;
    const list = byEmp.get(item.employeeId) || [];
    list.push(item);
    byEmp.set(item.employeeId, list);
  }
  const out: LctRestGap[] = [];
  for (const items of byEmp.values()) {
    items.sort((a, b) => a.start - b.start || a.end - b.end);
    const jornadas: Array<{ start: number; end: number; shifts: Item[] }> = [];
    for (const item of items) {
      const last = jornadas[jornadas.length - 1];
      if (last && item.start <= last.end + CONTINUOUS_MS) {
        if (item.end > last.end) last.end = item.end;
        last.shifts.push(item);
      } else {
        jornadas.push({ start: item.start, end: item.end, shifts: [item] });
      }
    }
    for (let i = 0; i < jornadas.length - 1; i += 1) {
      const prev = jornadas[i];
      const next = jornadas[i + 1];
      const capEnd = prev.start + LCT_HARD_CAP_MS;
      const gapHours = (next.start - capEnd) / 3600000;
      if (gapHours + 1e-6 >= LCT_MIN_REST_HOURS) continue;
      const from = prev.shifts[prev.shifts.length - 1];
      const to = next.shifts[0];
      const closeAtLabel = arHm(capEnd);
      const nextStartLabel = arHm(to.start);
      const label = gapLabel(gapHours);
      const where = from.objectiveId && to.objectiveId && from.objectiveId !== to.objectiveId
        ? ` · ${from.objectiveName} → ${to.objectiveName}`
        : '';
      out.push({
        employeeId: from.employeeId,
        employeeName: from.employeeName || to.employeeName,
        fromDate: from.dateStr,
        toDate: to.dateStr,
        fromCode: from.code,
        toCode: to.code,
        fromObjectiveId: from.objectiveId,
        toObjectiveId: to.objectiveId,
        fromObjectiveName: from.objectiveName,
        toObjectiveName: to.objectiveName,
        crossObjective: !!from.objectiveId && !!to.objectiveId && from.objectiveId !== to.objectiveId,
        closeAtLabel,
        nextStartLabel,
        gapHours,
        gapLabel: label,
        cellKeys: [...new Set([from.cellKey, to.cellKey])],
        message: `Art. 197 LCT: cierre por tope ${closeAtLabel} → ${to.code} ${nextStartLabel} = ${label} (mín. 12 h)${where}`,
      });
    }
  }
  return out;
}
