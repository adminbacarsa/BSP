/**
 * Puestos asignados (defaultPositionByEmp) — inferencia y enforcement.
 */

import { is24hsPosition, isCustomFixedShiftPosition, type VplanPositionDef } from './vplan.positions';
import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);

function assignmentKey(empId: string, dateStr: string): string {
  return `${empId}_${dateStr}`;
}

/** Puesto más frecuente en turnos del mes anterior (fallback si no hay planificacion_estados). */
export function inferDefaultPositionFromTurnos(
  assignments: VplanExistingAssignment[],
): Record<string, string> {
  const tally = new Map<string, Map<string, number>>();

  for (const a of assignments) {
    const pos = String(a.positionName || '').trim();
    const code = String(a.code || '').toUpperCase();
    if (!pos || code === 'F' || code === 'RET' || code === 'R') continue;
    if (!tally.has(a.employeeId)) tally.set(a.employeeId, new Map());
    const byPos = tally.get(a.employeeId)!;
    byPos.set(pos, (byPos.get(pos) || 0) + 1);
  }

  const out: Record<string, string> = {};
  for (const [empId, byPos] of tally) {
    let bestPos = '';
    let bestCount = 0;
    for (const [pos, count] of byPos) {
      if (count > bestCount) {
        bestPos = pos;
        bestCount = count;
      }
    }
    if (bestPos) out[empId] = bestPos;
  }
  return out;
}

export function mergeDefaultPositionMaps(
  ...layers: Array<Record<string, string> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [empId, pos] of Object.entries(layer)) {
      if (pos) out[empId] = pos;
    }
  }
  return out;
}

export function mergeDefaultShiftMaps(
  ...layers: Array<Record<string, string> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [empId, band] of Object.entries(layer)) {
      if (band) out[empId] = band.toUpperCase();
    }
  }
  return out;
}

/**
 * Asegura positionName en días de trabajo para guardias con puesto 24hs fijo.
 */
export function enforceAssigned24hsPositions(opts: {
  draft: VplanScheduleDraft;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
  const fixed24hs = new Map<string, string>();

  for (const [empId, posName] of Object.entries(opts.defaultPositionByEmp)) {
    const pos = posByName.get(posName);
    if (!pos || !is24hsPosition(pos) || isCustomFixedShiftPosition(pos)) continue;
    fixed24hs.set(empId, posName);
  }

  if (fixed24hs.size === 0) {
    return { draft: opts.draft, log };
  }

  const assignments = opts.draft.assignments.map((a) => {
    const fixedPos = fixed24hs.get(a.employeeId);
    if (!fixedPos) return a;
    const code = a.code.toUpperCase();
    if (!WORK_CODES.has(code)) {
      if (a.positionName === '') return a;
      return { ...a, positionName: '' };
    }
    if (a.positionName === fixedPos) return a;
    log.push({
      code: 'ASSIGNED_POSITION_ENFORCE',
      message: `${a.positionName || '—'} → ${fixedPos}`,
      employeeId: a.employeeId,
      dateStr: a.dateStr,
    });
    return { ...a, positionName: fixedPos };
  });

  return {
    draft: { ...opts.draft, assignments },
    log,
  };
}

export function detectAssignedPositionViolations(
  draft: VplanScheduleDraft,
  defaultPositionByEmp: Record<string, string>,
  positions: VplanPositionDef[],
): Array<{
  employeeId: string;
  dateStr: string;
  expectedPosition: string;
  actualPosition: string;
  code: string;
}> {
  const posByName = new Map(positions.map((p) => [p.positionName, p]));
  const violations: Array<{
    employeeId: string;
    dateStr: string;
    expectedPosition: string;
    actualPosition: string;
    code: string;
  }> = [];

  for (const a of draft.assignments) {
    const expected = defaultPositionByEmp[a.employeeId];
    if (!expected) continue;
    const pos = posByName.get(expected);
    if (!pos || !is24hsPosition(pos) || isCustomFixedShiftPosition(pos)) continue;
    const code = a.code.toUpperCase();
    if (!WORK_CODES.has(code)) continue;
    const actual = String(a.positionName || '').trim();
    if (actual === expected) continue;
    violations.push({
      employeeId: a.employeeId,
      dateStr: a.dateStr,
      expectedPosition: expected,
      actualPosition: actual || '—',
      code,
    });
  }

  return violations;
}
