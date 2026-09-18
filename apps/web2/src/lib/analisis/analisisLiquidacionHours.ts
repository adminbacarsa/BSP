/**
 * Hs liquidadas del plantel = misma regla que Reportes → Liquidación.
 * Agrupa por legajo (RET/FT/dedupe son por empleado).
 */

import {
  calculateLiquidationHoursStats,
  dedupeShiftsByAbsencePriority,
  prepareShiftsForEmployeeLiquidation,
  propagateFrancoTrabajadoFlags,
} from '@/hooks/useReportes';

const r1 = (n: number) => Math.round(n * 10) / 10;

function isOperationalOriginShift(shift: any): boolean {
  const o = String(shift?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL' || o === 'CLIENT_REQUEST') return true;
  if (shift?.resolvedBy === 'OPERACIONES') return true;
  if (shift?.isReten === true) return true;
  return false;
}

function shiftHasCheckIn(shift: any): boolean {
  return !!(
    shift?.realStartTime
    || shift?.checkInTime
    || shift?.isPresent === true
    || shift?.isCompleted === true
  );
}

/** Alineado a liquidación oficial: sin borrador salvo ops o fichada. */
export function isShiftEligibleForAnalisisLiquidacion(shift: any): boolean {
  if (!shift) return false;
  if (shift.draft === true && !isOperationalOriginShift(shift) && !shiftHasCheckIn(shift)) return false;
  const st = String(shift.status || '').toLowerCase();
  if (st.includes('cancel') || st.includes('delet')) return false;
  return true;
}

export type PlantelLiquidacionHours = {
  horasReales: number;
  horasRealesCobertura: number;
  horasRealesDespliegue: number;
  horasTeoricas: number;
  horasCobertura: number;
  horasDespliegue: number;
  legajos: number;
  turnosConDatosReales: number;
};

export function sumPlantelLiquidationHours(
  turnos: any[],
  opts?: { usePlannedHours?: boolean },
): PlantelLiquidacionHours {
  const usePlannedHours = opts?.usePlannedHours ?? false;
  const byEmp = new Map<string, any[]>();

  for (const t of turnos || []) {
    if (!isShiftEligibleForAnalisisLiquidacion(t)) continue;
    const eid = String(t?.employeeId || '').trim();
    if (!eid || eid === 'VACANTE') continue;
    const list = byEmp.get(eid);
    if (list) list.push(t);
    else byEmp.set(eid, [t]);
  }

  let horasReales = 0;
  let horasRealesCobertura = 0;
  let horasRealesDespliegue = 0;
  let horasTeoricas = 0;
  let horasCobertura = 0;
  let horasDespliegue = 0;
  let turnosConDatosReales = 0;

  for (const shifts of byEmp.values()) {
    const prepared = prepareShiftsForEmployeeLiquidation(
      dedupeShiftsByAbsencePriority(
        propagateFrancoTrabajadoFlags(shifts, { usePlannedHours }),
        { usePlannedHours },
      ),
    );
    const stats = calculateLiquidationHoursStats(prepared, {}, { usePlannedHours });
    horasReales += stats.horasReales || 0;
    horasRealesCobertura += stats.horasRealesCobertura || 0;
    horasRealesDespliegue += stats.horasRealesDespliegue || 0;
    horasTeoricas += stats.horasTeoricas || 0;
    horasCobertura += stats.horasCobertura || 0;
    horasDespliegue += stats.horasDespliegue || 0;
    turnosConDatosReales += stats.turnosConDatosReales || 0;
  }

  return {
    horasReales: r1(horasReales),
    horasRealesCobertura: r1(horasRealesCobertura),
    horasRealesDespliegue: r1(horasRealesDespliegue),
    horasTeoricas: r1(horasTeoricas),
    horasCobertura: r1(horasCobertura),
    horasDespliegue: r1(horasDespliegue),
    legajos: byEmp.size,
    turnosConDatosReales,
  };
}
