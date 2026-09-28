import {
  accumulatePayrollTurnoContribution,
  dateKeyAR,
  type PersonaHoursBreakdown,
} from './payrollTurnoAccumulator';

export type TurnoHoursContrib = {
  hsTeoricas: number;
  hsReales: number;
  diurnas: number;
  nocturnas: number;
  al100FT: number;
  plusFeriado: number;
  isFT: boolean;
  /** YYYY-MM en calendario Argentina (no reloj local del proceso). */
  monthKey: string;
  desglose: PersonaHoursBreakdown;
};

export function monthKeyFromDate(d: Date): string {
  return dateKeyAR(d).slice(0, 7);
}

function startInstant(data: Record<string, unknown>): Date | null {
  const val = data.startTime;
  if (!val) return null;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const s = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  return null;
}

/**
 * Libro PERSONA por turno completado. Misma regla que Liquidación (clamp a banda, adelanto, retención, FT).
 * El trigger acumula deltas antes/después: solo aporta con isCompleted.
 */
export function calcTurnoHoursContrib(
  data: Record<string, unknown>,
  holidays: Set<string> = new Set(),
): TurnoHoursContrib | null {
  if (data.draft === true) return null;
  if (data.isUnassigned === true) return null;
  if (data.isCompleted !== true) return null;

  const empId = String(data.employeeId ?? '').trim();
  if (!empId || empId === 'VACANTE') return null;

  const status = String(data.status ?? '').toUpperCase();
  if (status === 'CANCELED' || status === 'CANCELLED') return null;
  if (String(data.type ?? '').toUpperCase() === 'NOVEDAD') return null;

  const contrib = accumulatePayrollTurnoContribution(data, {
    hoursMode: 'real',
    holidays,
    turnoId: String(data.id ?? 'turno'),
  });
  if (contrib.warnings.some((w) => w.includes('sin startTime'))) return null;

  const code = String(data.code ?? '').trim().toUpperCase();
  const isFT = data.isFrancoTrabajado === true || code === 'FT' || code.startsWith('FT/');
  const startDt = startInstant(data);
  const monthKey = startDt
    ? monthKeyFromDate(startDt)
    : String(data.scheduleDate ?? '').slice(0, 7);

  return {
    hsTeoricas: contrib.hsTeoricas,
    hsReales: contrib.hsReales,
    diurnas: contrib.diurnas,
    nocturnas: contrib.nocturnas,
    al100FT: contrib.al100FT,
    plusFeriado: contrib.plusFeriado,
    isFT,
    monthKey,
    desglose: contrib.desglose,
  };
}
