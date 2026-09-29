/**
 * Hueco de evento en el CC. Espejo en functions/src/eventos/eventoCoverage.ts.
 * Un evento es `code === 'EV'` u `origin === 'EVENTO'`. Un eventoId suelto en M/T/N no lo es.
 */

export const EVENT_COVERAGE_CASCADE_ORDER = ['REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'] as const;

export type EventualCandidato = {
  employeeId: string;
  employeeName: string;
};

export function isEventoShift(shift: object | null | undefined): boolean {
  if (!shift) return false;
  const row = shift as { code?: unknown; origin?: unknown };
  const code = String(row.code || '').trim().toUpperCase();
  const origin = String(row.origin || '').trim().toUpperCase();
  return code === 'EV' || origin === 'EVENTO';
}

/** Solo si el evento define franjas encadenadas aplica la serie/relevo. Si no, no se retiene. */
export function eventoTieneFranjasEncadenadas(shift: object | null | undefined): boolean {
  if (!shift) return false;
  return (shift as { eventoFranjasEncadenadas?: unknown }).eventoFranjasEncadenadas === true;
}

/**
 * Bolsa de eventuales: vacía hasta que exista el módulo.
 * El CC la consulta primero; después sigue EVENT_COVERAGE_CASCADE_ORDER.
 */
export function eventualesParaHueco(): EventualCandidato[] {
  return [];
}

/**
 * Eventual que no se presentó. Diseño, sin alta/baja ARCA.
 * La AA queda en el legajo de la empresa que lo dio de alta, se descuenta de la liquidación
 * y baja su confiabilidad en la bolsa. Si nunca fichó, RRHH tiene pendiente anular el alta.
 */
export type EventualAusentePlan = {
  employeeId: string;
  empresaAltaId: string;
  eventoId: string;
  shiftId: string;
  neverStarted: boolean;
  descuentaLiquidacion: true;
  confiabilidadDelta: -1;
  arcaBajaPendiente: boolean;
};

export function planEventualAusente(input: {
  employeeId?: string;
  empresaAltaId?: string;
  eventoId?: string;
  shiftId?: string;
  isEventual?: boolean;
  punched?: boolean;
}): EventualAusentePlan | null {
  if (input.isEventual !== true) return null;
  const employeeId = String(input.employeeId || '').trim();
  const empresaAltaId = String(input.empresaAltaId || '').trim();
  if (!employeeId || !empresaAltaId) return null;
  const neverStarted = input.punched !== true;
  return {
    employeeId,
    empresaAltaId,
    eventoId: String(input.eventoId || ''),
    shiftId: String(input.shiftId || ''),
    neverStarted,
    descuentaLiquidacion: true,
    confiabilidadDelta: -1,
    arcaBajaPendiente: neverStarted,
  };
}
