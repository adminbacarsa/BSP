import { isRetShift } from './retShift';

/**
 * RET planificado = retención pasiva (stand-by). No es turno activo en Ops
 * hasta convocatoria/redirección (p. ej. coverageRedirectedTo, origin RETEN).
 * La identidad la da `isRetShift` (código, puesto «Retén», pool); un RET ya
 * mandado al puesto no se esconde como stand-by.
 */
export function isPassiveRetStandbyShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!isRetShift(shift)) return false;
  if (shift?.origin === 'RETEN') return false;
  if (shift?.resolvedBy === 'OPERACIONES' && shift?.origin === 'OPERATIONS_COVERAGE') return false;
  if (shift?.coverageRedirectedTo) return false;
  if (shift?.isRetention === true) return false;
  if (shift?.coverageUsed === true) return false;
  return true;
}
