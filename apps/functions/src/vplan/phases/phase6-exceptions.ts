/**
 * Fase 6 VPLAN — excepciones: marcar ausencias aprobadas en el borrador.
 */

import type { VplanScheduleDraft } from '../vplan.types';

const ABSENCE_CODE = 'V';

export function applyVplanAbsenceExceptions(opts: {
  draft: VplanScheduleDraft;
  absences: Record<string, Set<string>>;
  enabled: boolean;
}): { draft: VplanScheduleDraft; patchedDays: number } {
  if (!opts.enabled) return { draft: opts.draft, patchedDays: 0 };

  const byKey = new Map<string, number>();
  opts.draft.assignments.forEach((a, i) => {
    byKey.set(`${a.employeeId}_${a.dateStr}`, i);
  });

  let patchedDays = 0;
  const assignments = [...opts.draft.assignments];

  for (const [empId, dates] of Object.entries(opts.absences)) {
    for (const dateStr of dates) {
      const key = `${empId}_${dateStr}`;
      const idx = byKey.get(key);
      if (idx !== undefined) {
        if (assignments[idx].code !== ABSENCE_CODE) {
          assignments[idx] = {
            ...assignments[idx],
            code: ABSENCE_CODE,
            positionName: assignments[idx].positionName || '',
            hours: 0,
          };
          patchedDays++;
        }
      } else {
        assignments.push({
          employeeId: empId,
          dateStr,
          code: ABSENCE_CODE,
          positionName: '',
          hours: 0,
        });
        patchedDays++;
      }
    }
  }

  return {
    draft: { ...opts.draft, assignments },
    patchedDays,
  };
}
