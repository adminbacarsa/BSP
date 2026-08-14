/**
 * Agregados puros del módulo Análisis: rangos, filtros, ausencias reales y demanda.
 * Sin I/O — testeable con tsx / eval.
 */

import { inferAbsenceCode, isActiveAbsence, iterateCalendarDateRange, toCalendarDateStr } from '@/lib/planificacion/absenceCodes';
import { getDateKeyInTimezone } from '@/lib/crm/crmDateUtils';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';

export type MsRange = { startMs: number; endMs: number };

export type ObjectiveGeoEntry = { lat: number; lng: number; name: string; clientName: string };

export type AbsenceCategory = 'vac' | 'enf' | 'art' | 'inj' | 'otros';

export type AbsenceSource = 'rrhh' | 'turno' | 'auto_t30';

export type AbsenceEvent = {
  id: string;
  emp: string;
  employeeId: string;
  tipo: string;
  code: string;
  category: AbsenceCategory;
  days: number;
  hs: number;
  status: string;
  source: AbsenceSource;
  objectiveId?: string;
  shiftId?: string;
  covered: boolean;
  /** Primer día calendario de la novedad (YYYY-MM-DD), para atribuir puesto. */
  fromDay?: string;
};

export type AusenciasStats = {
  total: number;
  detalle: AbsenceEvent[];
  vacPct: number;
  enfPct: number;
  artPct: number;
  injPct: number;
  otrosPct: number;
  totalPct: number;
  hsAfectadas: number;
  vacHs: number;
  enfHs: number;
  artHs: number;
  injHs: number;
  otrosHs: number;
};

export type DemandaObjectiveRow = {
  id: string;
  name: string;
  client: string;
  slaHours: number;
  planHours: number;
  extHours: number;
  adelHours: number;
  ftHours: number;
  opsHours: number;
  vacantHours: number;
  absenceHours: number;
  absenceCoveredHours: number;
  resultante: number;
  deltaSla: number;
  deltaPlan: number;
};

const LEAVE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'SGS', 'SUS']);
const BAND_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, EN: 9, REF: 8, RFZ: 8, C: 8, GU: 8, ESC: 8,
};

export function dateToMsRange(start: Date, end: Date): MsRange {
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function envelopingRange(start: Date, end: Date): { start: Date; end: Date } {
  const days = (end.getTime() - start.getTime()) / 86400000;
  if (days >= 360) {
    return {
      start: new Date(start.getFullYear(), 0, 1, 0, 0, 0, 0),
      end: new Date(end.getFullYear(), 11, 31, 23, 59, 59, 999),
    };
  }
  return {
    start: new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0),
    end: new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

/** Mes calendario de `now` y los 3 anteriores (4 meses). Ago 2026 → 01/05–31/08. */
export function analisisWorkingWindow(now: Date): { start: Date; end: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    start: new Date(y, m - 3, 1, 0, 0, 0, 0),
    end: new Date(y, m + 1, 0, 23, 59, 59, 999),
  };
}

export function mergeIntervals(intervals: MsRange[]): MsRange[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: MsRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].startMs <= last.endMs + 1) {
      last.endMs = Math.max(last.endMs, sorted[i].endMs);
    } else {
      out.push({ ...sorted[i] });
    }
  }
  return out;
}

export function isRangeCovered(intervals: MsRange[], requested: MsRange): boolean {
  if (!intervals.length) return false;
  return intervals.some((iv) => requested.startMs >= iv.startMs && requested.endMs <= iv.endMs);
}

export function gapsToFetch(intervals: MsRange[], requested: MsRange): MsRange[] {
  if (!intervals.length) return [requested];
  let remaining: MsRange[] = [requested];
  for (const iv of intervals) {
    const next: MsRange[] = [];
    for (const r of remaining) {
      if (iv.endMs < r.startMs || iv.startMs > r.endMs) {
        next.push(r);
        continue;
      }
      if (r.startMs < iv.startMs) {
        next.push({ startMs: r.startMs, endMs: Math.min(r.endMs, iv.startMs - 1) });
      }
      if (r.endMs > iv.endMs) {
        next.push({ startMs: Math.max(r.startMs, iv.endMs + 1), endMs: r.endMs });
      }
    }
    remaining = next.filter((g) => g.endMs >= g.startMs);
  }
  return remaining;
}

