import type { RecompositionPackage, RecompositionPendingMeta } from './planningRecomposition.types';

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'D12', 'REF', 'ESC', 'FT']);

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

/** Construye actualizaciones de pendingChanges para un paquete ext+adel. */
export function buildRecompositionPendingUpdates(
  pkg: RecompositionPackage,
  ctx: {
    shiftsMap: Record<string, any>;
    pendingChanges: Record<string, any>;
    employeesById: Record<string, any>;
    objectiveId: string;
    clientId?: string;
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
  updates[extKey] = mergeShift(extBase, {
    isExtended: true,
    isEarlyStart: false,
    ...baseMeta('EXTENSION', {
      adjustedEndTime: pkg.extension.toTime,
      segmentFromTime: pkg.extension.fromTime,
      segmentToTime: pkg.extension.toTime,
      coverageNote: `Ext +${pkg.gapPositionName} ${pkg.extension.fromTime}-${pkg.extension.toTime} · ${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
    }),
  });

  // ── Adelanto (G2) ──
  const adelKey = shiftKey(pkg.earlyStart.employeeId, pkg.dateStr);
  const adelBase = getShift(pkg.earlyStart.employeeId, pkg.dateStr);
  if (!adelBase || adelBase.isDeleted) {
    throw new Error('El guardia de adelanto no tiene turno ese día');
  }
  updates[adelKey] = mergeShift(adelBase, {
    isEarlyStart: true,
    isExtended: false,
    adjustedStartTime: pkg.earlyStart.fromTime,
    ...baseMeta('EARLY_START', {
      segmentFromTime: pkg.earlyStart.fromTime,
      segmentToTime: pkg.earlyStart.toTime,
      coverageNote: `Adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime} · ${pkg.gapPositionName} · ${pkg.mode === 'liberation' ? 'liberación' : 'cubre'} ${targetName.split(',')[0]}`,
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
