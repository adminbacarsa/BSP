/** Lógica de cobertura por licencia/vacante en planificador. */
import { toCalendarDateStr } from './absenceCodes';
import {
  defaultSplitTimesCct,
  defaultSplitTimesForVacancyGap,
  neighborBandsForVacancyGap,
  alignVacancyGapBand,
  type VacancyPositionSla,
} from './vacancySplitBands';
import {
  resolveVacancyDualExtensionPlan,
  type VacancyDualExtensionPlan,
} from './vacancyDualExtension';
import {
  buildRecompositionPendingUpdates,
  collectSplitFrancoConflicts,
  isPlannedFrancoShift,
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
  source: 'saved_day' | 'adjacent_day' | 'weekday_pattern' | 'month_typical' | 'history_inferred' | 'user_selected';
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

function shiftScheduleLabel(
  shift: Record<string, any>,
  code: string,
  slaBlocks?: Array<{ startTime: string; endTime: string }> | null,
): string {
  const blocks = slaBlocks ?? shift.blocks;
  if (Array.isArray(blocks) && blocks.length >= 2) {
    return blocks.map((b) => `${b.startTime}–${b.endTime}`).join(' + ');
  }
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
    if (!src || src.isDeleted) continue;
    if (isVacancyWorkCode(src.code)) return src;
    // Código original preservado cuando se aplicó ausencia sobre un turno planificado
    const orig = String(src.originalCode || '').toUpperCase();
    if (orig && isVacancyWorkCode(orig)) return { ...src, code: orig };
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
  getSlaBlocks?: (positionName: string, code: string) => Array<{ startTime: string; endTime: string }> | null,
  options?: { absenceBlockStart?: string },
): TitularVacancyWorkShift | null {
  const toResult = (
    shift: Record<string, any>,
    source: TitularVacancyWorkShift['source'],
    sourceLabel: string,
  ): TitularVacancyWorkShift => {
    const code = String(shift.code).toUpperCase();
    const positionName = String(shift.positionName || 'General');
    const slaBlocks = getSlaBlocks?.(positionName, code) ?? null;
    return {
      code,
      bandLabel: VACANCY_BAND_LABELS[code] || code,
      positionName,
      scheduleLabel: shiftScheduleLabel(shift, code, slaBlocks),
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

  const anchor = options?.absenceBlockStart || dateStr;
  for (let delta = -1; delta >= -31; delta--) {
    const adj = addCalendarDays(anchor, delta);
    const s = readWorkShift(titularId, adj, shiftsMap, pendingChanges);
    if (s) {
      const [, m, d] = adj.split('-');
      return toResult(
        s,
        'adjacent_day',
        `Último turno laboral antes del bloque (${d}/${m})`,
      );
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

  for (const delta of [1, 7, -7, 2]) {
    const adj = addCalendarDays(dateStr, delta);
    const s = readWorkShift(titularId, adj, shiftsMap, pendingChanges);
    if (s) {
      const [, m, d] = adj.split('-');
      return toResult(s, 'adjacent_day', `Referencia del ${d}/${m} en el cronograma`);
    }
  }

  return null;
}

export function formatTitularVacancyShiftSummary(info: TitularVacancyWorkShift): string {
  return `${info.code} · ${info.bandLabel} · ${info.positionName} · ${info.scheduleLabel}`;
}

export function describeVacancySplitPlan(
  work: TitularVacancyWorkShift,
  positionStructure?: VacancyPositionSla[],
): {
  gapLabel: string;
  extBand: string;
  extSegment: string;
  adelBand: string;
  adelSegment: string;
  effectiveGapBand: string;
} {
  const effectiveGapBand = alignVacancyGapBand(
    work.code,
    work.positionName,
    positionStructure,
    work.rawShift,
  );
  const split = defaultSplitTimesForVacancyGap(positionStructure, work.positionName, effectiveGapBand);
  const neighbors = neighborBandsForVacancyGap(positionStructure, work.positionName, effectiveGapBand);
  return {
    gapLabel: `${split.gap.from}–${split.gap.to}`,
    extBand: neighbors.extensionBand,
    extSegment: `${split.ext.from}–${split.ext.to}`,
    adelBand: neighbors.earlyStartBand,
    adelSegment: `${split.adel.from}–${split.adel.to}`,
    effectiveGapBand,
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
      /** Horas extra sobre fin SLA del 1.er guardia; ambos definidos = manual (+N h). */
      extExtraHours?: number | null;
      secondExtExtraHours?: number | null;
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
      extExtraHours?: number | null;
      secondExtExtraHours?: number | null;
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

export function vacancySplitUsesManualExtraHours(coverage: {
  extExtraHours?: number | null;
  secondExtExtraHours?: number | null;
}): boolean {
  return coverage.extExtraHours != null
    && coverage.secondExtExtraHours != null
    && Number.isFinite(coverage.extExtraHours)
    && Number.isFinite(coverage.secondExtExtraHours);
}

export function resolveVacancySplitSegmentTimes(
  positionStructure: VacancyPositionSla[] | undefined,
  gapBand: string,
  gapPosition: string,
  extWorker: { positionName?: string; code?: string } | null,
  secondWorker: { positionName?: string; code?: string } | null,
  extExtraHours?: number | null,
  secondExtExtraHours?: number | null,
): VacancyDualExtensionPlan {
  const manual = vacancySplitUsesManualExtraHours({ extExtraHours, secondExtExtraHours });
  return resolveVacancyDualExtensionPlan(
    positionStructure,
    gapPosition,
    gapBand,
    extWorker,
    secondWorker,
    manual ? extExtraHours! : null,
    manual ? secondExtExtraHours! : null,
  );
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
  if (vacancySplitUsesManualExtraHours(coverage)) {
    return `${extName} ext +${coverage.extExtraHours}h · ${adelName} ext +${coverage.secondExtExtraHours}h`;
  }
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
  defaultSplitForBand: (band: string, gapPosition?: string | null) => {
    ext: { from: string; to: string };
    adel: { from: string; to: string };
  };
  positionStructure?: VacancyPositionSla[];
  authorizeFrancoTrabajado?: boolean;
  /** Banda SLA a cubrir cuando el titular no tiene turno asignado (override manual del modal). */
  fallbackGapBand?: string;
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
  splitTimes: {
    ext: { from: string; to: string };
    adel: { from: string; to: string };
    extExtraHours?: number;
    adelExtraHours?: number;
  },
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
      extraHours: splitTimes.extExtraHours,
    },
    earlyStart: {
      employeeId: coverage.adelEmpId,
      role: 'EARLY_START',
      positionName: gapPos,
      fromTime: splitTimes.adel.from,
      toTime: splitTimes.adel.to,
      baseCode: coverage.adelBaseCode,
      extraHours: splitTimes.adelExtraHours,
    },
  };
}

/**
 * Cuando el titular no tiene turno asignado, construye un shift sintético usando
 * el fallbackGapBand del modal o el primer turno disponible en positionStructure.
 */
function deriveFallbackWorkShift(
  input: ProcessVacancyInput,
): { code: string; hours: number; startTime: string; positionName: string; objectiveId?: string } | null {
  const code = input.fallbackGapBand?.toUpperCase();
  const activePos = String(input.activePosition || '').trim();
  const pos = input.positionStructure?.find(p => String(p.positionName || '') === activePos)
    ?? input.positionStructure?.[0];

  if (code) {
    const shift = pos?.shifts?.find(s => String(s.code || '').toUpperCase() === code);
    return {
      code,
      hours: Number(shift?.hours) || 8,
      startTime: shift?.startTime || '00:00',
      positionName: String(pos?.positionName || activePos || 'General'),
      objectiveId: input.selectedObjective,
    };
  }
  // Fallback: primer turno laboral de la posición activa
  const firstShift = pos?.shifts?.find(s => {
    const c = String(s.code || '').toUpperCase();
    return c && !VACANCY_NON_WORK_CODES.has(c);
  });
  if (!firstShift) return null;
  return {
    code: String(firstShift.code || '').toUpperCase(),
    hours: Number(firstShift.hours) || 8,
    startTime: firstShift.startTime || '00:00',
    positionName: String(pos?.positionName || activePos || 'General'),
    objectiveId: input.selectedObjective,
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
      undefined,
      { absenceBlockStart: input.vacancyData.startDate },
    );
    // workInfo ya filtró códigos no-laborales; no usar getTypicalShift como fallback porque
    // puede devolver F/E del titular (RRHH) y bloquear deriveFallbackWorkShift
    const workShift = workInfo?.rawShift ?? null;
    // Cuando el titular no tiene turno, usar la banda elegida en el modal como fallback
    const effectiveWorkShift = workShift ?? deriveFallbackWorkShift(input);

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
                extExtraHours: coverage.extExtraHours,
                secondExtExtraHours: coverage.secondExtExtraHours,
              },
              input.employeesById,
            )
          : undefined;

    // Preservar el código del turno planificado para que el modal de cobertura
    // pueda recuperarlo si se reabre (savedDayCode solo cuando había turno ese día, no historial).
    const savedDayCode = workInfo?.source === 'saved_day' ? workInfo.code : undefined;
    newChanges[titularKey] = {
      code: absCode,
      name: input.vacancyData.type,
      isTemp: true,
      hours: absHours,
      startTime: '00:00',
      comments: `${input.vacancyData.type} — gestionado desde planificador`,
      coveredBy: coveredByLabel || undefined,
      ...(savedDayCode ? { originalCode: savedDayCode } : {}),
    };

    if (coverage.mode === 'substitute' && coverage.employeeId && effectiveWorkShift) {
      const suplenteKey = `${coverage.employeeId}_${dateStr}`;
      const suplBase = resolveEmployeeShift(coverage.employeeId, dateStr, input.shiftsMap, newChanges);
      const suplOnFranco = isPlannedFrancoShift(suplBase);
      if (suplOnFranco && !input.authorizeFrancoTrabajado) {
        throw new Error(`FRANCO_COVERAGE:suplente en franco ${dateStr}`);
      }
      newChanges[suplenteKey] = {
        code: effectiveWorkShift.code,
        name: effectiveWorkShift.code,
        isTemp: true,
        objectiveId: effectiveWorkShift.objectiveId || input.selectedObjective,
        hours: effectiveWorkShift.hours || 8,
        startTime: effectiveWorkShift.startTime || '00:00',
        positionName: effectiveWorkShift.positionName || input.activePosition || 'General',
        isFrancoTrabajado: suplOnFranco || undefined,
        isFranco: suplOnFranco ? false : undefined,
        comments: coverageCommentForTitular(titularName, input.vacancyData.type),
      };
      covered++;
    } else if (coverage.mode === 'split' && coverage.extEmpId && coverage.adelEmpId && effectiveWorkShift) {
      const gapBand = coverage.gapBand
        || alignVacancyGapBand(
          String(effectiveWorkShift.code || workInfo?.code || 'M'),
          coverage.gapPosition || effectiveWorkShift.positionName,
          input.positionStructure,
          effectiveWorkShift as any,
        );
      const gapPositionName = coverage.gapPosition || effectiveWorkShift.positionName || input.activePosition || 'General';
      const target: RecompositionTarget = {
        employeeId: titularId,
        dateStr,
        positionName: gapPositionName,
        code: gapBand,
        label: `${titularName} · ${gapPositionName} · ${gapBand}`,
        kind: 'absence',
      };
      const extShift = resolveEmployeeShift(coverage.extEmpId, dateStr, input.shiftsMap, newChanges);
      const adelShift = resolveEmployeeShift(coverage.adelEmpId, dateStr, input.shiftsMap, newChanges);
      const dualPlan = resolveVacancySplitSegmentTimes(
        input.positionStructure,
        gapBand,
        gapPositionName,
        {
          positionName: extShift?.positionName || coverage.extHomePosition,
          code: extShift?.code || coverage.extBaseCode,
        },
        {
          positionName: adelShift?.positionName,
          code: adelShift?.code || coverage.adelBaseCode,
        },
        coverage.extExtraHours,
        coverage.secondExtExtraHours,
      );
      const splitTimes = {
        ext: dualPlan.first,
        adel: dualPlan.second,
        extExtraHours: dualPlan.firstExtraHours,
        adelExtraHours: dualPlan.secondExtraHours,
      };
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
