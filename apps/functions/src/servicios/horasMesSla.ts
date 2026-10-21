/**
 * Copia de calculateSlaHoursForMonth (apps/web2/src/lib/servicios/slaHoursCalculator.ts).
 * Functions no importa web2. Si cambia el cálculo allá, hay que cambiarlo acá.
 */
import { isArgentineHoliday } from '../common/feriadosAr';

const WEEK = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

const STANDARD: Record<string, { code: string; startTime: string; endTime: string; hours: number }> = {
  M: { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
  T: { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
  N: { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
  D12: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
  N12: { code: 'N12', startTime: '19:00', endTime: '07:00', hours: 12 },
};

type Shift = {
  code?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  days?: string[];
  specificDates?: string[];
  feriados?: boolean;
  quantity?: number | null;
  blocks?: Array<{ startTime: string; endTime: string }>;
};

type Pos = {
  coverageType?: string;
  code?: string;
  name?: string;
  quantity?: number;
  activeDays?: string[];
  trabajaFeriados?: boolean;
  allowedShiftTypes?: Shift[];
  excludedDates?: string[];
  excludedShiftDates?: Record<string, string[]>;
  excludedShiftPaxDates?: Record<string, Record<string, number>>;
  paxBoostRanges?: Array<{ from?: string; to?: string; delta?: number }>;
  status?: string;
  inactiveFrom?: string;
  includeInSlaTotals?: boolean;
  encargadoScheduleMode?: string;
  workPattern?: string;
  workPatternHoursPerDay?: number;
};

const PATTERNS: Array<{ id: string; workDays: number; cycleDays: number }> = [
  { id: '6x2', workDays: 6, cycleDays: 8 },
  { id: '5x1', workDays: 5, cycleDays: 6 },
  { id: '6x1', workDays: 6, cycleDays: 7 },
  { id: '4x12', workDays: 4, cycleDays: 7 },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date | null {
  const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function puestoSalteaFeriado(pos: Pos, dateStr: string): boolean {
  if (pos.trabajaFeriados !== false) return false;
  return isArgentineHoliday(dateStr);
}

function activoEnFecha(pos: Pos, dateStr: string): boolean {
  const st = String(pos.status || 'ACTIVE').toUpperCase();
  if (st !== 'INACTIVE' && st !== 'INACTIVO') return true;
  const from = String(pos.inactiveFrom || '').slice(0, 10);
  if (!from) return false;
  return dateStr < from;
}

function esEventos(pos: Pos): boolean {
  return String(pos.coverageType || '').toLowerCase().trim() === 'eventos' || String(pos.code || '').toUpperCase() === 'EVT';
}

function esEncargado(pos: Pos): boolean {
  return String(pos.coverageType || '').toLowerCase().trim() === 'encargado' || String(pos.code || '').toUpperCase() === 'ENC';
}

function modoEncargado(pos: Pos): 'fixed' | 'rotating' {
  return pos.encargadoScheduleMode === 'rotating' ? 'rotating' : 'fixed';
}

function sumaEnTotales(pos: Pos): boolean {
  if (esEventos(pos)) return false;
  if (typeof pos.includeInSlaTotals === 'boolean') return pos.includeInSlaTotals;
  if (esEncargado(pos)) return modoEncargado(pos) === 'fixed';
  return true;
}

function boost(pos: Pos, dateStr: string): number {
  let n = 0;
  for (const r of pos.paxBoostRanges || []) {
    const from = String(r.from || '').slice(0, 10);
    const to = String(r.to || r.from || '').slice(0, 10);
    if (from && dateStr >= from && dateStr <= to) n += Math.max(0, Math.floor(Number(r.delta) || 0));
  }
  return n;
}

function compone(start: string, end: string): number {
  const [h1, m1] = String(start || '').split(':').map(Number);
  const [h2, m2] = String(end || '').split(':').map(Number);
  let s = (Number(h1) || 0) * 60 + (Number(m1) || 0);
  let e = (Number(h2) || 0) * 60 + (Number(m2) || 0);
  if (e <= s) e += 1440;
  return parseFloat(((e - s) / 60).toFixed(2));
}

function horasDia(pos: Pos, dayCode: string, dateStr: string, skipShiftCodes: string[], paxExclude: Record<string, number>): number {
  if (esEventos(pos)) return 0;
  if (puestoSalteaFeriado(pos, dateStr)) return 0;
  if (esEncargado(pos) && !sumaEnTotales(pos)) return 0;
  if (esEncargado(pos) && modoEncargado(pos) === 'rotating') return 0;
  const activeDays = pos.activeDays?.length ? pos.activeDays : [...WEEK];
  const correFeriadoHoy = isArgentineHoliday(dateStr) && (pos.allowedShiftTypes || []).some((s) => s.feriados === true);
  if (!activeDays.includes(dayCode) && !correFeriadoHoy) return 0;
  const skip = new Set(skipShiftCodes.map((c) => String(c || '').toUpperCase()));
  const cutMap: Record<string, number> = {};
  for (const [code, n] of Object.entries(paxExclude || {})) {
    const c = String(code || '').toUpperCase();
    const pax = Math.floor(Number(n) || 0);
    if (c && pax > 0) cutMap[c] = pax;
  }
  const hasPaxCuts = Object.keys(cutMap).length > 0;
  const extra = boost(pos, dateStr);
  const hasPerShiftQty = (pos.allowedShiftTypes || []).some((s) => s.quantity != null) || hasPaxCuts;
  let dayTotal = 0;
  const add = (v: Shift) => {
    const code = String(v.code || '').toUpperCase();
    if (code && skip.has(code)) return;
    const baseQ = hasPerShiftQty ? (v.quantity ?? pos.quantity ?? 1) : 1;
    const q = Math.max(0, Math.floor(Number(baseQ) || 1) - (cutMap[code] || 0) + extra);
    if (q <= 0) return;
    const blocks = Array.isArray(v.blocks) && v.blocks.length >= 2 ? v.blocks : [{ startTime: v.startTime || '', endTime: v.endTime || '' }];
    for (const b of blocks) dayTotal += compone(b.startTime, b.endTime) * q;
  };
  if (pos.coverageType === '24hs') {
    const shifts = pos.allowedShiftTypes || [];
    const m = shifts.find((s) => s.code === 'M');
    const t = shifts.find((s) => s.code === 'T');
    const n = shifts.find((s) => s.code === 'N');
    const d12 = shifts.find((s) => s.code === 'D12');
    const n12 = shifts.find((s) => s.code === 'N12');
    if (m && t && n) { add(m); add(t); add(n); }
    else if (d12 && n12) { add(d12); add(n12); }
    else { add(STANDARD.D12); add(STANDARD.N12); }
  } else if (pos.coverageType === '12hs_diurno') add(STANDARD.D12);
  else if (pos.coverageType === '12hs_nocturno') add(STANDARD.N12);
  else if (pos.coverageType === 'custom' || pos.coverageType === 'encargado') {
    for (const shift of pos.allowedShiftTypes || []) {
      const sd = shift.specificDates;
      if (Array.isArray(sd) && sd.length > 0) {
        if (sd.includes(dateStr)) add(shift);
        continue;
      }
      if (shift.days?.length) {
        if (shift.days.includes(dayCode) || (shift.feriados === true && isArgentineHoliday(dateStr))) add(shift);
      } else add(shift);
    }
  }
  return dayTotal;
}

function horasEncargadoRotativo(pos: Pos, start: string, end: string, year: number, monthIndex0: number): number {
  if (!esEncargado(pos) || !sumaEnTotales(pos) || modoEncargado(pos) !== 'rotating') return 0;
  const mStart = new Date(year, monthIndex0, 1);
  const mEnd = new Date(year, monthIndex0 + 1, 0);
  const cStart = parseYmd(start);
  const cEnd = parseYmd(end);
  if (!cStart || !cEnd) return 0;
  const from = cStart > mStart ? cStart : mStart;
  const to = cEnd < mEnd ? cEnd : mEnd;
  if (from > to) return 0;
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  const def = PATTERNS.find((p) => p.id === pos.workPattern) || PATTERNS[0];
  const shifts = Math.round((days / def.cycleDays) * def.workDays * 10) / 10;
  const fromField = Number(pos.workPatternHoursPerDay);
  let hDay = Number.isFinite(fromField) && fromField > 0 ? fromField : 0;
  if (!hDay) {
    const enc = (pos.allowedShiftTypes || []).find((s) => String(s.code || '').toUpperCase() === 'ENC');
    if (enc?.hours && Number(enc.hours) > 0) hDay = Number(enc.hours);
    else if (enc?.startTime && enc?.endTime) hDay = compone(enc.startTime, enc.endTime);
    else hDay = 8;
  }
  return Math.round(shifts * hDay * 10) / 10;
}

/** Total del mes (monthIndex0). Misma cuenta que calculateSlaHoursForMonth().total. */
export function horasSlaDelMes(
  positions: Pos[],
  startStr: string,
  endStr: string,
  excludedDates: string[] | undefined,
  year: number,
  monthIndex0: number,
): number {
  const start = parseYmd(startStr);
  const end = parseYmd(endStr);
  if (!start || !end || !positions.length) return 0;
  const excl = new Set(excludedDates || []);
  const monthKey = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`;
  let total = 0;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    const dateStr = ymd(cur);
    const dayCode = WEEK[cur.getDay()];
    if (key === monthKey && !excl.has(dateStr)) {
      for (const pos of positions) {
        if (!activoEnFecha(pos, dateStr)) continue;
        if (pos.excludedDates?.includes(dateStr)) continue;
        const skip = pos.excludedShiftDates?.[dateStr] || [];
        const cuts = pos.excludedShiftPaxDates?.[dateStr] || {};
        const dayTotal = horasDia(pos, dayCode, dateStr, skip, cuts);
        const hasPerShiftQty = (pos.allowedShiftTypes || []).some((s) => s.quantity != null) || Object.keys(cuts).length > 0;
        const q = hasPerShiftQty ? 1 : (pos.quantity || 1);
        total += dayTotal * q;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  for (const pos of positions) total += horasEncargadoRotativo(pos, startStr, endStr, year, monthIndex0);
  return Math.round(total * 10) / 10;
}