/** Parte un rango en ventanas de N días calendario. */
export function splitRangeByDays(range: MsRange, dayChunk: number): MsRange[] {
  const days = Math.max(1, Math.floor(dayChunk) || 1);
  const out: MsRange[] = [];
  let cursor = new Date(range.startMs);
  const endMs = range.endMs;
  while (cursor.getTime() <= endMs) {
    const chunkStart = cursor.getTime();
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + days);
    const chunkEnd = Math.min(next.getTime() - 1, endMs);
    out.push({ startMs: chunkStart, endMs: chunkEnd });
    cursor = new Date(chunkEnd + 1);
  }
  return out;
}

/** Meses calendario (month = 1..12) que cubren el rango. */
export function monthsInRange(range: MsRange): Array<{ year: number; month: number }> {
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  const out: Array<{ year: number; month: number }> = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m + 1 });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export function shiftStartMs(t: any): number | null {
  if (!t) return null;
  const st = t.startTime;
  if (st != null) {
    if (typeof st.seconds === 'number') return st.seconds * 1000;
    if (typeof st._seconds === 'number') return st._seconds * 1000;
    if (typeof st.toMillis === 'function') {
      const ms = st.toMillis();
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof st.toDate === 'function') {
      try {
        const d = st.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
      } catch {
        /* ignore */
      }
    }
    if (st instanceof Date && !Number.isNaN(st.getTime())) return st.getTime();
    if (typeof st === 'string' && !/^\d{1,2}:\d{2}/.test(st.trim())) {
      const d = new Date(st);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  const dateStr = String(t.date || t.scheduleDate || t.planningDate || t.fecha || t.shiftDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    let h = 12;
    let min = 0;
    const clock = String(typeof st === 'string' ? st : (t.startHour || '')).match(/^(\d{1,2}):(\d{2})/);
    if (clock) {
      h = Number(clock[1]);
      min = Number(clock[2]);
    }
    return new Date(y, mo - 1, d, h, min, 0, 0).getTime();
  }
  return null;
}

export function filterTurnosInRange(turnos: any[], start: Date, end: Date): any[] {
  const a = start.getTime();
  const b = end.getTime();
  return turnos.filter((t) => {
    const ms = shiftStartMs(t);
    return ms != null && ms >= a && ms <= b;
  });
}

export function parseAbsenceInstant(v: any, endOfDay: boolean): Date | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'seconds' in v && typeof (v as { seconds: number }).seconds === 'number') {
    const t = new Date((v as { seconds: number }).seconds * 1000);
    const y = t.getFullYear();
    const m = t.getMonth();
    const d = t.getDate();
    return endOfDay ? new Date(y, m, d, 23, 59, 59, 999) : new Date(y, m, d, 0, 0, 0, 0);
  }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const p = s.split('-').map(Number);
  return endOfDay
    ? new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999)
    : new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
}

export function ausenciaSolapaPeriodo(a: any, pStart: Date, pEnd: Date): boolean {
  const sd = parseAbsenceInstant(a.startDate, false);
  const ed = parseAbsenceInstant(a.endDate, true);
  if (!sd || !ed) return false;
  return sd <= pEnd && ed >= pStart;
}

export function ausenciaCuentaNoDisponible(a: any): boolean {
  const st = String(a.status || '').toLowerCase();
  return st !== 'rechazada';
}

/** Misma semántica que el fetch histórico: endDate >= inicio del período. */
export function filterAusenciasLoose(ausencias: any[], periodStart: Date): any[] {
  return ausencias.filter((a) => {
    const ed = parseAbsenceInstant(a.endDate, true);
    return !!ed && ed >= periodStart;
  });
}

export function mergeDocsById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  existing.forEach((d) => map.set(d.id, d));
  incoming.forEach((d) => map.set(d.id, d));
  return [...map.values()];
}

