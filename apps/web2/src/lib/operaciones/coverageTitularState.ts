/** Criterios puros titular/cobertura (sin Firebase). Espejo functions + web2. */

export function isDualSiblingOpsCoverage(existingType: string, incomingType: string): boolean {
  const a = String(existingType || '').toUpperCase();
  const b = String(incomingType || '').toUpperCase();
  return (a === 'EXTEND' && b === 'ADVANCE') || (a === 'ADVANCE' && b === 'EXTEND');
}

export function isTitularAlreadyCovered(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PARTIAL' || st === 'PLANNED') return false;
  if (data.operacionallyCovered === true) return true;
  if (st === 'COVERED') return true;
  return false;
}
