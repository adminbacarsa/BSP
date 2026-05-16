/**
 * Cálculo de horas vendidas SLA — misma lógica que Servicios (calculateMonthlyBreakdown / computePositionDayComposition).
 */

const WEEK_DAY_CODES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

type ShiftVariant = { code: string; startTime: string; endTime: string; hours?: number };

const SHIFT_VARIANTS_DB: Record<string, ShiftVariant> = {
  M: { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
  T: { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
  N: { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
  D12: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
  N12: { code: 'N12', startTime: '19:00', endTime: '07:00', hours: 12 },
};

function parseYmdLocal(ymd: string): Date | null {
  const core = String(ymd).trim().slice(0, 10);
  const y = parseInt(core.slice(0, 4), 10);
  const mo = parseInt(core.slice(5, 7), 10);
  const d = parseInt(core.slice(8, 10), 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function analyzeShiftComposition(start: string, end: string): { total: number; night: number } {
  const [h1, m1] = (start || '00:00').split(':').map(Number);
  const [h2, m2] = (end || '00:00').split(':').map(Number);
  let startMin = h1 * 60 + m1;
  let endMin = h2 * 60 + m2;
  if (endMin < startMin) endMin += 24 * 60;
  const durationMin = endMin - startMin;
  let nightMinutes = 0;
  const NIGHT_START = 21 * 60;
  const NIGHT_END = 6 * 60;
  for (let t = startMin; t < endMin; t++) {
    const modT = t % 1440;
    if (modT < NIGHT_END || modT >= NIGHT_START) nightMinutes += 1;
  }
  return {
    total: Math.round((durationMin / 60) * 100) / 100,
    night: Math.round((nightMinutes / 60) * 100) / 100,
  };
}

function computePositionDayComposition(pos: Record<string, unknown>, dayCode: string): { dayTotal: number; dayNight: number } {
  let dayTotal = 0;
  let dayNight = 0;
  const addVariant = (v: ShiftVariant) => {
    const comp = analyzeShiftComposition(v.startTime, v.endTime);
    dayTotal += comp.total;
    dayNight += comp.night;
  };
  const cov = String(pos.coverageType || 'custom').toLowerCase();
  const shifts = (Array.isArray(pos.allowedShiftTypes) ? pos.allowedShiftTypes : []) as Array<Record<string, unknown>>;

  if (cov === '24hs') {
    const m = shifts.find((s) => String(s.code) === 'M');
    const t = shifts.find((s) => String(s.code) === 'T');
    const n = shifts.find((s) => String(s.code) === 'N');
    const d12 = shifts.find((s) => String(s.code) === 'D12');
    const n12 = shifts.find((s) => String(s.code) === 'N12');
    if (m && t && n) {
      addVariant(m as ShiftVariant);
      addVariant(t as ShiftVariant);
      addVariant(n as ShiftVariant);
    } else if (d12 && n12) {
      addVariant(d12 as ShiftVariant);
      addVariant(n12 as ShiftVariant);
    } else {
      addVariant(SHIFT_VARIANTS_DB.D12);
      addVariant(SHIFT_VARIANTS_DB.N12);
    }
  } else if (cov === '12hs_diurno') {
    addVariant(SHIFT_VARIANTS_DB.D12);
  } else if (cov === '12hs_nocturno') {
    addVariant(SHIFT_VARIANTS_DB.N12);
  } else if (cov === 'custom') {
    for (const shift of shifts) {
      const days = Array.isArray(shift.days) ? (shift.days as string[]) : [];
      const v: ShiftVariant = {
        code: String(shift.code ?? ''),
        startTime: String(shift.startTime ?? '08:00'),
        endTime: String(shift.endTime ?? '16:00'),
        hours: Number(shift.hours) || undefined,
      };
      if (days.length > 0) {
        if (days.includes(dayCode)) addVariant(v);
      } else {
        addVariant(v);
      }
    }
  }
  return { dayTotal, dayNight };
}

/** Horas vendidas del SLA en un mes calendario (intersección contrato × mes). */
export function slaHorasVendidasMesCalendario(
  positions: unknown[],
  contractStartYmd: string,
  contractEndYmd: string,
  refYmd: string,
): {
  mes_yyyy_mm: string;
  horas_vendidas_mes: number;
  horas_nocturnas_mes: number;
  dias_contrato_en_mes: number;
} {
  const ref = parseYmdLocal(refYmd);
  if (!ref) {
    return { mes_yyyy_mm: refYmd.slice(0, 7), horas_vendidas_mes: 0, horas_nocturnas_mes: 0, dias_contrato_en_mes: 0 };
  }
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const cStart = parseYmdLocal(contractStartYmd);
  const cEnd = parseYmdLocal(contractEndYmd);
  if (!cStart || !cEnd) {
    return {
      mes_yyyy_mm: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`,
      horas_vendidas_mes: 0,
      horas_nocturnas_mes: 0,
      dias_contrato_en_mes: 0,
    };
  }

  const from = monthStart > cStart ? monthStart : cStart;
  const to = monthEnd < cEnd ? monthEnd : cEnd;
  if (from > to) {
    return {
      mes_yyyy_mm: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`,
      horas_vendidas_mes: 0,
      horas_nocturnas_mes: 0,
      dias_contrato_en_mes: 0,
    };
  }

  const posList = Array.isArray(positions) ? positions : [];
  let total = 0;
  let night = 0;
  let days = 0;
  const cur = new Date(from);
  cur.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);

  while (cur <= end) {
    days += 1;
    const dayCode = WEEK_DAY_CODES[cur.getDay()];
    for (const pos of posList) {
      const p = pos as Record<string, unknown>;
      const activeDays = Array.isArray(p.activeDays) ? (p.activeDays as string[]) : null;
      if (activeDays && activeDays.length > 0 && !activeDays.includes(dayCode)) continue;
      const q = Math.max(1, Number(p.quantity) || 1);
      const { dayTotal, dayNight } = computePositionDayComposition(p, dayCode);
      total += dayTotal * q;
      night += dayNight * q;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return {
    mes_yyyy_mm: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`,
    horas_vendidas_mes: Math.round(total * 10) / 10,
    horas_nocturnas_mes: Math.round(night * 10) / 10,
    dias_contrato_en_mes: days,
  };
}
