import { isReliefEligibleShift } from '@cosp/ops-core';
import type { RecompositionPackage, RecompositionPendingMeta } from './planningRecomposition.types';
import {
  defaultSplitTimesCct,
  defaultSplitTimesForVacancyGap,
  isVacancySegmentWorkCode,
  neighborBandsCct,
  neighborBandsForVacancyGap,
  shiftTimeWindowFromSla,
  vacancySecondSegmentIsTailExtension,
  type VacancySplitListContext,
  type VacancyPositionSla,
} from './vacancySplitBands';

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'D12', 'REF', 'ESC', 'FT']);
const PLANNED_FRANCO_CODES = new Set(['F', 'FF', 'FP']);

export type FrancoCoverageConflict = {
  employeeId: string;
  employeeName: string;
  dateStr: string;
  role: 'EXTENSION' | 'EARLY_START' | 'SUBSTITUTE';
  francoCode: string;
};

function shiftKey(empId: string, dateStr: string) {
  return `${empId}_${dateStr}`;
}

export function previousCalendarDayStr(dateStr: string): string {
  return shiftCalendarDayStr(dateStr, -1);
}

export function nextCalendarDayStr(dateStr: string): string {
  return shiftCalendarDayStr(dateStr, 1);
}

function shiftCalendarDayStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + delta);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export type SegmentCandidateRow = {
  id: string;
  name: string;
  code: string;
  positionName: string;
  /** Si la extensión se aplica en otra celda (ej. N del día anterior). */
  extensionApplyDate?: string;
  /** Si el adelanto se aplica en otra celda (ej. M del día siguiente, hueco N). */
  earlyStartApplyDate?: string;
  /** «11:30–15:15». */
  scheduleLabel?: string;
  /** Fin (ext) o inicio (adel) menos el borde del hueco, en minutos. Negativo = antes. */
  deltaMin?: number;
  /** «FERRERO · M 11:30–15:15 · termina 15 min antes». */
  textoFila?: string;
};

function empDisplayName(emp: { name?: string; apellido?: string; nombre?: string; firstName?: string; lastName?: string } | undefined, id: string) {
  if (!emp) return id;
  return (
    emp.name
    || [emp.apellido || emp.lastName, emp.nombre || emp.firstName].filter(Boolean).join(', ')
    || id
  );
}

function mergeShift(base: any, patch: Record<string, unknown>) {
  return { ...(base || {}), ...patch, isTemp: true };
}

/** Franco planificado (F/FF/FP) — no FT ni turno laboral. */
export function isPlannedFrancoShift(shift: Record<string, any> | null | undefined): boolean {
  if (!shift || shift.isDeleted) return false;
  if (shift.isFrancoTrabajado) return false;
  const code = String(shift.code || '').toUpperCase();
  if (PLANNED_FRANCO_CODES.has(code)) return true;
  return !!shift.isFranco && !WORK_CODES.has(code);
}

export function resolveEmployeeShift(
  empId: string,
  dateStr: string,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
): Record<string, any> | null {
  const k = shiftKey(empId, dateStr);
  const pending = pendingChanges[k];
  if (pending) return pending.isDeleted ? null : pending;
  return shiftsMap[k] || null;
}

export function collectSplitFrancoConflicts(
  dateStr: string,
  extEmpId: string,
  adelEmpId: string,
  employeesById: Record<string, { name?: string } | undefined>,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
): FrancoCoverageConflict[] {
  const rows: FrancoCoverageConflict[] = [];
  if (extEmpId) {
    const extShift = resolveEmployeeShift(extEmpId, dateStr, shiftsMap, pendingChanges);
    if (isPlannedFrancoShift(extShift)) {
      rows.push({
        employeeId: extEmpId,
        employeeName: empDisplayName(employeesById[extEmpId], extEmpId),
        dateStr,
        role: 'EXTENSION',
        francoCode: String(extShift?.code || 'F').toUpperCase(),
      });
    }
  }
  if (adelEmpId) {
    const adelShift = resolveEmployeeShift(adelEmpId, dateStr, shiftsMap, pendingChanges);
    if (isPlannedFrancoShift(adelShift)) {
      rows.push({
        employeeId: adelEmpId,
        employeeName: empDisplayName(employeesById[adelEmpId], adelEmpId),
        dateStr,
        role: 'EARLY_START',
        francoCode: String(adelShift?.code || 'F').toUpperCase(),
      });
    }
  }
  return rows;
}

export function formatFrancoConflictSummary(conflicts: FrancoCoverageConflict[]): string {
  return conflicts
    .map((c) => {
      const role = c.role === 'EXTENSION' ? 'ext' : c.role === 'EARLY_START' ? 'adel' : 'suplente';
      const [, m, d] = c.dateStr.split('-');
      return `${c.employeeName.split(',')[0]} (${role}) · ${d}/${m} · ${c.francoCode}`;
    })
    .join('; ');
}

