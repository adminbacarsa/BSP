import { shiftMatchesOpsViewTab, type OpsViewTabShift } from './shiftMatchesOpsViewTab';

/** Contadores de la tarjeta de objetivo. Cada solapa suma sola: un ausente descubierto es AUS y VAC. */
export type OpsObjectiveBucket = {
  active: number;
  retention: number;
  absent: number;
  vacant: number;
  plan: number;
};

export function emptyOpsObjectiveBucket(): OpsObjectiveBucket {
  return { active: 0, retention: 0, absent: 0, vacant: 0, plan: 0 };
}

export function addShiftToOpsBucket(bucket: OpsObjectiveBucket, shift: OpsViewTabShift, now: Date = new Date()): void {
  if (shiftMatchesOpsViewTab(shift, 'ACTIVOS', now)) bucket.active += 1;
  if (shiftMatchesOpsViewTab(shift, 'RETENIDOS', now)) bucket.retention += 1;
  if (shiftMatchesOpsViewTab(shift, 'AUSENTES', now)) bucket.absent += 1;
  if (shiftMatchesOpsViewTab(shift, 'VACANTES', now)) bucket.vacant += 1;
  if (shiftMatchesOpsViewTab(shift, 'PLAN', now)) bucket.plan += 1;
}

export function opsObjectiveHasActivity(bucket: OpsObjectiveBucket): boolean {
  return bucket.active + bucket.retention + bucket.absent + bucket.vacant + bucket.plan > 0;
}

/** El objetivo entra en la solapa si alguno de sus turnos pasa el mismo filtro que la lista y el contador. */
export function objectiveVisibleOnOpsTab(
  shifts: readonly OpsViewTabShift[],
  viewTab: string,
  now: Date = new Date(),
): boolean {
  return shifts.some((s) => shiftMatchesOpsViewTab(s, viewTab, now));
}

export const OPS_OBJECTIVE_PARITY_TABS = ['PLAN', 'ACTIVOS', 'RETENIDOS', 'VACANTES', 'AUSENTES', 'FRANCOS'] as const;

export type OpsParityShift = OpsViewTabShift & {
  id: string;
  objectiveId?: string;
  isEvent?: boolean;
  eventKey?: string;
};

/**
 * Misma regla que el CC: FRANC lista los turnos (no arma tarjeta de objetivo);
 * el resto agrupa por objetivo o evento y se queda con los grupos que tienen
 * un turno de esa solapa. La unión de esos turnos es la lista.
 */
export function opsTabShiftIds(
  shifts: readonly OpsParityShift[],
  viewTab: string,
  now: Date = new Date(),
): { list: string[]; objectives: string[] } {
  const list = shifts.filter((s) => shiftMatchesOpsViewTab(s, viewTab, now)).map((s) => s.id);
  if (viewTab === 'FRANCOS') return { list, objectives: [...list] };

  const groups = new Map<string, { bucket: OpsObjectiveBucket; shifts: OpsParityShift[] }>();
  for (const s of shifts) {
    if (s.isFranco) continue;
    const key = s.isEvent ? `EV_${s.eventKey || s.id}` : `OBJ_${s.objectiveId || 'unknown'}`;
    let g = groups.get(key);
    if (!g) {
      g = { bucket: emptyOpsObjectiveBucket(), shifts: [] };
      groups.set(key, g);
    }
    g.shifts.push(s);
    addShiftToOpsBucket(g.bucket, s, now);
  }
  const objectives: string[] = [];
  for (const g of groups.values()) {
    if (!opsObjectiveHasActivity(g.bucket)) continue;
    if (!objectiveVisibleOnOpsTab(g.shifts, viewTab, now)) continue;
    for (const s of g.shifts) {
      if (shiftMatchesOpsViewTab(s, viewTab, now)) objectives.push(s.id);
    }
  }
  return { list, objectives };
}
