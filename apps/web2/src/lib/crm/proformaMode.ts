import { toDateSafe } from './crmDateUtils';
import { isPlanificadorPlannedHoursShift } from '@/lib/planificacion/planningScheduledHours';
import { isProformaVacancyShift, isSinCoberturaShift } from './proformaVacancy';

/** Modo de detalle de la pre-factura (grilla por objetivo/legajo). */
export type ProformaDetailMode = 'auto' | 'planned' | 'executed' | 'sin_cobertura';

/**
 * Qué usa el modo Auto: un valor para todo el cliente o una decisión por turno
 * (cada objetivo sigue el billingMode de su contrato).
 */
export type AutoExecutedResolver = boolean | ((t: any) => boolean);

export function resolveProformaDetailMode(
  mode: ProformaDetailMode,
  useExecutedForAuto: AutoExecutedResolver,
  t?: any,
): 'planned' | 'executed' | 'sin_cobertura' {
  if (mode === 'sin_cobertura') return 'sin_cobertura';
  if (mode === 'planned') return 'planned';
  if (mode === 'executed') return 'executed';
  const executed = typeof useExecutedForAuto === 'function'
    ? (t != null && useExecutedForAuto(t))
    : useExecutedForAuto;
  return executed ? 'executed' : 'planned';
}

export function proformaGridUsesExecutedTimes(
  mode: ProformaDetailMode,
  useExecutedForAuto: AutoExecutedResolver,
  t?: any,
): boolean {
  return resolveProformaDetailMode(mode, useExecutedForAuto, t) === 'executed';
}

/** Elegibilidad de un turno según el modo de detalle activo. */
export function turnoEligibleForProformaGrid(
  t: any,
  mode: ProformaDetailMode,
  useExecutedForAuto: AutoExecutedResolver,
): boolean {
  const resolved = resolveProformaDetailMode(mode, useExecutedForAuto, t);

  if (resolved === 'sin_cobertura') {
    if (!isSinCoberturaShift(t)) return false;
    return !!toDateSafe(t.startTime);
  }

  if (isSinCoberturaShift(t) || isProformaVacancyShift(t)) return false;
  if (!isPlanificadorPlannedHoursShift(t)) return false;

  if (resolved === 'executed') {
    const realStart = toDateSafe(t.realStartTime);
    const realEnd = toDateSafe(t.realEndTime);
    if (!realStart || !realEnd) return false;
  }

  return true;
}

export function proformaDetailModeLabel(mode: ProformaDetailMode): string {
  switch (mode) {
    case 'auto':
      return 'Auto';
    case 'planned':
      return 'Planificado';
    case 'executed':
      return 'Ejecutado (fichaje)';
    case 'sin_cobertura':
      return 'Sin cobertura (ops)';
    default:
      return mode;
  }
}
