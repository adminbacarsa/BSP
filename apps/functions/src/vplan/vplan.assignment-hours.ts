/**
 * VPLAN — resolución y normalización de horas facturables por celda.
 * Evita slots cubiertos con code de trabajo pero hours: 0 (no suman al SLA).
 */

import { billableHoursForCode } from './vplan.cycle-templates';
import { shiftBandHours, type VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry } from './vplan.types';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR', 'V', 'L', 'A', 'E', 'PG', 'AA']);

function shiftForCode(
  positions: VplanPositionDef[] | undefined,
  positionName: string | undefined,
  code: string,
): { code?: string; hours?: number } | undefined {
  const posName = String(positionName || '').trim();
  if (!posName || !positions?.length) return undefined;
  const pos = positions.find((p) => p.positionName === posName);
  if (!pos) return undefined;
  return (pos.shifts || []).find(
    (s) => String(s.code || '').toUpperCase() === code.toUpperCase(),
  );
}

/** Horas facturables efectivas de una asignación (ignora hours: 0 en códigos de trabajo). */
export function resolveAssignmentBillableHours(
  a: VplanAssignment,
  opts?: { cycle?: string; positions?: VplanPositionDef[] },
): number {
  const code = String(a.code || '').toUpperCase();
  if (!code || NON_BILLABLE.has(code)) return 0;

  const stored = Number(a.hours);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const shift = shiftForCode(opts?.positions, a.positionName, code);
  if (shift) return shiftBandHours(shift);

  return billableHoursForCode(code, opts?.cycle);
}

export function countDraftBillableHours(
  assignments: VplanAssignment[],
  opts?: { cycle?: string; positions?: VplanPositionDef[] },
): number {
  let total = 0;
  for (const a of assignments) {
    total += resolveAssignmentBillableHours(a, opts);
  }
  return Math.round(total);
}

/** Corrige celdas de trabajo con hours ausente o 0. */
export function normalizeAssignmentBillableHours(
  assignments: VplanAssignment[],
  opts: { cycle?: string; positions?: VplanPositionDef[] },
): { assignments: VplanAssignment[]; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const next = assignments.map((a) => {
    const code = String(a.code || '').toUpperCase();
    if (!code || NON_BILLABLE.has(code)) return a;

    const stored = Number(a.hours);
    if (Number.isFinite(stored) && stored > 0) return a;

    const hours = resolveAssignmentBillableHours(a, opts);
    if (hours <= 0) return a;

    log.push({
      code: 'HOURS_NORMALIZE',
      message: `${code} hours ${stored || 0} → ${hours} (${a.dateStr})`,
      employeeId: a.employeeId,
      dateStr: a.dateStr,
    });
    return { ...a, hours };
  });

  return { assignments: next, log };
}
