/**
 * Motor único de horas SLA (contrato) — usado por Dashboard, Servicios y CRM.
 * Respeta excludedDates, activeDays por puesto y composición M+T+N / custom.
 */

// ─── FERIADOS NACIONALES ARGENTINA ────────────────────────────────────────────
// Fuente: Decreto PEN. Incluye fijos, móviles y trasladables 2024-2027.
// Los feriados puente por decreto anual deben agregarse a esta lista cuando se conozcan.

/** Feriados de fecha fija (MM-DD) que aplican todos los años. */
const AR_FERIADOS_FIJOS = new Set([
  '01-01', // Año Nuevo
  '03-24', // Día Nacional de la Memoria
  '04-02', // Veteranos y Caídos en Malvinas
  '05-01', // Día del Trabajador
  '05-25', // Revolución de Mayo
  '06-20', // Paso a la Inmortalidad del Gral. Belgrano (Día de la Bandera)
  '07-09', // Día de la Independencia
  '12-08', // Inmaculada Concepción de María
  '12-25', // Navidad
]);

/** Feriados variables y trasladables por año (YYYY-MM-DD). */
const AR_FERIADOS_VARIABLES: Record<string, string[]> = {
  '2024': [
    '2024-02-12', '2024-02-13', // Carnaval
    '2024-03-29',               // Viernes Santo
    '2024-04-01',               // Feriado puente
    '2024-06-21',               // Feriado puente
    '2024-08-19',               // San Martín (trasladado, 17/8 era sábado)
    '2024-10-11',               // Diversidad Cultural (trasladado)
    '2024-11-18',               // Soberanía Nacional (trasladado)
  ],
  '2025': [
    '2025-03-03', '2025-03-04', // Carnaval
    '2025-03-24',               // (ya incluido en fijos)
    '2025-04-18',               // Viernes Santo
    '2025-05-02',               // Feriado puente
    '2025-08-15',               // Feriado puente
    '2025-08-18',               // San Martín (trasladado, 17/8 era domingo)
    '2025-10-13',               // Diversidad Cultural (trasladado, 12/10 era domingo)
    '2025-11-21',               // Feriado puente
    '2025-11-24',               // Soberanía Nacional
  ],
  '2026': [
    '2026-02-16', '2026-02-17', // Carnaval
    '2026-04-03',               // Viernes Santo (Pascua 5/4/2026)
    '2026-08-17',               // San Martín (17/8 es lunes, no se traslada)
    '2026-10-12',               // Diversidad Cultural (12/10 es lunes, no se traslada)
    '2026-11-23',               // Soberanía Nacional (cuarto lunes de noviembre)
  ],
  '2027': [
    '2027-02-01', '2027-02-02', // Carnaval
    '2027-03-26',               // Viernes Santo (Pascua 28/3/2027)
    '2027-08-16',               // San Martín (tercer lunes de agosto)
    '2027-10-11',               // Diversidad Cultural (trasladado)
    '2027-11-22',               // Soberanía Nacional (cuarto lunes de noviembre)
  ],
};

/**
 * Retorna true si la fecha dada (YYYY-MM-DD) es feriado nacional argentino.
 * No incluye feriados puente decretados ad-hoc que no estén en la lista.
 */
export function isArgentineHoliday(dateStr: string): boolean {
  const norm = (dateStr || '').trim().slice(0, 10);
  if (norm.length < 10) return false;
  const mmdd = norm.slice(5); // MM-DD
  if (AR_FERIADOS_FIJOS.has(mmdd)) return true;
  const year = norm.slice(0, 4);
  return (AR_FERIADOS_VARIABLES[year] ?? []).includes(norm);
}

import type { ServicePosition, ShiftVariant } from '@/services/slaService';

export const WEEK_DAY_CODES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

