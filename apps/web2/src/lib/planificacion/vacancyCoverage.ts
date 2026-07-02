/** Lógica de cobertura por licencia/vacante en planificador. */
import { toCalendarDateStr } from './absenceCodes';
import {
  buildRecompositionPendingUpdates,
  collectSplitFrancoConflicts,
  defaultSplitForBand,
  isPlannedFrancoShift,
  neighborBandsForTarget,
  resolveEmployeeShift,
  type FrancoCoverageConflict,
} from './planningRecompositionApply';
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

export const VACANCY_BAND_LABELS: Record<string, string> = {
  M: 'Mañana',
  T: 'Tarde',
  N: 'Noche',
  D12: 'Diurno 12h',
  N12: 'Nocturno 12h',
  PU: 'Puesto único',
  EN: 'Encargado',
};

export const VACANCY_BAND_SCHEDULE: Record<string, string> = {
  M: '07:00–15:00',
  T: '15:00–23:00',
  N: '23:00–07:00',
  D12: '07:00–19:00',
  N12: '19:00–07:00',
};

export type TitularVacancyWorkShift = {
  code: string;
  bandLabel: string;
  positionName: string;
  scheduleLabel: string;
  hours: number;
  source: 'saved_day' | 'adjacent_day' | 'weekday_pattern' | 'month_typical';
  sourceLabel: string;
  rawShift?: Record<string, any>;
};

function isVacancyWorkCode(code: unknown): boolean {
  const c = String(code || '').toUpperCase();
  return !!c && !VACANCY_NON_WORK_CODES.has(c);
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  cur.setDate(cur.getDate() + delta);
  return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
}

function shiftScheduleLabel(shift: Record<string, any>, code: string): string {
  if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
    return `${shift.startTime}–${shift.endTime}`;
  }
  return VACANCY_BAND_SCHEDULE[code] || '—';
}

function readWorkShift(
  empId: string,
  dateStr: string,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
): Record<string, any> | null {
  const key = `${empId}_${dateStr}`;
  for (const src of [pendingChanges[key], shiftsMap[key]]) {
    if (src && !src.isDeleted && isVacancyWorkCode(src.code)) return src;
  }
  return null;
}

/** Resuelve qué turno laboral cubre la licencia (aunque la celda ya esté en V/L/…). */
export function resolveTitularVacancyWorkShift(
  titularId: string,
  dateStr: string,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  getTypicalShift?: (empId: string) => Record<string, any> | null,
): TitularVacancyWorkShift | null {
  const toResult = (
    shift: Record<string, any>,
    source: TitularVacancyWorkShift['source'],
    sourceLabel: string,
  ): TitularVacancyWorkShift => {
    const code = String(shift.code).toUpperCase();
    return {
      code,
      bandLabel: VACANCY_BAND_LABELS[code] || code,
      positionName: String(shift.positionName || 'General'),
      scheduleLabel: shiftScheduleLabel(shift, code),
      hours: Number(shift.hours) || (code === 'D12' || code === 'N12' ? 12 : 8),
      source,
      sourceLabel,
      rawShift: shift,
    };
  };

  const direct = readWorkShift(titularId, dateStr, shiftsMap, pendingChanges);
  if (direct) {
    return toResult(direct, 'saved_day', 'Turno planificado ese día (antes de la licencia)');
  }

  for (const delta of [-1, 1, -7, 7, -2, 2]) {
    const adj = addCalendarDays(dateStr, delta);
    const s = readWorkShift(titularId, adj, shiftsMap, pendingChanges);
    if (s) {
      const [, m, d] = adj.split('-');
      return toResult(s, 'adjacent_day', `Referencia del ${d}/${m} en el cronograma`);
    }
  }

  const [y, mo, dd] = dateStr.split('-').map(Number);
  const targetDow = new Date(y, mo - 1, dd).getDay();
  const freq: Record<string, { count: number; shift: Record<string, any> }> = {};
  const daysInMo = new Date(y, mo, 0).getDate();
  for (let d = 1; d <= daysInMo; d++) {
    const ds = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (ds === dateStr) continue;
    if (new Date(y, mo - 1, d).getDay() !== targetDow) continue;
    const s = readWorkShift(titularId, ds, shiftsMap, pendingChanges);
    if (!s) continue;
    const code = String(s.code).toUpperCase();
    if (!freq[code]) freq[code] = { count: 0, shift: s };
    freq[code].count++;
  }
  const weekdayBest = Object.values(freq).sort((a, b) => b.count - a.count)[0];
  if (weekdayBest) {
    const dowNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return toResult(
      weekdayBest.shift,
      'weekday_pattern',
      `Patrón habitual los ${dowNames[targetDow]} del mes`,
    );
  }

  if (getTypicalShift) {
    const typical = getTypicalShift(titularId);
    if (typical?.code && isVacancyWorkCode(typical.code)) {
      return toResult(typical, 'month_typical', 'Turno más frecuente del mes (días sin licencia)');
    }
  }

  return null;
}

