/**
 * Código completo del refuerzo / escuela: «REF·M2», «ESC·T». La banda sale de
 * `deploymentBand` (la grilla de Planificación muestra lo mismo). Es solo
 * presentación: el código de relevo y la serie siguen leyendo `code`.
 */
export const DEPLOYMENT_BAND_CODES: ReadonlySet<string> = new Set(['REF', 'ESC']);

export function deploymentCodeLabel(code: string | null | undefined, deploymentBand?: unknown): string {
  const c = String(code || '').trim().toUpperCase();
  if (!DEPLOYMENT_BAND_CODES.has(c)) return c;
  const band = String(deploymentBand ?? '').trim().toUpperCase();
  return band ? `${c}·${band}` : c;
}

/** Código del turno tal como se muestra en el CC (REF/ESC con su banda). */
export function opsShiftDisplayCode(shift: Record<string, unknown> | null | undefined): string {
  if (!shift) return '';
  const code = String(shift.code || shift.type || shift.shiftCode || '').trim().toUpperCase();
  return deploymentCodeLabel(code, shift.deploymentBand);
}
