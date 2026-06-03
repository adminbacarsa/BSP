/** Lógica de cobertura por licencia/vacante en planificador. */

export const VACANCY_ABSENCE_TYPE_CODES: Record<string, string> = {
  Vacaciones: 'V',
  Enfermedad: 'E',
  ART: 'A',
  'Licencia Esp.': 'L',
  'PG Permiso Gremial': 'PG',
  Injustificada: 'AA',
};

export const VACANCY_NON_WORK_CODES = new Set([
  'V', 'L', 'PG', 'A', 'E', 'AA', 'F', 'FF', 'FT', 'PAST', 'LOCKED', 'RET',
]);

export function listDateRangeInclusive(startYmd: string, endYmd: string): string[] {
  const [sy, sm, sd] = (startYmd || '').split('-').map(Number);
  const [ey, em, ed] = (endYmd || startYmd || '').split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return [];
  const out: string[] = [];
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cur <= end) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function coverageCommentForTitular(titularName: string, absenceType: string): string {
  return `Cubriendo a ${titularName} (${absenceType})`;
}

/** Quita turnos de cobertura previos del titular en las fechas indicadas. */
export function clearPreviousCoverageShifts(
  changes: Record<string, any>,
  opts: {
    titularName: string;
    dateStrs: string[];
    shiftsMap: Record<string, any>;
  },
): number {
  let cleared = 0;
  const needle = `Cubriendo a ${opts.titularName}`;
  const empIds = new Set<string>();
  Object.keys(opts.shiftsMap).forEach((k) => empIds.add(k.split('_')[0]));
  Object.keys(changes).forEach((k) => empIds.add(k.split('_')[0]));

  for (const dateStr of opts.dateStrs) {
    for (const empId of empIds) {
      const key = `${empId}_${dateStr}`;
      const pending = changes[key];
      const persisted = opts.shiftsMap[key];
      const active = pending && !pending.isDeleted ? pending : persisted;
      const comments = String(active?.comments ?? pending?.comments ?? '');
      if (!comments.includes(needle)) continue;
      if (persisted?.id) {
        changes[key] = { isDeleted: true };
      } else {
        delete changes[key];
      }
      cleared++;
    }
  }
  return cleared;
}

export type ProcessVacancyDayInput = {
  dateStr: string;
  replacementEmpId: string | null;
  replacementName: string | null;
};

export type ProcessVacancyInput = {
  vacancyData: {
    employeeId: string;
    employeeName: string;
    type: string;
    startDate?: string;
    endDate?: string;
  };
  days: ProcessVacancyDayInput[];
  selectedObjective: string;
  activePosition: string;
  shiftsMap: Record<string, any>;
  getTypicalShift: (empId: string) => any | null;
};

export function applyVacancyCoverageToChanges(
  baseChanges: Record<string, any>,
  input: ProcessVacancyInput,
): { changes: Record<string, any>; count: number; covered: number; cleared: number } {
  const newChanges = { ...baseChanges };
  const absCode = VACANCY_ABSENCE_TYPE_CODES[input.vacancyData.type] || 'AA';
  const absHours = ['E', 'L', 'PG', 'A'].includes(absCode) ? 8 : 0;
  const titularName = input.vacancyData.employeeName;
  const dateStrs = input.days.map((d) => d.dateStr);

  const cleared = clearPreviousCoverageShifts(newChanges, {
    titularName,
    dateStrs,
    shiftsMap: input.shiftsMap,
  });

  let count = 0;
  let covered = 0;

  for (const day of input.days) {
    const { dateStr, replacementEmpId, replacementName } = day;
    const titularKey = `${input.vacancyData.employeeId}_${dateStr}`;
    const existingShift = input.shiftsMap[titularKey];
    const pendingTitular = newChanges[titularKey];
    const workSource = pendingTitular && !pendingTitular.isDeleted
      ? pendingTitular
      : existingShift;
    const workShift =
      workSource?.code && !VACANCY_NON_WORK_CODES.has(String(workSource.code).toUpperCase())
        ? workSource
        : input.getTypicalShift(input.vacancyData.employeeId);

    newChanges[titularKey] = {
      code: absCode,
      name: input.vacancyData.type,
      isTemp: true,
      hours: absHours,
      startTime: '00:00',
      comments: `${input.vacancyData.type} — gestionado desde planificador`,
      coveredBy: replacementName,
    };

    if (replacementEmpId && workShift) {
      const suplenteKey = `${replacementEmpId}_${dateStr}`;
      newChanges[suplenteKey] = {
        code: workShift.code,
        name: workShift.code,
        isTemp: true,
        objectiveId: workShift.objectiveId || input.selectedObjective,
        hours: workShift.hours || 8,
        startTime: workShift.startTime || '00:00',
        positionName: workShift.positionName || input.activePosition || 'General',
        comments: coverageCommentForTitular(titularName, input.vacancyData.type),
      };
      covered++;
    }
    count++;
  }

  return { changes: newChanges, count, covered, cleared };
}