export function isVacantShift(t: any): boolean {
  const empNameU = String(t?.employeeName || '').trim().toUpperCase();
  return (
    !t?.employeeId ||
    t.employeeId === 'VACANTE' ||
    empNameU === 'VACANTE' ||
    empNameU.startsWith('VACANTE:') ||
    !!t?.isUnassigned
  );
}

export function isFrancoTrabajadoShift(t: any): boolean {
  if (t?.isFrancoTrabajado === true) return true;
  const code = String(t?.code || '').trim().toUpperCase();
  if (code === 'FT') return true;
  if (t?.type === 'EXTRA_FRANCO') return true;
  if (String(t?.coverageType || '').toUpperCase() === 'FRANCO') return true;
  return false;
}

export function isAutoT30Absence(a: any): boolean {
  return String(a?.origin || '').toUpperCase() === 'AUTO_T30';
}

export function categoryFromAbsenceCode(code: string, doc?: any): AbsenceCategory {
  const c = String(code || '').toUpperCase();
  if (c === 'V') return 'vac';
  if (c === 'A') return 'art';
  if (c === 'AA') return 'inj';
  if (c === 'E') {
    if (doc?.isART || /(?:^|\b)art(?:\b|$)/i.test(String(doc?.reason || ''))) return 'art';
    return 'enf';
  }
  return 'otros';
}

