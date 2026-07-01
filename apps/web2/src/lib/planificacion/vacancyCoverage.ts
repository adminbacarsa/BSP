/** Lógica de cobertura por licencia/vacante en planificador. */
import { toCalendarDateStr } from './absenceCodes';
import { buildRecompositionPendingUpdates } from './planningRecompositionApply';
import type { RecompositionPackage, RecompositionTarget } from './planningRecomposition.types';

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

export type VacancyDayCoverage =
  | { mode: 'none' }
  | { mode: 'substitute'; employeeId: string }
  | {
      mode: 'split';
      extEmpId: string;
      adelEmpId: string;
      gapBand: string;
      gapPosition: string;
    };

export type VacancyDayCoverageInput =
  | { mode: 'none' }
  | { mode: 'substitute'; employeeId: string; employeeName: string | null }
  | {
      mode: 'split';
      extEmpId: string;
      adelEmpId: string;
      gapBand: string;
      gapPosition: string;
      extHomePosition?: string;
      extBaseCode?: string;
      adelBaseCode?: string;
    };

export function listDateRangeInclusive(startYmd: unknown, endYmd?: unknown): string[] {
  const s = toCalendarDateStr(startYmd) || '';
  const e = toCalendarDateStr(endYmd ?? startYmd) || s;
  const [sy, sm, sd] = (s || '').split('-').map(Number);
  const [ey, em, ed] = (e || s || '').split('-').map(Number);
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

function stripCoverageMeta(shift: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!shift) return null;
  const {
    coveragePackageId: _a,
    coverageType: _b,
    coverageSegmentRole: _c,
    coversEmployeeId: _d,
    coversPositionName: _e,
    coverageNote: _f,
    coveredBy: _g,
    coverageStatus: _h,
    coverageMode: _i,
    isExtended: _j,
    isEarlyStart: _k,
    adjustedStartTime: _l,
    adjustedEndTime: _m,
    segmentFromTime: _n,
    segmentToTime: _o,
    ...rest
  } = shift;
  return { ...rest, isExtended: false, isEarlyStart: false };
}

/** Resuelve cobertura efectiva de un día (override por día o suplente por defecto). */
export function resolveVacancyDayCoverage(
  dateStr: string,
  dayCoverages: Record<string, VacancyDayCoverage>,
  defaultSubstituteId: string,
): VacancyDayCoverage {
  const override = dayCoverages[dateStr];
  if (override) return override;
  if (defaultSubstituteId) return { mode: 'substitute', employeeId: defaultSubstituteId };
  return { mode: 'none' };
}

export function formatVacancyDayCoverageLabel(
  coverage: VacancyDayCoverage,
  employeesById: Record<string, { name?: string } | undefined>,
): string {
  if (coverage.mode === 'none') return 'Sin cobertura';
  if (coverage.mode === 'substitute') {
    const name = employeesById[coverage.employeeId]?.name || '—';
    return `${name} (suplente)`;
  }
  const extName = (employeesById[coverage.extEmpId]?.name || '—').split(',')[0];
  const adelName = (employeesById[coverage.adelEmpId]?.name || '—').split(',')[0];
  return `${extName} ext + ${adelName} adel`;
}

export function vacancyDayHasCoverage(coverage: VacancyDayCoverage): boolean {
  if (coverage.mode === 'substitute') return !!coverage.employeeId;
  if (coverage.mode === 'split') return !!coverage.extEmpId && !!coverage.adelEmpId;
  return false;
}

