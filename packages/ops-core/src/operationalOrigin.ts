/** Regla CC (useOperacionesMonitor): turno operativo vs planificado publicado. */
export function isOperationalOriginShift(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const shiftCodeUpper = String(data.code || data.type || '').toUpperCase();
  const isClientRefuerzoPlanificado =
    data.origin === 'CLIENT_REQUEST' && (shiftCodeUpper === 'RFZ' || shiftCodeUpper === 'TURA');
  return (
    data.origin === 'RETEN'
    || data.origin === 'OPERATIONS_COVERAGE'
    || data.origin === 'SLA_VIRTUAL'
    || (data.origin === 'CLIENT_REQUEST' && !isClientRefuerzoPlanificado)
    || data.origin === 'EVENTO'
    || !!data.isReten
    || data.resolvedBy === 'OPERACIONES'
  );
}
