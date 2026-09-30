/** Criterios puros titular/cobertura (sin Firebase). Espejo functions + web2. */

export function isDualSiblingOpsCoverage(existingType: string, incomingType: string): boolean {
  const a = String(existingType || '').toUpperCase();
  const b = String(incomingType || '').toUpperCase();
  return (a === 'EXTEND' && b === 'ADVANCE') || (a === 'ADVANCE' && b === 'EXTEND');
}

/** Espejo de `apps/functions/src/coverage/partialSegment.ts`. */
const REMAINDER_TOL_MS = 2 * 60 * 1000;

export function completesPartialSegment(existingType: string, incomingType: string): boolean {
  const ex = String(existingType || '').toUpperCase();
  const inc = String(incomingType || '').toUpperCase();
  if (!ex || !inc || ex === inc) return false;
  if (isDualSiblingOpsCoverage(ex, inc)) return true;
  if ((ex === 'EXTEND' || ex === 'ADVANCE') && ['FT', 'RET', 'REF', 'ESC'].includes(inc)) return true;
  return false;
}

export function uncoveredRemainderMs(
  gapStart: number,
  gapEnd: number,
  coveredStart: number,
  coveredEnd: number,
): { startMs: number; endMs: number } | null {
  if (!gapStart || !gapEnd || gapEnd <= gapStart) return null;
  if (!coveredStart || !coveredEnd || coveredEnd <= coveredStart) return null;
  if (Math.abs(coveredStart - gapStart) <= REMAINDER_TOL_MS && coveredEnd < gapEnd - REMAINDER_TOL_MS) {
    return { startMs: coveredEnd, endMs: gapEnd };
  }
  if (Math.abs(coveredEnd - gapEnd) <= REMAINDER_TOL_MS && coveredStart > gapStart + REMAINDER_TOL_MS) {
    return { startMs: gapStart, endMs: coveredStart };
  }
  return null;
}

export function isTitularAlreadyCovered(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PARTIAL' || st === 'PLANNED') return false;
  if (data.operacionallyCovered === true) return true;
  if (st === 'COVERED') return true;
  return false;
}