/** Construye actualizaciones de pendingChanges para un paquete ext+adel. */
export function buildRecompositionPendingUpdates(
  pkg: RecompositionPackage,
  ctx: {
    shiftsMap: Record<string, any>;
    pendingChanges: Record<string, any>;
    employeesById: Record<string, any>;
    objectiveId: string;
    clientId?: string;
    authorizeFrancoTrabajado?: boolean;
  },
): Record<string, any> {
  const updates: Record<string, any> = {};
  const { shiftsMap, pendingChanges, employeesById, objectiveId } = ctx;

  const getShift = (empId: string, dateStr: string) => {
    const k = shiftKey(empId, dateStr);
    const p = pendingChanges[k];
    if (p) return p.isDeleted ? null : p;
    return shiftsMap[k] || null;
  };

  const hasExtension = !!(pkg.extension?.employeeId);
  const isEarlyDeparture = pkg.mode === 'early_departure';
  const extEmp = hasExtension ? employeesById[pkg.extension!.employeeId] : undefined;
  const adelEmp = employeesById[pkg.earlyStart.employeeId];
  const targetEmp = pkg.target.employeeId ? employeesById[pkg.target.employeeId] : undefined;
  const extName = hasExtension ? empDisplayName(extEmp, pkg.extension!.employeeId) : '';
  const adelName = empDisplayName(adelEmp, pkg.earlyStart.employeeId);
  const targetName = targetEmp ? empDisplayName(targetEmp, pkg.target.employeeId) : pkg.target.label;
  const isOperationalGap = pkg.mode === 'operational_gap';

  const coveredByLabel = isEarlyDeparture
    ? `${adelName.split(',')[0]} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}`
    : isOperationalGap
      ? `${extName.split(',')[0]} ext ${pkg.extension!.fromTime}-${pkg.extension!.toTime} + ${adelName.split(',')[0]} cierre ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}`
      : `${extName.split(',')[0]} ext ${pkg.extension!.fromTime}-${pkg.extension!.toTime} + ${adelName.split(',')[0]} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}`;

  const baseMeta = (role: RecompositionPendingMeta['coverageSegmentRole'], extra: Partial<RecompositionPendingMeta> = {}): RecompositionPendingMeta => ({
    coveragePackageId: pkg.id,
    coverageType: pkg.type,
    coverageSegmentRole: role,
    coversEmployeeId: isOperationalGap ? undefined : pkg.target.employeeId,
    coversPositionName: pkg.gapPositionName,
    coversBandCode: String(pkg.target.code || '').toUpperCase() || undefined,
    coverageMode: isEarlyDeparture ? 'EARLY_DEPARTURE' : 'SPLIT',
    coverageStatus: 'COVERED',
    ...extra,
  });

  // ── Titular / ausente / vacante (target) — omitido en hueco SLA sin persona ──
  if (!isOperationalGap && pkg.target.employeeId) {
  const targetKey = shiftKey(pkg.target.employeeId, pkg.dateStr);
  const targetBase = getShift(pkg.target.employeeId, pkg.dateStr) || {
    code: pkg.target.code,
    employeeId: pkg.target.employeeId,
    objectiveId,
    positionName: pkg.target.positionName,
  };

  if (pkg.mode === 'liberation') {
    updates[targetKey] = mergeShift(targetBase, {
      code: 'RET',
      name: 'Retén (stand-by)',
      hours: 0,
      startTime: '00:00',
      endTime: '23:59',
      isFranco: false,
      isExtended: false,
      isEarlyStart: false,
      positionName: pkg.target.positionName,
      objectiveId,
      ...baseMeta('LIBERATED', {
        liberationReason: pkg.liberationReason || 'EVENTO',
        redeployNote: pkg.redeployNote || '',
        coverageNote: `Liberado → RET · backfill: ${coveredByLabel}`,
        coveredBy: coveredByLabel,
        coverageStatus: 'COVERED',
      }),
      comments: `Liberación planificada · ${pkg.redeployNote || 'Convocable otro objetivo'}`,
    });
  } else if (pkg.mode === 'early_departure') {
    const cut = pkg.earlyDepartureCutTime || pkg.gapFrom || pkg.earlyStart.fromTime;
    const originalEnd = String(targetBase.endTime || pkg.gapTo || '').slice(0, 5) || pkg.gapTo;
    const originalStart = pkg.earlyDepartureStartTime
      || String(targetBase.startTime || pkg.gapFrom || '07:00').slice(0, 5);
    const workedHours = Math.max(0.5, hoursBetweenTimes(originalStart, cut));
    updates[targetKey] = mergeShift(targetBase, {
      code: pkg.target.code,
      name: targetBase.name || pkg.target.code,
      hours: workedHours,
      startTime: originalStart,
      endTime: cut,
      originalEndTime: originalEnd,
      isRetiroAnticipado: true,
      isFranco: false,
      isExtended: false,
      isEarlyStart: false,
      positionName: pkg.target.positionName,
      objectiveId,
      ...baseMeta('TARGET', {
        isRetiroAnticipado: true,
        adjustedEndTime: cut,
        segmentFromTime: originalStart,
        segmentToTime: cut,
        coveredBy: coveredByLabel,
        coverageNote: `Retiro anticipado · corte ${cut} · cubre ${coveredByLabel}`,
        coverageStatus: 'COVERED',
      }),
      comments: `Retiro anticipado · trabajó ${originalStart}–${cut} · cubierto por ${coveredByLabel}`,
    });
  } else if (pkg.mode === 'anticipated_absence' && pkg.anticipatedAbsence) {
    updates[targetKey] = mergeShift(targetBase, {
      code: pkg.anticipatedAbsence.code,
      name: pkg.anticipatedAbsence.type,
      isNovedad: true,
      hours: 0,
      startTime: '00:00',
      isFranco: false,
      isExtended: false,
      isEarlyStart: false,
      positionName: pkg.target.positionName,
      objectiveId,
      ...baseMeta('TARGET', {
        coveredBy: coveredByLabel,
        coverageNote: `Ausencia anticipada (${pkg.anticipatedAbsence.type}) · ${coveredByLabel}`,
        coverageStatus: 'COVERED',
      }),
      comments: pkg.anticipatedAbsence.reason
        ? `Ausencia anticipada: ${pkg.anticipatedAbsence.reason}`
        : `Ausencia anticipada · ${pkg.anticipatedAbsence.type}`,
    });
  } else {
    updates[targetKey] = mergeShift(targetBase, {
      ...baseMeta('TARGET', {
        coveredBy: coveredByLabel,
        coverageNote: `Cubierto split · ${coveredByLabel}`,
        coverageStatus: 'COVERED',
      }),
    });
  }
  }

  // ── Extensión (G1) — omitida en retiro anticipado ──
  if (hasExtension && pkg.extension) {
  const extDateStr = pkg.extension.applyDateStr || pkg.dateStr;
  const extKey = shiftKey(pkg.extension.employeeId, extDateStr);
  const extBase = getShift(pkg.extension.employeeId, extDateStr);
  if (!extBase || extBase.isDeleted) {
    throw new Error(`El guardia de extensión no tiene turno el ${extDateStr.split('-').reverse().slice(0, 2).join('/')}`);
  }
  const extOnFranco = isPlannedFrancoShift(extBase);
  if (extOnFranco && !ctx.authorizeFrancoTrabajado) {
    throw new Error(`FRANCO_COVERAGE:${extName} tiene franco planificado (${extBase.code}) el ${extDateStr} — requiere PIN de supervisor (FT / costo extra).`);
  }
  updates[extKey] = mergeShift(extBase, {
    isFrancoTrabajado: extOnFranco ? true : (extBase.isFrancoTrabajado || false),
    isFranco: extOnFranco ? false : extBase.isFranco,
    code: extOnFranco ? (pkg.extension.baseCode || extBase.code) : extBase.code,
    isExtended: true,
    isEarlyStart: false,
    ...(pkg.extension.extraHours != null && pkg.extension.extraHours > 0
      ? { extExtraHours: pkg.extension.extraHours }
      : {}),
    ...baseMeta('EXTENSION', {
      adjustedEndTime: pkg.extension.toTime,
      segmentFromTime: pkg.extension.fromTime,
      segmentToTime: pkg.extension.toTime,
      coverageNote: `${extOnFranco ? 'FT ' : ''}Ext ${pkg.gapPositionName} ${pkg.extension.fromTime}-${pkg.extension.toTime} · ${isOperationalGap ? `cierra ${pkg.target.code}` : `${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`}`,
    }),
  });
  }

  // ── Adelanto (G2) ──
  const adelDateStr = pkg.earlyStart.applyDateStr || pkg.dateStr;
  const adelKey = shiftKey(pkg.earlyStart.employeeId, adelDateStr);
  const adelBase = getShift(pkg.earlyStart.employeeId, adelDateStr);
  if (!adelBase || adelBase.isDeleted) {
    throw new Error(`El guardia de adelanto no tiene turno el ${adelDateStr.split('-').reverse().slice(0, 2).join('/')}`);
  }
  const adelOnFranco = isPlannedFrancoShift(adelBase);
  if (adelOnFranco && !ctx.authorizeFrancoTrabajado) {
    throw new Error(`FRANCO_COVERAGE:${adelName} tiene franco planificado (${adelBase.code}) el ${adelDateStr} — requiere PIN de supervisor (FT / costo extra).`);
  }
  const tailExtension = !isOperationalGap && !isEarlyDeparture && vacancySecondSegmentIsTailExtension(String(pkg.target.code || ''));
  const adelExtraHoursField = pkg.earlyStart.extraHours != null && pkg.earlyStart.extraHours > 0
    ? { extExtraHours: pkg.earlyStart.extraHours }
    : {};
  if (tailExtension) {
    updates[adelKey] = mergeShift(adelBase, {
      isFrancoTrabajado: adelOnFranco ? true : (adelBase.isFrancoTrabajado || false),
      isFranco: adelOnFranco ? false : adelBase.isFranco,
      code: adelOnFranco ? (pkg.earlyStart.baseCode || adelBase.code) : adelBase.code,
      isExtended: true,
      isEarlyStart: false,
      ...adelExtraHoursField,
      ...baseMeta('EXTENSION', {
        adjustedEndTime: pkg.earlyStart.toTime,
        segmentFromTime: pkg.earlyStart.fromTime,
        segmentToTime: pkg.earlyStart.toTime,
        coverageNote: `${adelOnFranco ? 'FT ' : ''}Ext cierre ${pkg.gapPositionName} ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime} · ${isOperationalGap ? `cierra ${pkg.target.code}` : `${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`}`,
      }),
    });
  } else {
  updates[adelKey] = mergeShift(adelBase, {
    isFrancoTrabajado: adelOnFranco ? true : (adelBase.isFrancoTrabajado || false),
    isFranco: adelOnFranco ? false : adelBase.isFranco,
    code: adelOnFranco ? (pkg.earlyStart.baseCode || adelBase.code) : adelBase.code,
    isEarlyStart: true,
    isExtended: false,
    adjustedStartTime: pkg.earlyStart.fromTime,
    ...adelExtraHoursField,
    ...baseMeta('EARLY_START', {
      segmentFromTime: pkg.earlyStart.fromTime,
      segmentToTime: pkg.earlyStart.toTime,
      coverageNote: `${adelOnFranco ? 'FT ' : ''}Adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime} · ${pkg.gapPositionName} · ${isEarlyDeparture ? 'retiro anticipado' : pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
    }),
  });
  }

  return updates;
}

/** Diferencia en horas entre HH:mm (soporta cruce de medianoche). */
export function hoursBetweenTimes(from: string, to: string): number {
  const [fh, fm] = String(from || '00:00').split(':').map(Number);
  const [th, tm] = String(to || '00:00').split(':').map(Number);
  let a = (fh || 0) * 60 + (fm || 0);
  let b = (th || 0) * 60 + (tm || 0);
  if (b <= a) b += 24 * 60;
  return Math.round(((b - a) / 60) * 100) / 100;
}

/** Suma horas a HH:mm (módulo 24h, formato HH:mm). */
export function addHoursToTime(from: string, hours: number): string {
  const [fh, fm] = String(from || '00:00').split(':').map(Number);
  let total = (fh || 0) * 60 + (fm || 0) + Math.round(hours * 60);
  total = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Lista objetivos de cobertura/liberación para un día en el objetivo. */
export function listRecompositionTargets(
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  absencesMap: Record<string, any>,
) {
  const targets: import('./planningRecomposition.types').RecompositionTarget[] = [];
  const absenceCodes = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

  for (const emp of employees) {
    const key = shiftKey(emp.id, dateStr);
    const absence = absencesMap[key];
    const pending = pendingChanges[key];
    const saved = shiftsMap[key];
    const shift = pending && !pending.isDeleted ? pending : saved;
    if (!shift && !absence) continue;
    if (shift?.objectiveId && shift.objectiveId !== objectiveId) continue;

    const code = String(shift?.code || absence?.inferredCode || '').toUpperCase();
    const name = emp.name || emp.id;
    const positionName = shift?.positionName || 'General';

    if (absence || absenceCodes.has(code)) {
      targets.push({
        employeeId: emp.id,
        dateStr,
        positionName,
        code: code || 'E',
        label: `${name} · ${positionName} · ${code || 'Ausencia'}`,
        kind: 'absence',
      });
      continue;
    }

    if (WORK_CODES.has(code)) {
      targets.push({
        employeeId: emp.id,
        dateStr,
        positionName,
        code,
        label: `${name} · ${positionName} · ${code} (liberar → RET)`,
        kind: 'working',
      });
    }
  }

  return targets;
}

/** Resuelve el target de recomposición para un guardia concreto (panel lateral / celda). */
export function resolveRecompositionTargetForEmployee(
  employeeId: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  absencesMap: Record<string, any>,
) {
  return listRecompositionTargets(dateStr, objectiveId, employees, shiftsMap, pendingChanges, absencesMap)
    .find(t => t.employeeId === employeeId) ?? null;
}

/** Bandas CCT adyacentes para split ext+adel al cubrir una banda objetivo. */
export function neighborBandsForTarget(targetBand: string): { extensionBand: string; earlyStartBand: string } {
  return neighborBandsCct(targetBand);
}

export function neighborBandsForTargetAtPosition(
  targetBand: string,
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
): { extensionBand: string; earlyStartBand: string } {
  return neighborBandsForVacancyGap(positionStructure, positionName, targetBand);
}

/** Guardias del objetivo con franco planificado (F/FF/FP) ese día — candidatos a FT. */
export function listPlannedFrancoCandidates(
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
): SegmentCandidateRow[] {
  const exclude = new Set(excludeIds);
  const rows: SegmentCandidateRow[] = [];
  for (const emp of employees) {
    if (!emp.id || exclude.has(emp.id)) continue;
    const shift = resolveEmployeeShift(emp.id, dateStr, shiftsMap, pendingChanges);
    if (!isPlannedFrancoShift(shift)) continue;
    const shiftObj = shift?.objectiveId;
    if (shiftObj != null && shiftObj !== '' && String(shiftObj) !== String(objectiveId)) continue;
    rows.push({
      id: emp.id,
      name: empDisplayName(emp, emp.id),
      code: String(shift?.code || 'F').toUpperCase(),
      positionName: shift?.positionName || 'Franco',
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Guardias del objetivo con turno laboral ese día (candidatos ext/adel). */
export function listSegmentCandidates(
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  bandFilter?: string,
  listCtx?: VacancySplitListContext,
) {
  const exclude = new Set(excludeIds);
  const band = bandFilter ? String(bandFilter).toUpperCase() : null;
  const positionStructure = listCtx?.positionStructure;
  const rows: { id: string; name: string; code: string; positionName: string }[] = [];

  for (const emp of employees) {
    if (exclude.has(emp.id)) continue;
    const key = shiftKey(emp.id, dateStr);
    const pending = pendingChanges[key];
    const saved = shiftsMap[key];
    const shift = pending && !pending.isDeleted ? pending : saved;
    if (!shift) continue;
    const shiftObj = shift.objectiveId;
    if (shiftObj != null && shiftObj !== '' && String(shiftObj) !== String(objectiveId)) continue;
    const code = String(shift.code || '').toUpperCase();
    if (isPlannedFrancoShift(shift)) continue;
    // Ya asignado como ext o adel en otra cobertura del día → no volver a usarlo
    if (shift.isExtended || shift.isEarlyStart) continue;
    if (!WORK_CODES.has(code) && !isVacancySegmentWorkCode(code, positionStructure)) continue;
    if (band && code !== band) continue;
    rows.push({
      id: emp.id,
      name: emp.name || emp.id,
      code,
      positionName: shift.positionName || 'General',
    });
  }

  let sorted = rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (listCtx?.preferSamePosition !== false && listCtx?.gapPositionName) {
    const pos = listCtx.gapPositionName;
    const samePos = sorted.filter((r) => r.positionName === pos);
    if (samePos.length > 0) sorted = samePos;
  }
  return sorted;
}

function listSegmentCandidatesWithBandFallback(
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[],
  band: string,
  listCtx?: VacancySplitListContext,
) {
  const ctx = { ...listCtx, preferSamePosition: listCtx?.preferSamePosition ?? true };
  let rows = listSegmentCandidates(
    dateStr,
    objectiveId,
    employees,
    shiftsMap,
    pendingChanges,
    excludeIds,
    band,
    ctx,
  );
  if (rows.length > 0) return rows;
  const loose = listSegmentCandidates(
    dateStr,
    objectiveId,
    employees,
    shiftsMap,
    pendingChanges,
    excludeIds,
    undefined,
    { ...ctx, preferSamePosition: false },
  );
  const bandUp = String(band).toUpperCase();
  const byBand = loose.filter((r) => r.code === bandUp);
  if (byBand.length > 0) return byBand;
  if (listCtx?.strictNeighborBand) return [];
  return loose;
}

/**
 * Todos los guardias con turno laboral ese día en el objetivo (elección manual ext/cierre).
 * Las bandas sugeridas se listan primero.
 */
export function listVacancySplitWorkersForDay(
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  listCtx?: VacancySplitListContext,
  suggestBands: string[] = [],
) {
  const rows = listSegmentCandidates(
    dateStr,
    objectiveId,
    employees,
    shiftsMap,
    pendingChanges,
    excludeIds,
    undefined,
    { ...listCtx, preferSamePosition: false },
  );
  if (!suggestBands.length) return rows;
  const pref = new Set(suggestBands.map((b) => String(b).toUpperCase()));
  const first = rows.filter((r) => pref.has(r.code));
  const rest = rows.filter((r) => !pref.has(r.code));
  return [
    ...first.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    ...rest.sort((a, b) => a.name.localeCompare(b.name, 'es')),
  ];
}

/** Misma ventana que el CC (`COVERAGE_JOIN_TOLERANCE_MS`): el borde del turno a ±30 min del borde del hueco. */
export const CONTIGUO_MIN = 30;

/** «15:30–16:30» o «15:30-16:30». */
export function rangoHorario(label: string | null | undefined): { from: string; to: string } | null {
  if (!label) return null;
  const m = String(label).match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { from: `${m[1].padStart(2, '0')}:${m[2]}`, to: `${m[3].padStart(2, '0')}:${m[4]}` };
}

const EXTRA_NO_PUESTO = new Set(['REF', 'ESC', 'RET', 'FT']);

function hmDeValor(v: unknown): string | null {
  if (typeof v === 'string') {
    const directo = v.trim().match(/^(\d{1,2}):(\d{2})/);
    if (directo) return `${directo[1].padStart(2, '0')}:${directo[2]}`;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const hm = new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires',
      }).format(d);
      const m = hm.match(/(\d{1,2}):(\d{2})/);
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return hmDeValor(o.toDate().toISOString());
    if (typeof o.seconds === 'number') return hmDeValor(new Date(o.seconds * 1000).toISOString());
  }
  return null;
}

function minDeHm(hm: string | null | undefined): number | null {
  if (!hm) return null;
  const m = hm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function ventanaCct(code: string): { from: string; to: string } | null {
  const c = String(code || '').toUpperCase();
  if (c === 'M') return { from: '07:00', to: '15:00' };
  if (c === 'T') return { from: '15:00', to: '23:00' };
  if (c === 'N') return { from: '23:00', to: '07:00' };
  if (c === 'D12') return { from: '07:00', to: '19:00' };
  if (c === 'N12') return { from: '19:00', to: '07:00' };
  return null;
}

/** Horario real del doc. Si no tiene horas, la franja SLA del puesto y el código. CCT solo si tampoco hay SLA. */
function horarioDelTurno(
  shift: Record<string, any> | null | undefined,
  positionStructure: VacancyPositionSla[] | undefined,
): { from: string; to: string; startMin: number; endMin: number } | null {
  if (!shift) return null;
  const desdeDoc = hmDeValor(shift.startTime);
  const hastaDoc = hmDeValor(shift.endTime);
  if (desdeDoc && hastaDoc && !(desdeDoc === '00:00' && hastaDoc === '00:00')) {
    const startMin = minDeHm(desdeDoc)!;
    let endMin = minDeHm(hastaDoc)!;
    if (endMin <= startMin) endMin += 24 * 60;
    return { from: desdeDoc, to: hastaDoc, startMin, endMin };
  }
  const code = String(shift.code || '').toUpperCase();
  const posName = String(shift.positionName || '');
  const pos = positionStructure?.find((p) => p.positionName === posName);
  const band = pos?.shifts?.find((s) => String(s.code || '').toUpperCase() === code);
  if (band) {
    const w = shiftTimeWindowFromSla(band);
    return { from: w.from.slice(0, 5), to: w.to.slice(0, 5), startMin: w.startMin, endMin: w.endMin };
  }
  const cct = ventanaCct(code);
  if (!cct) return null;
  const startMin = minDeHm(cct.from)!;
  let endMin = minDeHm(cct.to)!;
  if (endMin <= startMin) endMin += 24 * 60;
  return { from: cct.from, to: cct.to, startMin, endMin };
}

function ventanaDelHueco(
  targetBand: string,
  listCtx: VacancySplitListContext | undefined,
): { start: number; end: number; from: string; to: string } | null {
  const desde = hmDeValor(listCtx?.gapStart);
  const hasta = hmDeValor(listCtx?.gapEnd);
  if (desde && hasta) {
    const start = minDeHm(desde)!;
    let end = minDeHm(hasta)!;
    if (end <= start) end += 24 * 60;
    return { start, end, from: desde, to: hasta };
  }
  const sla = horarioDelTurno(
    { code: targetBand, positionName: listCtx?.gapPositionName, startTime: '', endTime: '' },
    listCtx?.positionStructure,
  );
  if (sla && (listCtx?.positionStructure?.length || ventanaCct(targetBand))) {
    return { start: sla.startMin, end: sla.endMin, from: sla.from, to: sla.to };
  }
  return null;
}

/** Turno de puesto: no licencia, no franco, no RET/ESC/REF, no ops_cov, no ya extendido. */
function esTurnoDePuestoParaExtender(shift: Record<string, any> | null | undefined): boolean {
  // En Planificación el cronograma entero es borrador hasta publicar: un turno en borrador es plan, sí cuenta.
  if (!shift || shift.isDeleted || shift.isVirtual === true) return false;
  if (shift.isAbsent === true) return false;
  if (shift.isExtended || shift.isEarlyStart) return false;
  if (String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return false;
  if (isPlannedFrancoShift(shift)) return false;
  const code = String(shift.code || '').toUpperCase();
  const orig = String(shift.codigoOriginal || '').toUpperCase();
  if (EXTRA_NO_PUESTO.has(code) || EXTRA_NO_PUESTO.has(orig)) return false;
  return isReliefEligibleShift({ ...shift, draft: false });
}

export function textoFilaHorario(p: {
  name: string;
  code: string;
  from: string;
  to: string;
  deltaMin: number;
  lado: 'ext' | 'adel';
}): string {
  const apellido = String(p.name || '').split(',')[0].trim().split(/\s+/)[0] || p.name;
  const abs = Math.abs(p.deltaMin);
  const cuando = p.deltaMin === 0
    ? (p.lado === 'ext' ? 'termina a la hora' : 'arranca a la hora')
    : p.lado === 'ext'
      ? (p.deltaMin < 0 ? `termina ${abs} min antes` : `termina ${abs} min después`)
      : (p.deltaMin < 0 ? `arranca ${abs} min antes` : `arranca ${abs} min después`);
  return `${apellido} · ${p.code} ${p.from}–${p.to} · ${cuando}`;
}

function listarContiguos(
  lado: 'ext' | 'adel',
  targetBand: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[],
  listCtx: VacancySplitListContext | undefined,
): SegmentCandidateRow[] {
  const hueco = ventanaDelHueco(targetBand, listCtx);
  if (!hueco) return [];
  const exclude = new Set(excludeIds);
  const borde = lado === 'ext' ? hueco.start : hueco.end;
  const prev = previousCalendarDayStr(dateStr);
  const next = nextCalendarDayStr(dateStr);
  const dias = lado === 'ext' ? [dateStr, prev] : [dateStr, next];
  const porPersona = new Map<string, SegmentCandidateRow & { abs: number; mismo: boolean }>();
  for (const dia of dias) {
    const offset = dia === dateStr ? 0 : dia === prev ? -1 : 1;
    for (const emp of employees) {
      if (!emp.id || exclude.has(emp.id)) continue;
      const shift = resolveEmployeeShift(emp.id, dia, shiftsMap, pendingChanges);
      if (!esTurnoDePuestoParaExtender(shift)) continue;
      const shiftObj = shift?.objectiveId;
      if (shiftObj != null && shiftObj !== '' && String(shiftObj) !== String(objectiveId)) continue;
      const horario = horarioDelTurno(shift, listCtx?.positionStructure);
      if (!horario) continue;
      const punta = (lado === 'ext' ? horario.endMin : horario.startMin) + offset * 24 * 60;
      const delta = punta - borde;
      // De un solo lado: extender termina antes o a la hora; adelantar arranca a la hora o hasta 30 min después.
      // Si termina después de que empieza el hueco, está en otro lado durante el hueco.
      if (lado === 'ext' ? (delta > 0 || delta < -CONTIGUO_MIN) : (delta < 0 || delta > CONTIGUO_MIN)) continue;
      const positionNamePre = String(shift?.positionName || 'General');
      if (
        offset === 0
        && listCtx?.gapPositionName
        && positionNamePre === listCtx.gapPositionName
        && horario.startMin >= hueco.start
        && horario.startMin < hueco.end
      ) {
        continue;
      }
      const name = empDisplayName(emp, emp.id);
      const code = String(shift?.code || '').toUpperCase();
      const positionName = positionNamePre;
      const row: SegmentCandidateRow & { abs: number; mismo: boolean } = {
        id: emp.id,
        name: offset < 0
          ? `${name} · ${code} ${dia.slice(8)}/${dia.slice(5, 7)}→`
          : offset > 0
            ? `${name} · ${code} ←${dia.slice(8)}/${dia.slice(5, 7)}`
            : name,
        code,
        positionName,
        scheduleLabel: `${horario.from}–${horario.to}`,
        deltaMin: delta,
        textoFila: textoFilaHorario({ name, code, from: horario.from, to: horario.to, deltaMin: delta, lado }),
        abs: Math.abs(delta),
        mismo: !!listCtx?.gapPositionName && positionName === listCtx.gapPositionName,
        ...(offset < 0 ? { extensionApplyDate: dia } : {}),
        ...(offset > 0 ? { earlyStartApplyDate: dia } : {}),
      };
      const prev = porPersona.get(emp.id);
      if (!prev || row.abs < prev.abs) porPersona.set(emp.id, row);
    }
  }
  return [...porPersona.values()]
    .sort((a, b) => {
      if (a.mismo !== b.mismo) return a.mismo ? -1 : 1;
      if (a.abs !== b.abs) return a.abs - b.abs;
      return a.name.localeCompare(b.name, 'es');
    })
    .map(({ abs: _a, mismo: _m, ...row }) => row);
}

/**
 * Ext si termina entre (inicio − 30 min) e inicio. Adel si arranca entre el fin y el fin + 30 min.
 * offsetDays = −1 para la N del día anterior (su fin cae en el día del hueco).
 * offsetDays = +1 para la M del día siguiente (su inicio es el fin del hueco N).
 */
export function clasificarTurnoContraHueco(
  shift: Record<string, any> | null | undefined,
  gapStart: string,
  gapEnd: string,
  positionStructure?: VacancyPositionSla[],
  opts?: { offsetDays?: number; gapPositionName?: string | null },
): 'ext' | 'adel' | null {
  if (!esTurnoDePuestoParaExtender(shift)) return null;
  const horario = horarioDelTurno(shift, positionStructure);
  const hueco = ventanaDelHueco('X', { gapStart, gapEnd });
  if (!horario || !hueco) return null;
  const offset = opts?.offsetDays || 0;
  const pos = String(shift?.positionName || '');
  if (
    offset === 0
    && opts?.gapPositionName
    && pos === opts.gapPositionName
    && horario.startMin >= hueco.start
    && horario.startMin < hueco.end
  ) {
    return null;
  }
  const fin = horario.endMin + offset * 24 * 60;
  const ini = horario.startMin + offset * 24 * 60;
  const dExt = fin - hueco.start;
  const dAdel = ini - hueco.end;
  const esExt = dExt <= 0 && dExt >= -CONTIGUO_MIN;
  const esAdel = (offset === 0 || offset === 1) && dAdel >= 0 && dAdel <= CONTIGUO_MIN;
  if (esExt && !esAdel) return 'ext';
  if (esAdel && !esExt) return 'adel';
  return null;
}

/** Día de la celda donde vive el turno que extiende o adelanta. La extensión puede ser el día anterior; el adelanto, el siguiente. */
export function resolverDiaTramo(opts: {
  lado: 'ext' | 'adel';
  empId: string;
  dateStr: string;
  gapFrom: string;
  gapTo: string;
  gapPosition?: string | null;
  shiftsMap: Record<string, any>;
  pendingChanges?: Record<string, any>;
  positionStructure?: VacancyPositionSla[];
  preferDate?: string | null;
}): { dateStr: string; shift: Record<string, any> | null } {
  const prev = previousCalendarDayStr(opts.dateStr);
  const next = nextCalendarDayStr(opts.dateStr);
  const natural = opts.lado === 'ext' ? [opts.dateStr, prev] : [opts.dateStr, next];
  const dias = [...new Set([...(opts.preferDate ? [opts.preferDate] : []), ...natural])];
  const pending = opts.pendingChanges || {};
  for (const dia of dias) {
    const shift = resolveEmployeeShift(opts.empId, dia, opts.shiftsMap, pending);
    if (!shift) continue;
    const offset = dia === opts.dateStr ? 0 : dia === prev ? -1 : dia === next ? 1 : 0;
    const lado = clasificarTurnoContraHueco(shift, opts.gapFrom, opts.gapTo, opts.positionStructure, {
      offsetDays: offset,
      gapPositionName: opts.gapPosition,
    });
    if (lado === opts.lado) return { dateStr: dia, shift };
  }
  const fallback = opts.preferDate || opts.dateStr;
  return { dateStr: fallback, shift: resolveEmployeeShift(opts.empId, fallback, opts.shiftsMap, pending) };
}

/** Extensión: quien termina entre 30 min antes y el inicio del hueco. Incluye la N del día anterior. */
export function listExtensionCandidates(
  targetBand: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  listCtx?: VacancySplitListContext,
): SegmentCandidateRow[] {
  return listarContiguos('ext', targetBand, dateStr, objectiveId, employees, shiftsMap, pendingChanges, excludeIds, listCtx);
}

/** Adelanto: quien arranca entre el fin del hueco y 30 min después. Si el hueco termina al día siguiente, mira esa M. */
export function listEarlyStartCandidates(
  targetBand: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  listCtx?: VacancySplitListContext,
): SegmentCandidateRow[] {
  return listarContiguos('adel', targetBand, dateStr, objectiveId, employees, shiftsMap, pendingChanges, excludeIds, listCtx);
}

function samePositionFirst<T extends { positionName: string }>(rows: T[], pos: string | null | undefined): T[] {
  if (!pos) return rows;
  return [...rows.filter((r) => r.positionName === pos), ...rows.filter((r) => r.positionName !== pos)];
}

export function defaultSplitForBand(band: string): { ext: { from: string; to: string }; adel: { from: string; to: string }; gap: { from: string; to: string } } {
  return defaultSplitTimesCct(band);
}

export function defaultSplitForBandAtPosition(
  band: string,
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
): { ext: { from: string; to: string }; adel: { from: string; to: string }; gap: { from: string; to: string } } {
  return defaultSplitTimesForVacancyGap(positionStructure, positionName, band);
}
