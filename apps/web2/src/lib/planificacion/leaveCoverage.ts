/** Licencias/ausencias RRHH — reglas compartidas planificación ↔ reportes. */

export const RRHH_LEAVE_CODES = new Set(['V', 'L', 'PG', 'A', 'E', 'AA']);

export const RRHH_ABSENCE_TYPES = new Set([
  'Vacaciones',
  'Enfermedad',
  'Licencia Esp.',
  'PG Permiso Gremial',
  'ART',
  'Injustificada',
  'MAVIC',
  'Matrimonio',
  'Maternidad',
  'Nacimiento / Paternidad',
  'Fallecimiento Familiar',
  'Examen / Estudio',
  'Mudanza',
  'Donación de Sangre',
  'Sin Goce de Sueldo',
  'Suspensión',
]);

const ABSENCE_TYPE_TO_CODE: Record<string, string> = {
  Vacaciones: 'V',
  Enfermedad: 'E',
  'Licencia Esp.': 'L',
  'PG Permiso Gremial': 'PG',
  ART: 'A',
  Injustificada: 'AA',
  MAVIC: 'L',
  Matrimonio: 'L',
  Maternidad: 'L',
  'Nacimiento / Paternidad': 'L',
  'Fallecimiento Familiar': 'L',
  'Examen / Estudio': 'L',
  Mudanza: 'L',
  'Donación de Sangre': 'L',
  'Sin Goce de Sueldo': 'SGS',
  Suspensión: 'SUS',
};

export function resolveLeaveCode(
  shiftCode?: string | null,
  absenceType?: string | null,
): string | null {
  const code = String(shiftCode ?? '').trim().toUpperCase();
  if (RRHH_LEAVE_CODES.has(code)) return code;
  const t = String(absenceType ?? '').trim();
  return ABSENCE_TYPE_TO_CODE[t] || null;
}

export function isEmployeeOnLeave(opts: {
  shiftCode?: string | null;
  absenceType?: string | null;
  absence?: { type?: string } | null;
}): boolean {
  if (opts.absence?.type && RRHH_ABSENCE_TYPES.has(String(opts.absence.type).trim())) return true;
  return !!resolveLeaveCode(opts.shiftCode, opts.absenceType || opts.absence?.type);
}

export function hasLeaveCoverage(coveredBy?: string | null): boolean {
  return !!String(coveredBy ?? '').trim();
}

/** Sin sirena de conflicto si la celda es licencia (con o sin cobertura). */
export function shouldShowLeaveConflictSiren(opts: {
  shiftCode?: string | null;
  absence?: { type?: string; inferredCode?: string } | null;
  coveredBy?: string | null;
  hasNovedad?: boolean;
  shiftStatus?: string | null;
}): boolean {
  const absCode = opts.absence
    ? String((opts.absence as { inferredCode?: string }).inferredCode ?? '').trim().toUpperCase()
      || resolveLeaveCode(undefined, opts.absence.type)
    : null;
  const effective = String(opts.shiftCode ?? '').trim().toUpperCase();
  const leaveCode = resolveLeaveCode(effective, opts.absence?.type) || absCode;
  if (leaveCode && RRHH_LEAVE_CODES.has(leaveCode)) return false;
  if (opts.absence && opts.shiftStatus !== 'ABSENT') {
    if (isEmployeeOnLeave({ shiftCode: effective, absence: opts.absence })) return false;
    return true;
  }
  if (opts.hasNovedad) return true;
  return false;
}
