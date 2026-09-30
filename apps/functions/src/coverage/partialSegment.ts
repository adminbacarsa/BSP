/**
 * Tramo que falta de un titular PARTIAL.
 * EXT cubre el inicio → mitad (23:00–03:00); el resto (03:00–07:00) lo puede tomar
 * ADV, FT, RET, REF o ESC sin que applyCoverage responda ALREADY_COVERED.
 */

const TOL_MS = 2 * 60 * 1000;

export function completesPartialSegment(existingType: string, incomingType: string): boolean {
  const ex = String(existingType || '').toUpperCase();
  const inc = String(incomingType || '').toUpperCase();
  if (!ex || !inc || ex === inc) return false;
  if ((ex === 'EXTEND' && inc === 'ADVANCE') || (ex === 'ADVANCE' && inc === 'EXTEND')) return true;
  if ((ex === 'EXTEND' || ex === 'ADVANCE') && ['FT', 'RET', 'REF', 'ESC'].includes(inc)) return true;
  return false;
}

/** Parte del hueco que la cobertura activa no llega a tapar. null si no hay un resto claro. */
export function uncoveredRemainderMs(
  gapStart: number,
  gapEnd: number,
  coveredStart: number,
  coveredEnd: number,
): { startMs: number; endMs: number } | null {
  if (!gapStart || !gapEnd || gapEnd <= gapStart) return null;
  if (!coveredStart || !coveredEnd || coveredEnd <= coveredStart) return null;
  if (Math.abs(coveredStart - gapStart) <= TOL_MS && coveredEnd < gapEnd - TOL_MS) {
    return { startMs: coveredEnd, endMs: gapEnd };
  }
  if (Math.abs(coveredEnd - gapEnd) <= TOL_MS && coveredStart > gapStart + TOL_MS) {
    return { startMs: gapStart, endMs: coveredStart };
  }
  return null;
}
