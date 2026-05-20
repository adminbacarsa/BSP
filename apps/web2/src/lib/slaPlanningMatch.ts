import { slaCoversCalendarMonth, toYyyyMmDd } from '@/lib/firestoreDates';
import { filterSlaRowsByEmpresa } from '@/lib/multiempresa';

export type SlaPlanningRow = {
  id?: string;
  clientId?: string;
  objectiveId?: string;
  objectiveName?: string;
  startDate?: unknown;
  endDate?: unknown;
  positions?: unknown;
  status?: string;
  [key: string]: unknown;
};

/** Contrato operativo activo (tolerante a mayúsculas / español). */
export function isSlaContractActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

function normObjectiveKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/** Claves posibles del objetivo seleccionado (id, nombre, variantes). */
export function objectiveMatchKeys(
  selectedObjective: string,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    keys.add(v);
    keys.add(normObjectiveKey(v));
  };
  const sel = String(selectedObjective ?? '').trim();
  if (!sel) return keys;
  add(sel);
  const obj = clientObjetivos?.find(
    (o) =>
      sel === String(o?.id ?? '').trim() ||
      sel === String(o?.name ?? '').trim() ||
      sel === String(o?.objectiveId ?? '').trim(),
  );
  if (obj) {
    add(obj.id);
    add(obj.objectiveId);
    add(obj.name);
    const targetName = normObjectiveKey(obj.name);
    if (targetName && clientObjetivos?.length) {
      for (const o of clientObjetivos) {
        if (normObjectiveKey(o?.name) !== targetName) continue;
        add(o.id);
        add(o.objectiveId);
        add(o.name);
      }
    }
  }
  return keys;
}

/** Mismo objetivo lógico aunque el SLA conserve un objectiveId distinto (restore / legacy). */
export function slaMatchesPlanningObjective(
  sla: SlaPlanningRow,
  selectedObjective: string,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
  slaIdToObjectiveId?: Record<string, string>,
): boolean {
  const keys = objectiveMatchKeys(selectedObjective, clientObjetivos);
  if (slaMatchesObjective(sla, keys, slaIdToObjectiveId)) return true;

  const sel = String(selectedObjective ?? '').trim();
  if (!sel || !clientObjetivos?.length) return false;

  const selObj =
    clientObjetivos.find(
      (o) =>
        sel === String(o?.id ?? '').trim() ||
        sel === String(o?.name ?? '').trim() ||
        sel === String(o?.objectiveId ?? '').trim(),
    ) ?? null;
  const selName = normObjectiveKey(selObj?.name ?? sel);
  const slaName = normObjectiveKey(sla.objectiveName);
  if (selName && slaName && selName === slaName) return true;

  const slaOid = String(sla.objectiveId ?? '').trim();
  if (!slaOid) return false;
  const slaLinked = clientObjetivos.find(
    (o) =>
      slaOid === String(o?.id ?? '').trim() ||
      slaOid === String(o?.objectiveId ?? '').trim() ||
      slaOid === String(o?.name ?? '').trim() ||
      normObjectiveKey(o?.name) === normObjectiveKey(slaOid),
  );
  if (slaLinked && selObj && normObjectiveKey(slaLinked.name) === normObjectiveKey(selObj.name)) {
    return true;
  }
  return false;
}

export function slaMatchesObjective(
  sla: SlaPlanningRow,
  keys: Set<string>,
  slaIdToObjectiveId?: Record<string, string>,
): boolean {
  const candidates = [
    sla.objectiveId,
    sla.objectiveName,
    sla.id && slaIdToObjectiveId?.[sla.id],
  ];
  return candidates.some((c) => {
    const v = String(c ?? '').trim();
    if (!v) return false;
    return keys.has(v) || keys.has(normObjectiveKey(v));
  });
}

export function filterSlasForPlanningTenant<T extends SlaPlanningRow>(
  rows: T[],
  empresaId: string,
  scopeEmpresa: boolean,
  clientIds: Set<string>,
): T[] {
  return filterSlaRowsByEmpresa(rows, empresaId, scopeEmpresa, clientIds);
}

export function pickSlaForPlanningMonth(
  matching: SlaPlanningRow[],
  year: number,
  month: number,
): { vigente: SlaPlanningRow | null; hasExactMatch: boolean; fallback: SlaPlanningRow | null } {
  const active = matching.filter((s) => isSlaContractActive(s.status));
  const pool = active.length > 0 ? active : matching;
  const overlapping = pool.filter((d) => slaCoversCalendarMonth(d.startDate, d.endDate, year, month));
  const vigente =
    overlapping.length > 0
      ? [...overlapping].sort((a, b) => toYyyyMmDd(b.startDate).localeCompare(toYyyyMmDd(a.startDate)))[0]
      : null;
  return { vigente, hasExactMatch: !!vigente, fallback: vigente };
}

export function formatSlaRangeHint(rows: SlaPlanningRow[]): string {
  if (!rows.length) return '';
  return rows
    .slice(0, 3)
    .map((s) => `${toYyyyMmDd(s.startDate) || '?'} → ${toYyyyMmDd(s.endDate) || '?'}`)
    .join(' · ');
}