export function resolveAbsenceCode(doc: any, tiposNovedad: NovedadType[] = []): string {
  const label = String(doc?.type || '').trim();
  if (label && tiposNovedad.length) {
    const hit = tiposNovedad.find(
      (t) => t.status !== 'INACTIVE' && t.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (hit?.code) return String(hit.code).toUpperCase();
  }
  return inferAbsenceCode(doc);
}

export function isOperationalOriginShiftLite(t: any): boolean {
  const o = String(t?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
  if (t?.resolvedBy === 'OPERACIONES') return true;
  return false;
}

export function coverageHoursFromShift(t: any): number {
  if (!t) return 8;
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored >= 0.5) return Math.min(stored, 24);
  const code = String(t.code || t.shiftCode || '').toUpperCase();
  if (BAND_HOURS[code] != null) return BAND_HOURS[code];
  if (t.startTime?.seconds && t.endTime?.seconds) {
    return Math.max(0, Math.min((t.endTime.seconds - t.startTime.seconds) / 3600, 24));
  }
  return 8;
}

function buildShiftIndexes(turnos: any[]) {
  const byId = new Map<string, any>();
  const byEmpDay = new Map<string, any[]>();
  const byObjDay = new Map<string, any[]>();
  for (const t of turnos) {
    if (t?.id) byId.set(String(t.id), t);
    const eid = String(t.employeeId || '').trim();
    const ms = shiftStartMs(t);
    if (!ms) continue;
    const day = getDateKeyInTimezone(new Date(ms));
    if (eid && eid !== 'VACANTE') {
      const k = `${eid}_${day}`;
      const arr = byEmpDay.get(k) || [];
      arr.push(t);
      byEmpDay.set(k, arr);
    }
    const oid = String(t.objectiveId || '').trim();
    if (oid) {
      const k = `${oid}_${day}`;
      const arr = byObjDay.get(k) || [];
      arr.push(t);
      byObjDay.set(k, arr);
    }
  }
  return { byId, byEmpDay, byObjDay };
}

function hoursForAbsenceDays(
  a: any,
  days: string[],
  idx: ReturnType<typeof buildShiftIndexes>,
): number {
  const shiftId = String(a.shiftId || '').trim();
  if (shiftId && idx.byId.has(shiftId)) {
    return coverageHoursFromShift(idx.byId.get(shiftId));
  }
  const eid = String(a.employeeId || '').trim();
  let total = 0;
  let matched = 0;
  for (const day of days) {
    const band = String(a.shiftCode || a.code || '').toUpperCase();
    if (BAND_HOURS[band] != null) {
      total += BAND_HOURS[band];
      matched++;
      continue;
    }
    const shifts = eid ? idx.byEmpDay.get(`${eid}_${day}`) || [] : [];
    const coverage = shifts.find((t) => !LEAVE_CODES.has(String(t.code || '').toUpperCase()) && !isVacantShift(t));
    const leave = shifts.find((t) => LEAVE_CODES.has(String(t.code || '').toUpperCase()));
    if (coverage) {
      total += coverageHoursFromShift(coverage);
      matched++;
    } else if (leave && Number(leave.hours) >= 0.5) {
      total += Math.min(Number(leave.hours), 24);
      matched++;
    } else {
      total += 8;
      matched++;
    }
  }
  return matched > 0 ? total : days.length * 8;
}

function dayHasCoverage(idx: ReturnType<typeof buildShiftIndexes>, objectiveId: string | undefined, day: string): boolean {
  if (!objectiveId) return false;
  const shifts = idx.byObjDay.get(`${objectiveId}_${day}`) || [];
  return shifts.some((t) => {
    if (isVacantShift(t)) return false;
    if (isFrancoTrabajadoShift(t)) return true;
    if (isOperationalOriginShiftLite(t)) return true;
    return false;
  });
}

/**
 * Motor de ausencias reales: tipos COSP + tipos_novedad + shiftId + isAbsent / AUTO_T30.
 * Dedup por shiftId o empleado+día.
 */
export function buildAusenciasStats(opts: {
  ausencias: any[];
  turnos: any[];
  employees: any[];
  periodStart: Date;
  periodEnd: Date;
  capHsPerGuardPeriod: number;
  tiposNovedad?: NovedadType[];
}): AusenciasStats | null {
  const { ausencias, turnos, employees, periodStart, periodEnd, capHsPerGuardPeriod, tiposNovedad = [] } = opts;
  const totalDisponibleHs = employees.length * capHsPerGuardPeriod;
  if (totalDisponibleHs === 0) return null;

  const idx = buildShiftIndexes(turnos);
  const seen = new Set<string>();
  const empDays = new Set<string>();
  const detalle: AbsenceEvent[] = [];

  const markDays = (employeeId: string, days: string[]) => {
    days.forEach((d) => empDays.add(`${employeeId}_${d}`));
  };

  const pushEvent = (ev: AbsenceEvent, days: string[]) => {
    const keys = [
      ev.shiftId ? `sid:${ev.shiftId}` : '',
      `id:${ev.id}`,
    ].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return;
    if (ev.employeeId && days.length && days.every((d) => empDays.has(`${ev.employeeId}_${d}`))) return;
    keys.forEach((k) => seen.add(k));
    if (ev.employeeId) markDays(ev.employeeId, days);
    detalle.push(ev);
  };

  const pStartStr = toCalendarDateStr(periodStart) || '';
  const pEndStr = toCalendarDateStr(periodEnd) || '';

  ausencias.forEach((a: any) => {
    if (!isActiveAbsence(a) && String(a.status || '').toLowerCase() === 'rechazada') return;
    if (!ausenciaSolapaPeriodo(a, periodStart, periodEnd)) return;
    const startStr = toCalendarDateStr(a.startDate);
    const endStr = toCalendarDateStr(a.endDate);
    if (!startStr || !endStr) return;
    const clipStart = pStartStr && startStr < pStartStr ? pStartStr : startStr;
    const clipEnd = pEndStr && endStr > pEndStr ? pEndStr : endStr;
    const days = iterateCalendarDateRange(clipStart, clipEnd);
    if (!days.length) return;
    const code = resolveAbsenceCode(a, tiposNovedad);
    const category = categoryFromAbsenceCode(code, a);
    const hs = hoursForAbsenceDays(a, days, idx);
    const oid = String(a.objectiveId || idx.byId.get(String(a.shiftId || ''))?.objectiveId || '').trim() || undefined;
    const covered = days.some((d) => dayHasCoverage(idx, oid, d));
    pushEvent({
      id: String(a.id || `${a.employeeId}_${startStr}`),
      emp: a.employeeName || a.employeeId || '—',
      employeeId: String(a.employeeId || ''),
      tipo: String(a.type || code),
      code,
      category,
      days: days.length,
      hs: Math.round(hs * 10) / 10,
      status: String(a.status || ''),
      source: isAutoT30Absence(a) ? 'auto_t30' : 'rrhh',
      objectiveId: oid,
      shiftId: a.shiftId ? String(a.shiftId) : undefined,
      covered,
      fromDay: days[0],
    }, days);
  });

  turnos.forEach((t: any) => {
    const st = String(t.status || '').toUpperCase();
    const isAbs = t.isAbsent === true || st === 'ABSENT';
    const origin = String(t.origin || '').toUpperCase();
    const code = String(t.code || '').toUpperCase();
    const isLeaveCell = LEAVE_CODES.has(code);
    if (!isAbs && origin !== 'AUTO_T30' && !isLeaveCell) return;
    if (isVacantShift(t)) return;
    const sid = t.id ? String(t.id) : '';
    if (sid && seen.has(`sid:${sid}`)) return;
    const ms = shiftStartMs(t);
    if (ms == null || ms < periodStart.getTime() || ms > periodEnd.getTime()) return;
    const absCode = isLeaveCell ? code : 'AA';
    const hs = coverageHoursFromShift(t);
    const day = getDateKeyInTimezone(new Date(ms));
    const oid = String(t.objectiveId || '').trim() || undefined;
    pushEvent({
      id: sid || `turno_${t.employeeId}_${day}`,
      emp: t.employeeName || t.employeeId || '—',
      employeeId: String(t.employeeId || ''),
      tipo: isLeaveCell ? code : 'Ausente operativo',
      code: absCode,
      category: categoryFromAbsenceCode(absCode, t),
      days: 1,
      hs: Math.round(hs * 10) / 10,
      status: isAbs ? 'Ausente' : (isLeaveCell ? 'Planificada' : String(t.status || '')),
      source: origin === 'AUTO_T30' ? 'auto_t30' : 'turno',
      objectiveId: oid,
      shiftId: sid || undefined,
      covered: dayHasCoverage(idx, oid, day),
      fromDay: day,
    }, [day]);
  });

  let vacHs = 0;
  let enfHs = 0;
  let artHs = 0;
  let injHs = 0;
  let otrosHs = 0;
  detalle.forEach((d) => {
    if (d.category === 'vac') vacHs += d.hs;
    else if (d.category === 'enf') enfHs += d.hs;
    else if (d.category === 'art') artHs += d.hs;
    else if (d.category === 'inj') injHs += d.hs;
    else otrosHs += d.hs;
  });

  const pct = (hs: number) => Math.round((hs / totalDisponibleHs) * 1000) / 10;
  const hsAfectadas = Math.round(vacHs + enfHs + artHs + injHs + otrosHs);
  return {
    total: detalle.length,
    detalle,
    vacPct: pct(vacHs),
    enfPct: pct(enfHs),
    artPct: pct(artHs),
    injPct: pct(injHs),
    otrosPct: pct(otrosHs),
    totalPct: pct(vacHs + enfHs + artHs + injHs + otrosHs),
    hsAfectadas,
    vacHs: Math.round(vacHs),
    enfHs: Math.round(enfHs),
    artHs: Math.round(artHs),
    injHs: Math.round(injHs),
    otrosHs: Math.round(otrosHs),
  };
}

export function topNPlusResto<T extends Record<string, number | string>>(
  rows: T[],
  numericKeys: (keyof T)[],
  n: number,
  nameKey: keyof T,
): T[] {
  if (rows.length <= n) return rows;
  const top = rows.slice(0, n);
  const rest = rows.slice(n);
  const resto = { ...top[0] } as T;
  resto[nameKey] = 'Resto' as T[keyof T];
  numericKeys.forEach((k) => {
    (resto as any)[k] = Math.round(rest.reduce((s, r) => s + Number(r[k] || 0), 0) * 10) / 10;
  });
  return [...top, resto];
}
