/**
 * RET planificado = retención pasiva (stand-by). No es turno activo en Ops
 * hasta convocatoria/redirección (p. ej. coverageRedirectedTo, origin RETEN).
 */
export function isPassiveRetStandbyShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;
  const code = String(shift.code || shift.type || '').toUpperCase();
  if (code !== 'RET') return false;
  if (shift.origin === 'RETEN' || shift.isReten === true) return false;
  if (shift.resolvedBy === 'OPERACIONES' && shift.origin === 'OPERATIONS_COVERAGE') return false;
  if (shift.coverageRedirectedTo) return false;
  if (shift.isRetention === true) return false;
  if (shift.coverageUsed === true) return false;
  return true;
}
