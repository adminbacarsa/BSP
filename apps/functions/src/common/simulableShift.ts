import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';

/**
 * Códigos de licencia/ausencia de la grilla (`AbsenceCode` de `tipos_novedad`) + ART.
 * Un turno con uno de estos códigos no es un turno trabajable: el guardia no va al puesto.
 */
export const LICENSE_SHIFT_CODES: ReadonlySet<string> = new Set([
  'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);

/** Descansos CCT: tampoco hay presencia que simular. */
export const FRANCO_SHIFT_CODES: ReadonlySet<string> = new Set(['F', 'FF', 'FP']);

export type SimulableSkipReason =
  | 'LICENCIA'
  | 'FRANCO'
  | 'DRAFT'
  | 'VIRTUAL'
  | 'OPS_COV_TRACE';

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Código de grilla del turno; `shiftCode` es el alias que usan novedades/ausencias. */
export function shiftGridCode(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  return normalizeCode(data.code) || normalizeCode(data.shiftCode);
}

export function isLicenseShiftCode(code: unknown): boolean {
  return LICENSE_SHIFT_CODES.has(normalizeCode(code));
}

export function isFrancoShiftCode(code: unknown): boolean {
  return FRANCO_SHIFT_CODES.has(normalizeCode(code));
}

/** Turno con licencia/ausencia de grilla (V, L, E, A, ART, AA, PG, SGS, SUS). */
export function isLicenseShift(data: Record<string, unknown> | null | undefined): boolean {
  return isLicenseShiftCode(shiftGridCode(data));
}

/**
 * Filtro único de "turno simulable" para todo escritor de presencia simulada
 * (modo Demo, auto-presencia SuperAdmin, auto-presencia del asistente).
 * Devuelve el motivo del descarte o `null` si el turno se puede simular.
 */
export function simulableShiftSkipReason(
  data: Record<string, unknown> | null | undefined,
): SimulableSkipReason | null {
  if (!data) return 'VIRTUAL';
  if (data.draft === true) return 'DRAFT';
  if (data.isVirtual === true) return 'VIRTUAL';
  if (isOpsCoverageHoursOnSourceDoc(data)) return 'OPS_COV_TRACE';
  const code = shiftGridCode(data);
  if (isLicenseShiftCode(code)) return 'LICENCIA';
  if (data.isFranco === true || isFrancoShiftCode(code)) return 'FRANCO';
  return null;
}

/**
 * La simulación nunca inventa presencia sobre licencias, francos, borradores,
 * turnos virtuales ni los `ops_cov` de registro EXT/ADV.
 */
export function isSimulableShift(data: Record<string, unknown> | null | undefined): boolean {
  return simulableShiftSkipReason(data) === null;
}
