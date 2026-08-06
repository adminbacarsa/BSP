import type { RecompositionPackage, RecompositionPendingMeta } from './planningRecomposition.types';
import {
  defaultSplitTimesCct,
  defaultSplitTimesForVacancyGap,
  isVacancySegmentWorkCode,
  neighborBandsCct,
  neighborBandsForVacancyGap,
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

  const extEmp = employeesById[pkg.extension.employeeId];
  const adelEmp = employeesById[pkg.earlyStart.employeeId];
  const targetEmp = employeesById[pkg.target.employeeId];
  const extName = empDisplayName(extEmp, pkg.extension.employeeId);
  const adelName = empDisplayName(adelEmp, pkg.earlyStart.employeeId);
  const targetName = empDisplayName(targetEmp, pkg.target.employeeId);

  const coveredByLabel = `${extName.split(',')[0]} ext ${pkg.extension.fromTime}-${pkg.extension.toTime} + ${adelName.split(',')[0]} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}`;

  const baseMeta = (role: RecompositionPendingMeta['coverageSegmentRole'], extra: Partial<RecompositionPendingMeta> = {}): RecompositionPendingMeta => ({
    coveragePackageId: pkg.id,
    coverageType: pkg.type,
    coverageSegmentRole: role,
    coversEmployeeId: pkg.target.employeeId,
    coversPositionName: pkg.gapPositionName,
    coversBandCode: String(pkg.target.code || '').toUpperCase() || undefined,
    coverageMode: 'SPLIT',
    ...extra,
  });

  // ── Titular / ausente / vacante (target) ──
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

  // ── Extensión (G1) ──
  const extKey = shiftKey(pkg.extension.employeeId, pkg.dateStr);
  const extBase = getShift(pkg.extension.employeeId, pkg.dateStr);
  if (!extBase || extBase.isDeleted) {
    throw new Error('El guardia de extensión no tiene turno ese día');
  }
  const extOnFranco = isPlannedFrancoShift(extBase);
  if (extOnFranco && !ctx.authorizeFrancoTrabajado) {
    throw new Error(`FRANCO_COVERAGE:${extName} tiene franco planificado (${extBase.code}) el ${pkg.dateStr} — requiere PIN de supervisor (FT / costo extra).`);
  }
  updates[extKey] = mergeShift(extBase, {
    isFrancoTrabajado: extOnFranco ? true : (extBase.isFrancoTrabajado || false),
    isFranco: extOnFranco ? false : extBase.isFranco,
    code: extOnFranco ? (pkg.extension.baseCode || extBase.code) : extBase.code,
    isExtended: true,
    isEarlyStart: false,
    ...baseMeta('EXTENSION', {
      adjustedEndTime: pkg.extension.toTime,
      segmentFromTime: pkg.extension.fromTime,
      segmentToTime: pkg.extension.toTime,
      coverageNote: `${extOnFranco ? 'FT ' : ''}Ext +${pkg.gapPositionName} ${pkg.extension.fromTime}-${pkg.extension.toTime} · ${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
    }),
  });

  // ── Adelanto (G2) ──
  const adelKey = shiftKey(pkg.earlyStart.employeeId, pkg.dateStr);
  const adelBase = getShift(pkg.earlyStart.employeeId, pkg.dateStr);
  if (!adelBase || adelBase.isDeleted) {
    throw new Error('El guardia de adelanto no tiene turno ese día');
  }
  const adelOnFranco = isPlannedFrancoShift(adelBase);
  if (adelOnFranco && !ctx.authorizeFrancoTrabajado) {
    throw new Error(`FRANCO_COVERAGE:${adelName} tiene franco planificado (${adelBase.code}) el ${pkg.dateStr} — requiere PIN de supervisor (FT / costo extra).`);
  }
  const tailExtension = vacancySecondSegmentIsTailExtension(String(pkg.target.code || ''));
  if (tailExtension) {
    updates[adelKey] = mergeShift(adelBase, {
      isFrancoTrabajado: adelOnFranco ? true : (adelBase.isFrancoTrabajado || false),
      isFranco: adelOnFranco ? false : adelBase.isFranco,
      code: adelOnFranco ? (pkg.earlyStart.baseCode || adelBase.code) : adelBase.code,
      isExtended: true,
      isEarlyStart: false,
      ...baseMeta('EXTENSION', {
        adjustedEndTime: pkg.earlyStart.toTime,
        segmentFromTime: pkg.earlyStart.fromTime,
        segmentToTime: pkg.earlyStart.toTime,
        coverageNote: `${adelOnFranco ? 'FT ' : ''}Ext cierre ${pkg.gapPositionName} ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime} · ${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
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
    ...baseMeta('EARLY_START', {
      segmentFromTime: pkg.earlyStart.fromTime,
      segmentToTime: pkg.earlyStart.toTime,
      coverageNote: `${adelOnFranco ? 'FT ' : ''}Adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime} · ${pkg.gapPositionName} · ${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
    }),
  });
  }

  return updates;
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

/** Extensión: guardias de la banda **anterior** (ej. cubrir M → turnos N). */
export function listExtensionCandidates(
  targetBand: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  listCtx?: VacancySplitListContext,
) {
  const positionName = listCtx?.gapPositionName ?? null;
  const { extensionBand } = listCtx?.positionStructure?.length
    ? neighborBandsForVacancyGap(listCtx.positionStructure, positionName, targetBand)
    : neighborBandsForTarget(targetBand);
  return listSegmentCandidatesWithBandFallback(
    dateStr,
    objectiveId,
    employees,
    shiftsMap,
    pendingChanges,
    excludeIds,
    extensionBand,
    { ...listCtx, gapBand: targetBand, gapPositionName: positionName ?? listCtx?.gapPositionName },
  );
}

/** Adelanto: guardias de la banda **siguiente** (ej. cubrir M → turnos T). */
export function listEarlyStartCandidates(
  targetBand: string,
  dateStr: string,
  objectiveId: string,
  employees: { id: string; name?: string }[],
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
  excludeIds: string[] = [],
  listCtx?: VacancySplitListContext,
) {
  const positionName = listCtx?.gapPositionName ?? null;
  const { earlyStartBand } = listCtx?.positionStructure?.length
    ? neighborBandsForVacancyGap(listCtx.positionStructure, positionName, targetBand)
    : neighborBandsForTarget(targetBand);
  return listSegmentCandidatesWithBandFallback(
    dateStr,
    objectiveId,
    employees,
    shiftsMap,
    pendingChanges,
    excludeIds,
    earlyStartBand,
    { ...listCtx, gapBand: targetBand, gapPositionName: positionName ?? listCtx?.gapPositionName },
  );
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
