import type { RecompositionPackage, RecompositionPendingMeta } from './planningRecomposition.types';

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
  const b = String(targetBand || '').toUpperCase();
  if (b === 'M' || b === 'D12') return { extensionBand: 'N', earlyStartBand: 'T' };
  if (b === 'T') return { extensionBand: 'M', earlyStartBand: 'N' };
  if (b === 'N' || b === 'N12') return { extensionBand: 'T', earlyStartBand: 'M' };
  return { extensionBand: 'M', earlyStartBand: 'T' };
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
) {
  const exclude = new Set(excludeIds);
  const band = bandFilter ? String(bandFilter).toUpperCase() : null;
  const rows: { id: string; name: string; code: string; positionName: string }[] = [];

  for (const emp of employees) {
    if (exclude.has(emp.id)) continue;
    const key = shiftKey(emp.id, dateStr);
    const pending = pendingChanges[key];
    const saved = shiftsMap[key];
    const shift = pending && !pending.isDeleted ? pending : saved;
    if (!shift || shift.objectiveId !== objectiveId) continue;
    const code = String(shift.code || '').toUpperCase();
    if (isPlannedFrancoShift(shift)) continue;
    if (!WORK_CODES.has(code)) continue;
    if (band && code !== band) continue;
    rows.push({
      id: emp.id,
      name: emp.name || emp.id,
      code,
      positionName: shift.positionName || 'General',
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
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
) {
  const { extensionBand } = neighborBandsForTarget(targetBand);
  return listSegmentCandidates(dateStr, objectiveId, employees, shiftsMap, pendingChanges, excludeIds, extensionBand);
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
) {
  const { earlyStartBand } = neighborBandsForTarget(targetBand);
  return listSegmentCandidates(dateStr, objectiveId, employees, shiftsMap, pendingChanges, excludeIds, earlyStartBand);
}

export function defaultSplitForBand(band: string): { ext: { from: string; to: string }; adel: { from: string; to: string }; gap: { from: string; to: string } } {
  const b = band.toUpperCase();
  if (b === 'T') {
    return {
      gap: { from: '15:00', to: '23:00' },
      ext: { from: '15:00', to: '19:00' },
      adel: { from: '19:00', to: '23:00' },
    };
  }
  if (b === 'N') {
    return {
      gap: { from: '19:00', to: '07:00' },
      ext: { from: '19:00', to: '23:00' },
      adel: { from: '23:00', to: '07:00' },
    };
  }
  if (b === 'M') {
    return {
      gap: { from: '07:00', to: '15:00' },
      ext: { from: '07:00', to: '11:00' },
      adel: { from: '11:00', to: '15:00' },
    };
  }
  return {
    gap: { from: '15:00', to: '23:00' },
    ext: { from: '15:00', to: '19:00' },
    adel: { from: '19:00', to: '23:00' },
  };
}
