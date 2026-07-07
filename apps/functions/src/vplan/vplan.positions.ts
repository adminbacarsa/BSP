/** Definición de puesto SLA normalizada para VPLAN. */

import { is4x2Cycle, normalizeCycleKey } from './vplan.cycle-templates';

export interface VplanPositionDef {
  positionName: string;
  qty: number;
  coverageType: string;
  shifts: Array<{
    code: string;
    hours: number;
    startTime?: string;
    endTime?: string;
    days?: string[];
  }>;
  activeDays?: string[];
}

const WEEKDAYS_LV = ['L', 'M', 'X', 'J', 'V'] as const;
const ALL_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const CUSTOM_LV_CODES = new Set(['EN', 'RO', 'RON', 'PU', 'GU', 'LT']);

export function is24hsPosition(pos: VplanPositionDef): boolean {
  const cov = String(pos.coverageType || '').toLowerCase();
  if (cov === '24hs' || cov === '24' || cov === '24h') {
    const codes = (pos.shifts || []).map((s) => String(s.code || '').toUpperCase());
    const hasMtn = codes.some((c) => WORK_BANDS.has(c));
    return hasMtn;
  }
  return false;
}

export function isPositionActiveOnDay(pos: VplanPositionDef, dayLetter: string): boolean {
  const days = resolveActiveDays(pos);
  if (!days || days.length === 0) return true;
  return days.includes(dayLetter);
}

export function resolveActiveDays(pos: VplanPositionDef): string[] | undefined {
  if (Array.isArray(pos.activeDays) && pos.activeDays.length > 0 && pos.activeDays.length < 7) {
    return pos.activeDays;
  }

  const workingShifts = (pos.shifts || []).filter((s) => String(s.code || '').toUpperCase() !== 'F');
  const shiftDays = workingShifts
    .flatMap((s) => (Array.isArray(s.days) ? s.days : []))
    .filter(Boolean);
  const uniqueShiftDays = [...new Set(shiftDays)];
  if (uniqueShiftDays.length > 0 && uniqueShiftDays.length < 7) {
    return uniqueShiftDays;
  }

  const codes = workingShifts.map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
  const onlyCustom = codes.length > 0 && codes.every((c) => !WORK_BANDS.has(c));
  if (onlyCustom && codes.some((c) => CUSTOM_LV_CODES.has(c))) {
    return [...WEEKDAYS_LV];
  }

  if (Array.isArray(pos.activeDays) && pos.activeDays.length >= 7) {
    return pos.activeDays;
  }

  return pos.activeDays;
}

export function isVirtualEmployeeId(empId: string): boolean {
  const u = String(empId || '').trim().toUpperCase();
  return u === 'VACANTE' || u === 'SIN_COBERTURA' || u.startsWith('SIN_COBERTURA:');
}

/** Bandas SLA aplicables según ciclo CCT (6+2 → solo M/T/N en 24hs). */
export function shiftsForCycle(
  pos: VplanPositionDef,
  cycle?: string,
): VplanPositionDef['shifts'] {
  if (!is24hsPosition(pos)) return pos.shifts;
  const cycleKey = normalizeCycleKey(cycle);
  if (is4x2Cycle(cycleKey)) {
    return pos.shifts.filter((s) => {
      const c = String(s.code || '').toUpperCase();
      return c === 'D12' || c === 'N12';
    });
  }
  return pos.shifts.filter((s) => {
    const c = String(s.code || '').toUpperCase();
    return c === 'M' || c === 'T' || c === 'N';
  });
}

export function positionDefForCycle(
  pos: VplanPositionDef,
  cycle?: string,
): VplanPositionDef {
  const shifts = shiftsForCycle(pos, cycle);
  return {
    ...pos,
    shifts: shifts.length > 0 ? shifts : [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }],
  };
}

export function positionsForCycle(
  positions: VplanPositionDef[],
  cycle?: string,
): VplanPositionDef[] {
  return positions.map((p) => positionDefForCycle(p, cycle));
}

export function isCustomFixedShiftPosition(pos: VplanPositionDef): boolean {
  if (is24hsPosition(pos)) return false;
  const codes = (pos.shifts || []).map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
  return codes.length > 0 && codes.every((c) => !WORK_BANDS.has(c));
}

export function primaryShiftCode(pos: VplanPositionDef): string {
  const code = String(pos.shifts?.[0]?.code || 'M').toUpperCase();
  return code || 'M';
}

export function shiftBandHours(shift: { code?: string; hours?: number }): number {
  const h = Number(shift.hours);
  if (Number.isFinite(h) && h > 0) return h;
  const code = String(shift.code || '').toUpperCase();
  if (code === 'D12' || code === 'N12') return 12;
  if (code === 'EN') return 9;
  if (code === 'RO' || code === 'RON') return 10;
  return 8;
}

function inferCoverageType(
  rawCoverage: string,
  shifts: VplanPositionDef['shifts'],
): string {
  const cov = String(rawCoverage || '').toLowerCase();
  const codes = shifts.map((s) => s.code).filter(Boolean);
  const hasMtn = codes.some((c) => WORK_BANDS.has(c));
  if ((cov === '24hs' || cov === '24' || cov === '24h') && !hasMtn) {
    return 'custom';
  }
  if (!cov || cov === 'custom') return 'custom';
  return rawCoverage;
}

export function normalizeSlaPositions(rawPositions: unknown[]): VplanPositionDef[] {
  if (!Array.isArray(rawPositions)) return [];
  return rawPositions.map((p: Record<string, unknown>) => {
    const rawShifts = (p.allowedShiftTypes || p.shifts || []) as Array<Record<string, unknown>>;
    const shifts = rawShifts.map((s) => ({
      code: String(s.code || '').toUpperCase(),
      hours: Number(s.hours) || shiftBandHours({ code: String(s.code || '') }),
      startTime: s.startTime ? String(s.startTime) : undefined,
      endTime: s.endTime ? String(s.endTime) : undefined,
      days: Array.isArray(s.days) ? s.days.map(String) : undefined,
    })).filter((s) => s.code);

    const rawActiveDays = Array.isArray(p.activeDays) ? p.activeDays.map(String) : undefined;
    const pos: VplanPositionDef = {
      positionName: String(p.name || p.positionName || 'General'),
      qty: Math.max(1, Number(p.quantity ?? p.qty) || 1),
      coverageType: inferCoverageType(String(p.coverageType || 'custom'), shifts),
      shifts: shifts.length > 0 ? shifts : [{ code: 'M', hours: 8 }],
      activeDays: rawActiveDays,
    };

    const resolved = resolveActiveDays(pos);
    if (resolved) pos.activeDays = resolved;
    return pos;
  });
}