export function formatTitularVacancyShiftSummary(info: TitularVacancyWorkShift): string {
  return `${info.code} · ${info.bandLabel} · ${info.positionName} · ${info.scheduleLabel}`;
}

export function describeVacancySplitPlan(work: TitularVacancyWorkShift): {
  gapLabel: string;
  extBand: string;
  extSegment: string;
  adelBand: string;
  adelSegment: string;
} {
  const split = defaultSplitForBand(work.code);
  const neighbors = neighborBandsForTarget(work.code);
  return {
    gapLabel: `${split.gap.from}–${split.gap.to}`,
    extBand: neighbors.extensionBand,
    extSegment: `${split.ext.from}–${split.ext.to}`,
    adelBand: neighbors.earlyStartBand,
    adelSegment: `${split.adel.from}–${split.adel.to}`,
  };
}

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
  authorizeFrancoTrabajado?: boolean;
};

export function collectVacancyFrancoConflicts(
  input: Pick<ProcessVacancyInput, 'days' | 'shiftsMap' | 'employeesById'>,
  pendingChanges: Record<string, any>,
): FrancoCoverageConflict[] {
  const rows: FrancoCoverageConflict[] = [];
  for (const day of input.days) {
    const { dateStr, coverage } = day;
    if (coverage.mode === 'split') {
      rows.push(
        ...collectSplitFrancoConflicts(
          dateStr,
          coverage.extEmpId,
          coverage.adelEmpId,
          input.employeesById,
          input.shiftsMap,
          pendingChanges,
        ),
      );
    } else if (coverage.mode === 'substitute' && coverage.employeeId) {
      const shift = resolveEmployeeShift(coverage.employeeId, dateStr, input.shiftsMap, pendingChanges);
      if (isPlannedFrancoShift(shift)) {
        const emp = input.employeesById[coverage.employeeId];
        rows.push({
          employeeId: coverage.employeeId,
          employeeName: emp?.name || coverage.employeeName || coverage.employeeId,
          dateStr,
          role: 'SUBSTITUTE',
          francoCode: String(shift?.code || 'F').toUpperCase(),
        });
      }
    }
  }
  return rows;
}

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
    const workInfo = resolveTitularVacancyWorkShift(
      titularId,
      dateStr,
      input.shiftsMap,
      newChanges,
      input.getTypicalShift,
    );
    const workShift = workInfo?.rawShift ?? input.getTypicalShift(titularId);

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
      const suplBase = resolveEmployeeShift(coverage.employeeId, dateStr, input.shiftsMap, newChanges);
      const suplOnFranco = isPlannedFrancoShift(suplBase);
      if (suplOnFranco && !input.authorizeFrancoTrabajado) {
        throw new Error(`FRANCO_COVERAGE:suplente en franco ${dateStr}`);
      }
      newChanges[suplenteKey] = {
        code: workShift.code,
        name: workShift.code,
        isTemp: true,
        objectiveId: workShift.objectiveId || input.selectedObjective,
        hours: workShift.hours || 8,
        startTime: workShift.startTime || '00:00',
        positionName: workShift.positionName || input.activePosition || 'General',
        isFrancoTrabajado: suplOnFranco || undefined,
        isFranco: suplOnFranco ? false : undefined,
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
          authorizeFrancoTrabajado: input.authorizeFrancoTrabajado,
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
