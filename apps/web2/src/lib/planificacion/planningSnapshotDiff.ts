/** Celda normalizada del snapshot de planificación (misma forma que al guardar historial). */
export type PlanningSnapshotCell = {
  code?: string;
  isFranco?: boolean;
  isFrancoTrabajado?: boolean;
  isFrancoCompensatorio?: boolean;
};

export type PlanningSnapshot = Record<string, PlanningSnapshotCell | undefined>;

export type PlanningDiffCell = {
  key: string;
  empId: string;
  date: string;
  histLabel: string | null;
  currentLabel: string | null;
  kind: 'added' | 'removed' | 'modified';
};

export type PlanningDiffResult = {
  changedCount: number;
  cells: PlanningDiffCell[];
  /** keys con diferencia para resaltar en la grilla */
  changedKeys: Set<string>;
};

function displayCode(cell: PlanningSnapshotCell | undefined | null): string | null {
  if (!cell) return null;
  if (cell.isFrancoTrabajado) return 'FT';
  if (cell.isFrancoCompensatorio) return 'FF';
  const c = String(cell.code ?? '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'F' || cell.isFranco) return 'F';
  return c;
}

/** Empleados con celdas en el objetivo (evita recorrer toda la dotación del grupo). */
export function collectSnapshotEmployeeIds(
  pendingChanges: Record<string, unknown>,
  shiftsMap: Record<string, { objectiveId?: string } | undefined>,
  objectiveId: string,
): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(pendingChanges)) {
    const empId = key.split('_')[0];
    if (empId) ids.add(empId);
  }
  for (const [key, shift] of Object.entries(shiftsMap)) {
    if (shift?.objectiveId === objectiveId) {
      const empId = key.split('_')[0];
      if (empId) ids.add(empId);
    }
  }
  return [...ids];
}

/** Arma snapshot del estado visible (turnos guardados + pendientes). */
export function buildPlanningSnapshotFromGrid(args: {
  employeeIds: string[];
  dateKeys: string[];
  shiftsMap: Record<string, { code?: string; isFranco?: boolean; isFrancoTrabajado?: boolean; isFrancoCompensatorio?: boolean; objectiveId?: string } | undefined>;
  pendingChanges: Record<string, PlanningSnapshotCell & { isDeleted?: boolean; objectiveId?: string } | undefined>;
  objectiveId: string;
}): PlanningSnapshot {
  const { employeeIds, dateKeys, shiftsMap, pendingChanges, objectiveId } = args;
  const out: PlanningSnapshot = {};
  for (const empId of employeeIds) {
    for (const date of dateKeys) {
      const key = `${empId}_${date}`;
      const pending = pendingChanges[key];
      const existing = shiftsMap[key];
      if (pending) {
        if (!pending.isDeleted) {
          out[key] = {
            code: pending.code,
            isFranco: pending.isFranco,
            isFrancoTrabajado: pending.isFrancoTrabajado,
            isFrancoCompensatorio: pending.isFrancoCompensatorio,
          };
        }
      } else if (existing && existing.objectiveId === objectiveId) {
        out[key] = {
          code: existing.code,
          isFranco: existing.isFranco,
          isFrancoTrabajado: existing.isFrancoTrabajado,
          isFrancoCompensatorio: existing.isFrancoCompensatorio,
        };
      }
    }
  }
  return out;
}

export function diffPlanningSnapshots(
  historical: PlanningSnapshot,
  current: PlanningSnapshot,
): PlanningDiffResult {
  const keys = new Set([...Object.keys(historical), ...Object.keys(current)]);
  const cells: PlanningDiffCell[] = [];
  const changedKeys = new Set<string>();

  for (const key of keys) {
    const histLabel = displayCode(historical[key]);
    const currentLabel = displayCode(current[key]);
    if (histLabel === currentLabel) continue;

    const [empId, date] = key.split('_');
    if (!empId || !date) continue;

    let kind: PlanningDiffCell['kind'];
    if (histLabel && !currentLabel) kind = 'removed';
    else if (!histLabel && currentLabel) kind = 'added';
    else kind = 'modified';

    changedKeys.add(key);
    cells.push({ key, empId, date, histLabel, currentLabel, kind });
  }

  cells.sort((a, b) => a.date.localeCompare(b.date) || a.empId.localeCompare(b.empId));

  return { changedCount: cells.length, cells, changedKeys };
}