/** Quita coberturas previas (suplente o split) del titular en las fechas indicadas. */
export function clearPreviousVacancyCoverage(
  changes: Record<string, any>,
  opts: {
    titularEmployeeId: string;
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
      if (empId === opts.titularEmployeeId) continue;
      const key = `${empId}_${dateStr}`;
      const pending = changes[key];
      const persisted = opts.shiftsMap[key];
      const active = pending && !pending.isDeleted ? pending : persisted;
      if (!active) continue;

      const coversTitular = active.coversEmployeeId === opts.titularEmployeeId;
      const isSubstitute = String(active.comments ?? '').includes(needle);
      if (!coversTitular && !isSubstitute) continue;

      if (persisted?.id) {
        if (isSubstitute && !coversTitular) {
          changes[key] = { isDeleted: true };
        } else {
          const restored = stripCoverageMeta(persisted);
          if (restored) changes[key] = { ...restored, isTemp: true };
        }
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
  coverage: VacancyDayCoverageInput;
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
  employeesById: Record<string, any>;
  clientId?: string;
  defaultSplitForBand: (band: string) => {
    ext: { from: string; to: string };
    adel: { from: string; to: string };
  };
};

function buildVacancySplitPackage(
  input: ProcessVacancyInput,
  dateStr: string,
  coverage: Extract<VacancyDayCoverageInput, { mode: 'split' }>,
  target: RecompositionTarget,
  splitTimes: { ext: { from: string; to: string }; adel: { from: string; to: string } },
): RecompositionPackage {
  const gapPos = coverage.gapPosition || target.positionName;
  return {
    id: `vac_cov_${input.vacancyData.employeeId}_${dateStr}_${Date.now()}`,
    type: 'ABSENCE_COVERAGE',
    mode: 'absence',
    objectiveId: input.selectedObjective,
    dateStr,
    target,
    gapFrom: splitTimes.ext.from,
    gapTo: splitTimes.adel.to,
    gapPositionName: gapPos,
    extension: {
      employeeId: coverage.extEmpId,
      role: 'EXTENSION',
      positionName: gapPos,
      fromTime: splitTimes.ext.from,
      toTime: splitTimes.ext.to,
      homePositionName: coverage.extHomePosition,
      baseCode: coverage.extBaseCode,
    },
    earlyStart: {
      employeeId: coverage.adelEmpId,
      role: 'EARLY_START',
      positionName: gapPos,
      fromTime: splitTimes.adel.from,
      toTime: splitTimes.adel.to,
      baseCode: coverage.adelBaseCode,
    },
  };
}

export function applyVacancyCoverageToChanges(
  baseChanges: Record<string, any>,
  input: ProcessVacancyInput,
): { changes: Record<string, any>; count: number; covered: number; splitCovered: number; cleared: number } {
  const newChanges = { ...baseChanges };
  const absCode = VACANCY_ABSENCE_TYPE_CODES[input.vacancyData.type] || 'AA';
  const absHours = ['E', 'L', 'PG', 'A'].includes(absCode) ? 8 : 0;
  const titularName = input.vacancyData.employeeName;
  const titularId = input.vacancyData.employeeId;
  const dateStrs = input.days.map((d) => d.dateStr);

  const cleared = clearPreviousVacancyCoverage(newChanges, {
    titularEmployeeId: titularId,
    titularName,
    dateStrs,
    shiftsMap: input.shiftsMap,
  });

  let count = 0;
  let covered = 0;
  let splitCovered = 0;

  for (const day of input.days) {
    const { dateStr, coverage } = day;
    const titularKey = `${titularId}_${dateStr}`;
    const existingShift = input.shiftsMap[titularKey];
    const pendingTitular = newChanges[titularKey];
    const workSource = pendingTitular && !pendingTitular.isDeleted
      ? pendingTitular
      : existingShift;
    const workShift =
      workSource?.code && !VACANCY_NON_WORK_CODES.has(String(workSource.code).toUpperCase())
        ? workSource
        : input.getTypicalShift(titularId);

    const coveredByLabel =
      coverage.mode === 'substitute' && coverage.employeeName
        ? coverage.employeeName
        : coverage.mode === 'split'
          ? formatVacancyDayCoverageLabel(
              {
                mode: 'split',
                extEmpId: coverage.extEmpId,
                adelEmpId: coverage.adelEmpId,
                gapBand: coverage.gapBand,
                gapPosition: coverage.gapPosition,
              },
              input.employeesById,
            )
          : undefined;

    newChanges[titularKey] = {
      code: absCode,
      name: input.vacancyData.type,
      isTemp: true,
      hours: absHours,
      startTime: '00:00',
      comments: `${input.vacancyData.type} — gestionado desde planificador`,
      coveredBy: coveredByLabel || undefined,
    };

    if (coverage.mode === 'substitute' && coverage.employeeId && workShift) {
      const suplenteKey = `${coverage.employeeId}_${dateStr}`;
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
    } else if (coverage.mode === 'split' && coverage.extEmpId && coverage.adelEmpId && workShift) {
      const gapBand = coverage.gapBand || String(workShift.code || 'M').toUpperCase();
      const target: RecompositionTarget = {
        employeeId: titularId,
        dateStr,
        positionName: coverage.gapPosition || workShift.positionName || input.activePosition || 'General',
        code: gapBand,
        label: `${titularName} · ${coverage.gapPosition || workShift.positionName} · ${gapBand}`,
        kind: 'absence',
      };
      const splitTimes = input.defaultSplitForBand(gapBand);
      const pkg = buildVacancySplitPackage(input, dateStr, coverage, target, splitTimes);
      try {
        const updates = buildRecompositionPendingUpdates(pkg, {
          shiftsMap: input.shiftsMap,
          pendingChanges: newChanges,
          employeesById: input.employeesById,
          objectiveId: input.selectedObjective,
          clientId: input.clientId,
        });
        Object.assign(newChanges, updates);
        splitCovered++;
      } catch {
        // Si falla split (ej. ext/adel sin turno), titular queda en V sin cobertura split
      }
    }
    count++;
  }

  return { changes: newChanges, count, covered, splitCovered, cleared };
}
