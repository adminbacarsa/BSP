/**
 * Universo operativo real de Análisis.
 * Parte de SLA vigente + plantel. Sin I/O. Sin supuestos 8/12 ni 24/25.
 */

export const CCT_HS_MENSUAL = 192;

export type AnalisisPeriodMode = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';

export type AnalisisUniverso = {
  clientes: number;
  objetivos: number;
  puestos: number;
  puestosUnicos: number;
  slotsPeriodo: number;
  picoSimultaneo: number;
  picoFecha: string | null;
  hsVendidas: number;
  slotsByBand: Record<string, number>;
  plantel: number;
  demandDays: number;
};

const WEEK_DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

const STANDARD: Record<string, { start: string; end: string; hours: number }> = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  D12: { start: '07:00', end: '19:00', hours: 12 },
  N12: { start: '19:00', end: '07:00', hours: 12 },
};

type SlotInst = { code: string; startMin: number; endMin: number; hours: number; qty: number };

function clockToMin(hhmm: string): number | null {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
  while (cur <= last) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function normalizePositions(srv: any): any[] {
  if (Array.isArray(srv?.positions)) return srv.positions;
  return Object.values(srv?.positions || {});
}

function variantsForPosition(pos: any, dayCode: string, dateStr: string): any[] {
  const cov = String(pos?.coverageType || '').toLowerCase();
  const shifts = Array.isArray(pos?.allowedShiftTypes) ? pos.allowedShiftTypes : [];
  if (cov === '24hs') {
    const find = (code: string) =>
      shifts.find((s: any) => String(s.code || '').toUpperCase() === code);
    const m = find('M');
    const t = find('T');
    const n = find('N');
    const d12 = find('D12');
    const n12 = find('N12');
    if (m && t && n) return [m, t, n];
    if (d12 && n12) return [d12, n12];
    return [
      { code: 'D12', startTime: STANDARD.D12.start, endTime: STANDARD.D12.end, hours: 12 },
      { code: 'N12', startTime: STANDARD.N12.start, endTime: STANDARD.N12.end, hours: 12 },
    ];
  }
  if (cov === '12hs_diurno') {
    return [{ code: 'D12', startTime: STANDARD.D12.start, endTime: STANDARD.D12.end, hours: 12 }];
  }
  if (cov === '12hs_nocturno') {
    return [{ code: 'N12', startTime: STANDARD.N12.start, endTime: STANDARD.N12.end, hours: 12 }];
  }
  return shifts.filter((s: any) => {
    const sd = s.specificDates;
    if (Array.isArray(sd) && sd.length > 0) return !!dateStr && sd.includes(dateStr);
    if (Array.isArray(s.days) && s.days.length) return s.days.includes(dayCode);
    return true;
  });
}

function slotsForPositionOnDay(pos: any, day: Date, srv: any): SlotInst[] {
  if (!srv?.startDate || !srv?.endDate) return [];
  const dateStr = ymd(day);
  if ((srv.excludedDates || []).includes(dateStr)) return [];
  if ((pos.excludedDates || []).includes(dateStr)) return [];
  const activeDays = pos.activeDays?.length ? pos.activeDays : [...WEEK_DAY];
  const dayCode = WEEK_DAY[day.getDay()];
  if (!activeDays.includes(dayCode)) return [];

  const skip = new Set(
    (pos.excludedShiftDates?.[dateStr] || []).map((c: string) => String(c).toUpperCase()),
  );
  const cutMap: Record<string, number> = pos.excludedShiftPaxDates?.[dateStr] || {};
  const hasPerShiftQty =
    (pos.allowedShiftTypes || []).some((s: any) => s.quantity != null) ||
    Object.keys(cutMap).length > 0;

  const out: SlotInst[] = [];
  for (const v of variantsForPosition(pos, dayCode, dateStr)) {
    const code = String(v.code || '').toUpperCase();
    if (code && skip.has(code)) continue;
    const baseQ = hasPerShiftQty ? (v.quantity ?? pos.quantity ?? 1) : (pos.quantity || 1);
    const cut = Math.floor(Number(cutMap[code]) || 0);
    const q = Math.max(0, Math.floor(Number(baseQ) || 1) - cut);
    if (q <= 0) continue;
    const blocks =
      Array.isArray(v.blocks) && v.blocks.length >= 2
        ? v.blocks
        : [{ startTime: v.startTime, endTime: v.endTime }];
    for (const b of blocks) {
      const std = STANDARD[code];
      const start = clockToMin(b.startTime) ?? clockToMin(std?.start || '07:00') ?? 7 * 60;
      let end = clockToMin(b.endTime) ?? clockToMin(std?.end || '15:00') ?? 15 * 60;
      if (end <= start) end += 1440;
      const hours = Number(v.hours) > 0 ? Number(v.hours) : (std?.hours ?? (end - start) / 60);
      out.push({ code: code || 'CUSTOM', startMin: start, endMin: end, hours, qty: q });
    }
  }
  return out;
}

function peakOverlap(slots: SlotInst[]): number {
  const ev: Array<{ t: number; d: number }> = [];
  for (const s of slots) {
    ev.push({ t: s.startMin, d: s.qty });
    ev.push({ t: s.endMin, d: -s.qty });
  }
  ev.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let peak = 0;
  for (const e of ev) {
    cur += e.d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

/**
 * Jornada de referencia CCT 422/05: 192 hs/mes (no es el techo de liquidación 200).
 * Día/semana = prorrateo 192/30. Alias histórico: cctBolsaHsPerGuard.
 */
export function cctJornadaHsPerGuard(mode: AnalisisPeriodMode, daysCount: number): number {
  if (mode === 'quarter') return CCT_HS_MENSUAL * 3;
  if (mode === 'semester') return CCT_HS_MENSUAL * 6;
  if (mode === 'year') return CCT_HS_MENSUAL * 12;
  if (mode === 'month') return CCT_HS_MENSUAL;
  return Math.max(1, Math.round(CCT_HS_MENSUAL * (Math.max(1, daysCount) / 30)));
}

/** @deprecated Nombre histórico. Usar cctJornadaHsPerGuard — 192 no es bolsa/techo 200. */
export const cctBolsaHsPerGuard = cctJornadaHsPerGuard;

export function buildAnalisisUniverso(opts: {
  vigenteServices: any[];
  employees: any[];
  periodStart: Date;
  periodEnd: Date;
}): AnalisisUniverso {
  const { vigenteServices, employees, periodStart, periodEnd } = opts;
  const clients = new Set<string>();
  const objectives = new Set<string>();
  let puestos = 0;
  let puestosUnicos = 0;
  const slotsByBand: Record<string, number> = {};
  let slotsPeriodo = 0;
  let hsVendidas = 0;
  let picoSimultaneo = 0;
  let picoFecha: string | null = null;
  let demandDays = 0;

  for (const srv of vigenteServices) {
    const cid = String(srv.clientId ?? srv.clientName ?? '').trim();
    if (cid) clients.add(cid);
    const oid = String(srv.objectiveId ?? srv.objectiveName ?? '').trim();
    if (oid) objectives.add(oid);
    for (const pos of normalizePositions(srv)) {
      puestosUnicos += 1;
      puestos += Math.max(1, Math.floor(Number(pos.quantity) || 1));
    }
  }

  for (const day of eachDay(periodStart, periodEnd)) {
    const daySlots: SlotInst[] = [];
    for (const srv of vigenteServices) {
      for (const pos of normalizePositions(srv)) {
        daySlots.push(...slotsForPositionOnDay(pos, day, srv));
      }
    }
    if (daySlots.length === 0) continue;
    demandDays += 1;
    for (const s of daySlots) {
      slotsPeriodo += s.qty;
      hsVendidas += s.hours * s.qty;
      slotsByBand[s.code] = (slotsByBand[s.code] || 0) + s.qty;
    }
    const peak = peakOverlap(daySlots);
    if (peak > picoSimultaneo) {
      picoSimultaneo = peak;
      picoFecha = ymd(day);
    }
  }

  return {
    clientes: clients.size,
    objetivos: objectives.size,
    puestos,
    puestosUnicos,
    slotsPeriodo,
    picoSimultaneo,
    picoFecha,
    hsVendidas: Math.round(hsVendidas * 10) / 10,
    slotsByBand,
    plantel: employees.length,
    demandDays,
  };
}
