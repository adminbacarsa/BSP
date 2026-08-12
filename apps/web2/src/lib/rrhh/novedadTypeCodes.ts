/** Códigos de grilla usados por tipos de novedad configurables. */
export type AbsenceCode = 'V' | 'E' | 'A' | 'L' | 'PG' | 'AA' | 'LT' | 'SGS' | 'SUS';

export const ABSENCE_CODE_OPTIONS: { value: AbsenceCode; label: string }[] = [
  { value: 'V', label: 'V — Vacaciones' },
  { value: 'E', label: 'E — Enfermedad' },
  { value: 'A', label: 'A — ART / Autorizada' },
  { value: 'L', label: 'L — Licencia' },
  { value: 'PG', label: 'PG — Permiso gremial' },
  { value: 'AA', label: 'AA — Injustificada' },
  { value: 'LT', label: 'LT — Llegada tarde' },
  { value: 'SGS', label: 'SGS — Sin goce' },
  { value: 'SUS', label: 'SUS — Suspensión' },
];