export const STANDARD_SHIFT_VARIANTS: Record<string, ShiftVariant> = {
  M: { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
  T: { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 },
  N: { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
  D12: { code: 'D12', name: 'Diurno 12h', startTime: '07:00', endTime: '19:00', hours: 12 },
  N12: { code: 'N12', name: 'Nocturno 12h', startTime: '19:00', endTime: '07:00', hours: 12 },
};

export type SlaHoursBreakdownRow = {
  monthKey: string;
  name: string;
  days: number;
  totalHours: number;
  nightHours: number;
  weekendHours: number;
  holidayHours: number; // horas en feriados nacionales argentinos
};

export function parseYmdToLocalDate(dateStr: string): Date | null {
  const norm = (dateStr || '').trim().slice(0, 10);
  const [y, m, d] = norm.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function analyzeShiftComposition(start: string, end: string) {
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  let startMin = h1 * 60 + m1;
  let endMin = h2 * 60 + m2;
  if (endMin < startMin) endMin += 24 * 60;
  const durationMin = endMin - startMin;
  let nightMinutes = 0;
  const NIGHT_START = 21 * 60;
  const NIGHT_END = 6 * 60;
  for (let t = startMin; t < endMin; t++) {
    const modT = t % 1440;
    if (modT < NIGHT_END || modT >= NIGHT_START) nightMinutes++;
  }
  return {
    total: parseFloat((durationMin / 60).toFixed(2)),
    night: parseFloat((nightMinutes / 60).toFixed(2)),
    day: parseFloat(((durationMin - nightMinutes) / 60).toFixed(2)),
  };
}

export function computePositionDayComposition(pos: ServicePosition, dayCode: string) {
  let dayTotal = 0;
  let dayNight = 0;
  const activeDays = pos.activeDays?.length ? pos.activeDays : [...WEEK_DAY_CODES];
  if (!activeDays.includes(dayCode)) return { dayTotal: 0, dayNight: 0 };

  const addVariant = (v: ShiftVariant) => {
    const comp = analyzeShiftComposition(v.startTime, v.endTime);
    dayTotal += comp.total;
    dayNight += comp.night;
  };

  if (pos.coverageType === '24hs') {
    const shifts = pos.allowedShiftTypes || [];
    const m = shifts.find((s) => s.code === 'M');
    const t = shifts.find((s) => s.code === 'T');
    const n = shifts.find((s) => s.code === 'N');
    const d12 = shifts.find((s) => s.code === 'D12');
    const n12 = shifts.find((s) => s.code === 'N12');
    if (m && t && n) {
      addVariant(m);
      addVariant(t);
      addVariant(n);
    } else if (d12 && n12) {
      addVariant(d12);
      addVariant(n12);
    } else {
      addVariant(STANDARD_SHIFT_VARIANTS.D12);
      addVariant(STANDARD_SHIFT_VARIANTS.N12);
    }
  } else if (pos.coverageType === '12hs_diurno') {
    addVariant(STANDARD_SHIFT_VARIANTS.D12);
  } else if (pos.coverageType === '12hs_nocturno') {
    addVariant(STANDARD_SHIFT_VARIANTS.N12);
  } else if (pos.coverageType === 'custom') {
    (pos.allowedShiftTypes || []).forEach((shift) => {
      if (shift.days?.length) {
        if (shift.days.includes(dayCode)) addVariant(shift);
      } else {
        addVariant(shift);
      }
    });
  }
  return { dayTotal, dayNight };
}

export function calculateMonthlyBreakdown(
  positions: ServicePosition[],
  startStr: string,
  endStr: string,
  excludedDates?: string[],
): SlaHoursBreakdownRow[] {
  const startNorm = (startStr || '').trim().slice(0, 10);
  const endNorm = (endStr || '').trim().slice(0, 10);
  if (!startNorm || !endNorm || positions.length === 0) return [];

  let current = parseYmdToLocalDate(startNorm);
  const end = parseYmdToLocalDate(endNorm);
  if (!current || !end) return [];

  const slaExcluded = new Set(excludedDates || []);
  const monthAccumulator: Record<string, SlaHoursBreakdownRow> = {};

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthName = current.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const dayIdx = current.getDay();
    const dayCode = WEEK_DAY_CODES[dayIdx];
    const isWeekend = dayIdx === 0 || dayIdx === 6;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

    const isHoliday = isArgentineHoliday(dateStr);

    if (!monthAccumulator[monthKey]) {
      monthAccumulator[monthKey] = {
        monthKey,
        name: monthName.charAt(0).toUpperCase() + monthName.slice(1),
        days: 0,
        totalHours: 0,
        nightHours: 0,
        weekendHours: 0,
        holidayHours: 0,
      };
    }
    monthAccumulator[monthKey].days++;

    if (!slaExcluded.has(dateStr)) {
      positions.forEach((pos) => {
        if (pos.excludedDates?.includes(dateStr)) return;
        const { dayTotal, dayNight } = computePositionDayComposition(pos, dayCode);
        const q = pos.quantity || 1;
        monthAccumulator[monthKey].totalHours += dayTotal * q;
        monthAccumulator[monthKey].nightHours += dayNight * q;
        if (isWeekend) monthAccumulator[monthKey].weekendHours += dayTotal * q;
        if (isHoliday) monthAccumulator[monthKey].holidayHours += dayTotal * q;
      });
    }
    current.setDate(current.getDate() + 1);
  }

  return Object.values(monthAccumulator).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export function serviceOverlapsMonth(startDate: string, endDate: string, year: number, month: number): boolean {
  const mStart = new Date(year, month, 1);
  const mEnd = new Date(year, month + 1, 0);
  const sStart = parseYmdToLocalDate(startDate);
  const sEnd = parseYmdToLocalDate(endDate);
  if (!sStart || !sEnd) return false;
  return sStart <= mEnd && sEnd >= mStart;
}

export function calculateSlaHoursForMonth(
  positions: ServicePosition[],
  startStr: string,
  endStr: string,
  excludedDates: string[] | undefined,
  year: number,
  month: number,
): { total: number; night: number; holiday: number; weekend: number } {
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const breakdown = calculateMonthlyBreakdown(positions, startStr, endStr, excludedDates);
  const row = breakdown.find((m) => m.monthKey === monthKey);
  return {
    total: row?.totalHours ?? 0,
    night: row?.nightHours ?? 0,
    holiday: row?.holidayHours ?? 0,
    weekend: row?.weekendHours ?? 0,
  };
}

export function calculateSlaHoursForDateRange(
  positions: ServicePosition[],
  startStr: string,
  endStr: string,
  excludedDates: string[] | undefined,
  rangeStart: Date | null,
  rangeEnd: Date | null,
): number {
  if (!positions?.length || !startStr || !endStr) return 0;
  const contractStart = parseYmdToLocalDate(startStr);
  const contractEnd = parseYmdToLocalDate(endStr);
  if (!contractStart || !contractEnd) return 0;

  const from = rangeStart && contractStart > rangeStart ? contractStart : (rangeStart || contractStart);
  const to = rangeEnd && contractEnd < rangeEnd ? contractEnd : (rangeEnd || contractEnd);
  if (from > to) return 0;

  const pad = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const breakdown = calculateMonthlyBreakdown(positions, pad(from), pad(to), excludedDates);
  return Math.round(breakdown.reduce((acc, m) => acc + m.totalHours, 0));
}

export function sumSlaHoursForServicesInMonth(
  services: Array<{ positions?: ServicePosition[]; startDate?: string; endDate?: string; excludedDates?: string[] }>,
  year: number,
  month: number,
): { total: number; night: number; holiday: number; weekend: number; activeCount: number } {
  let total = 0;
  let night = 0;
  let holiday = 0;
  let weekend = 0;
  let activeCount = 0;
  for (const srv of services) {
    if (!serviceOverlapsMonth(srv.startDate || '', srv.endDate || '', year, month)) continue;
    activeCount++;
    const h = calculateSlaHoursForMonth(
      srv.positions || [],
      srv.startDate || '',
      srv.endDate || '',
      srv.excludedDates,
      year,
      month,
    );
    total += h.total;
    night += h.night;
    holiday += h.holiday;
    weekend += h.weekend;
  }
  return { total, night, holiday, weekend, activeCount };
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Horas SLA de un puesto en un día (sin quantity; 0 si fuera de contrato o excluido). */
export function slaHoursForPositionOnDay(
  pos: ServicePosition,
  day: Date,
  srvStartStr: string,
  srvEndStr: string,
  excludedDates?: string[],
): number {
  const sStart = parseYmdToLocalDate(srvStartStr);
  const sEnd = parseYmdToLocalDate(srvEndStr);
  if (!sStart || !sEnd) return 0;
  const cur = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0);
  if (cur < sStart || cur > sEnd) return 0;
  const dateStr = toLocalDateStr(cur);
  if (excludedDates?.includes(dateStr)) return 0;
  if (pos.excludedDates?.includes(dateStr)) return 0;
  const dayCode = WEEK_DAY_CODES[cur.getDay()];
  return computePositionDayComposition(pos, dayCode).dayTotal;
}

/** Horas SLA totales de un servicio en un día (suma puestos × quantity). */
export function slaHoursForServiceOnDay(
  srv: { startDate?: string; endDate?: string; positions?: ServicePosition[]; excludedDates?: string[] },
  day: Date,
): number {
  if (!srv.startDate || !srv.endDate) return 0;
  return (srv.positions || []).reduce(
    (acc, pos) =>
      acc + slaHoursForPositionOnDay(pos, day, srv.startDate!, srv.endDate!, srv.excludedDates) * (pos.quantity || 1),
    0,
  );
}

/** Días del rango con al menos 1 hs de demanda SLA (mismo criterio que Servicios/CRM). */
export function countSlaDemandDaysInRange(
  services: Array<{ startDate?: string; endDate?: string; positions?: ServicePosition[]; excludedDates?: string[] }>,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 12, 0, 0, 0);
  const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 12, 0, 0, 0);
  let n = 0;
  for (let d = new Date(rs); d <= re; d.setDate(d.getDate() + 1)) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
    const sum = services.reduce((acc, srv) => acc + slaHoursForServiceOnDay(srv, day), 0);
    if (sum > 0) n++;
  }
  return n;
}
