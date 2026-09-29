import { toDateSafe } from './crmDateUtils';
import { isPlanificadorPlannedHoursShift } from '@/lib/planificacion/planningScheduledHours';
import { isProformaVacancyShift, isSinCoberturaShift } from './proformaVacancy';
import { isEventoGuardHoursShift } from './eventosGuardHours';

/**
 * Modo de detalle de la pre-factura (grilla por objetivo/legajo).
 * `fijo` y `orden_compra` fuerzan el modo de facturación de los contratos (slaBilling);
 * en la grilla, `fijo` muestra la malla planificada y `orden_compra` lo ejecutado por franja.
 */
export type ProformaDetailMode = 'auto' | 'planned' | 'executed' | 'fijo' | 'orden_compra' | 'sin_cobertura';

/** Grilla que corresponde a un modo explícito (null = Auto, decide el contrato). */
export function proformaDetailGridMode(mode: ProformaDetailMode): 'planned' | 'executed' | 'sin_cobertura' | null {
  if (mode === 'sin_cobertura') return 'sin_cobertura';
  if (mode === 'planned' || mode === 'fijo') return 'planned';
  if (mode === 'executed' || mode === 'orden_compra') return 'executed';
  return null;
}

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
  const fixed = proformaDetailGridMode(mode);
  if (fixed) return fixed;
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
  if (isEventoGuardHoursShift(t)) return false;
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
    case 'fijo':
      return 'Fijo (contrato)';
    case 'orden_compra':
      return 'Orden de compra (tope OC)';
    case 'sin_cobertura':
      return 'Sin cobertura (ops)';
    default:
      return mode;
  }
}
