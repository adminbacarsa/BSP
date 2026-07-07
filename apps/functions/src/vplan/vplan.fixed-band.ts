/**
 * Reglas puesto + banda fija (M/T/N) en VPLAN.
 * Prioridad: banda fija del legajo → rotación del resto del subgrupo → cobertura SLA.
 */

import type { VplanAssignment, VplanScheduleDraft } from './vplan.types';

const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);

function normBand(code: string): string {
  const c = code.toUpperCase();
  if (c === 'D12') return 'M';
  if (c === 'N12') return 'N';
  return c;
}

/**
 * Guardia con defaultShiftByEmp debe trabajar solo esa banda en días laborales.
 * (Francos excluidos.) Devuelve warnings — la cobertura se valida aparte.
 */
export function detectFixedBandViolations(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  defaultShiftByEmp: Record<string, string>,
  defaultPositionByEmp: Record<string, string>,
): Array<{
  employeeId: string;
  dateStr: string;
  expectedBand: string;
  actualCode: string;
  positionName: string;
}> {
  const violations: Array<{
    employeeId: string;
    dateStr: string;
    expectedBand: string;
    actualCode: string;
    positionName: string;
  }> = [];

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  for (const [empId, fixedRaw] of Object.entries(defaultShiftByEmp)) {
    const fixed = String(fixedRaw || '').toUpperCase();
    if (!WORK_BANDS.has(fixed)) continue;
    const expectedBand = normBand(fixed);
    const byDate = byEmp.get(empId);
    if (!byDate) continue;

    for (const dateStr of dateStrs) {
      const a = byDate.get(dateStr);
      if (!a) continue;
      const code = String(a.code || '').toUpperCase();
      if (FRANCO.has(code) || !code) continue;
      const actualBand = normBand(code);
      if (actualBand === expectedBand) continue;
      violations.push({
        employeeId: empId,
        dateStr,
        expectedBand: fixed,
        actualCode: code,
        positionName: a.positionName || defaultPositionByEmp[empId] || '',
      });
    }
  }

  return violations;
}
