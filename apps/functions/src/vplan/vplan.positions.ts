/** Definición de puesto SLA normalizada para VPLAN. */

export interface VplanPositionDef {
  positionName: string;
  qty: number;
  coverageType: string;
  shifts: Array<{ code: string; hours: number; startTime?: string; endTime?: string }>;
  activeDays?: string[];
}

export function is24hsPosition(pos: VplanPositionDef): boolean {
  const cov = String(pos.coverageType || '').toLowerCase();
  return cov === '24hs' || cov === '24' || cov === '24h';
}

export function isPositionActiveOnDay(pos: VplanPositionDef, dayLetter: string): boolean {
  const days = pos.activeDays;
  if (!days || days.length === 0) return true;
  return days.includes(dayLetter);
}

export function shiftBandHours(shift: { code?: string; hours?: number }): number {
  const h = Number(shift.hours);
  if (Number.isFinite(h) && h > 0) return h;
  const code = String(shift.code || '').toUpperCase();
  if (code === 'D12' || code === 'N12') return 12;
  return 8;
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
    })).filter((s) => s.code);

    return {
      positionName: String(p.name || p.positionName || 'General'),
      qty: Math.max(1, Number(p.quantity ?? p.qty) || 1),
      coverageType: String(p.coverageType || 'custom'),
      shifts: shifts.length > 0 ? shifts : [{ code: 'M', hours: 8 }],
      activeDays: Array.isArray(p.activeDays) ? p.activeDays.map(String) : undefined,
    };
  });
}
