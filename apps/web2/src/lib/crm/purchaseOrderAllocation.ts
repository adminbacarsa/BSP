import type { PurchaseOrder, PurchaseOrderKind } from './slaBilling.types';

/**
 * BOLSA: cuando un objetivo agota su asignación puede seguir consumiendo lo SIN ASIGNAR de la OC.
 * En false, lo sin asignar solo se usa reasignándolo a mano (editar la OC).
 */
export const BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE = true;

/** Umbrales de aviso de consumo (fracción del tope). */
export const OC_WARN_RATIO = 0.8;
export const OC_FULL_RATIO = 1;

export type OcDemand = { objectiveId: string; prestadoHours: number };

export type OcObjectiveAllocation = {
  objectiveId: string;
  /** Horas de la línea del objetivo (POR_OBJETIVO / BOLSA). GENERAL: undefined. */
  assignedHours?: number;
  /** Tope efectivo aplicado a este objetivo (GENERAL: total compartido; BOLSA: asignado + tomado de la bolsa). */
  authorizedHours?: number;
  consumedHours: number;
  billableHours: number;
  fromUnassignedHours: number;
  /** Saldo del objetivo dentro de su tope efectivo. GENERAL: saldo compartido de la OC. */
  balanceHours?: number;
  /** consumido / tope propio (GENERAL: sobre el total). undefined sin tope. */
  ratio?: number;
};

export type OcAllocationSummary = {
  kind: PurchaseOrderKind;
  totalHours?: number;
  assignedHours: number;
  /** BOLSA: lo que queda sin asignar después de repartir; GENERAL: total menos facturado. */
  unassignedHours?: number;
  consumedHours: number;
  billableHours: number;
  balanceHours?: number;
  ratio?: number;
  byObjective: OcObjectiveAllocation[];
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function resolvePurchaseOrderKind(oc: Pick<PurchaseOrder, 'kind' | 'lines'>): PurchaseOrderKind {
  if (oc.kind === 'GENERAL' || oc.kind === 'POR_OBJETIVO' || oc.kind === 'BOLSA') return oc.kind;
  return (oc.lines?.length ?? 0) > 0 ? 'POR_OBJETIVO' : 'GENERAL';
}

export function purchaseOrderKindLabel(kind: PurchaseOrderKind): string {
  switch (kind) {
    case 'GENERAL':
      return 'General (tope único)';
    case 'POR_OBJETIVO':
      return 'Por objetivo';
    case 'BOLSA':
      return 'Bolsa a repartir';
    default:
      return kind;
  }
}

/** Horas de línea del objetivo (suma de todas sus líneas). undefined si no tiene línea. */
export function purchaseOrderLineHours(oc: Pick<PurchaseOrder, 'lines'>, objectiveId: string): number | undefined {
  const oid = String(objectiveId || '').trim();
  if (!oid) return undefined;
  const mine = (oc.lines || []).filter((l) => String(l.objectiveId || '').trim() === oid);
  if (mine.length === 0) return undefined;
  return mine.reduce((a, l) => a + (num(l.authorizedHours) ?? 0), 0);
}

export function purchaseOrderAssignedHours(oc: Pick<PurchaseOrder, 'kind' | 'lines'>): number {
  if (resolvePurchaseOrderKind(oc) === 'GENERAL') return 0;
  return (oc.lines || []).reduce((a, l) => a + (num(l.authorizedHours) ?? 0), 0);
}

/** Tope total de la OC según su tipo. undefined = sin techo cargado. */
export function purchaseOrderTotalHours(oc: Pick<PurchaseOrder, 'kind' | 'lines' | 'authorizedHours'>): number | undefined {
  const kind = resolvePurchaseOrderKind(oc);
  if (kind === 'POR_OBJETIVO') {
    const sum = purchaseOrderAssignedHours(oc);
    return (oc.lines?.length ?? 0) > 0 ? sum : num(oc.authorizedHours);
  }
  return num(oc.authorizedHours);
}

/**
 * Tope de un objetivo mirado en aislamiento (sin el consumo de los demás).
 * GENERAL → total; POR_OBJETIVO → línea (sin línea: sin tope, legacy); BOLSA → asignado + bolsa si se comparte.
 */
export function authorizedHoursForObjective(oc: PurchaseOrder, objectiveId: string): number | undefined {
  const kind = resolvePurchaseOrderKind(oc);
  const total = purchaseOrderTotalHours(oc);
  if (kind === 'GENERAL') return total;
  const line = purchaseOrderLineHours(oc, objectiveId);
  if (kind === 'POR_OBJETIVO') return line ?? num(oc.authorizedHours);
  const assigned = line ?? 0;
  if (total == null) return line;
  const unassigned = Math.max(0, total - purchaseOrderAssignedHours(oc));
  return BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE ? assigned + unassigned : assigned;
}

/**
 * Reparte el consumo del período entre los objetivos que usan la OC respetando el tipo.
 * Determinístico: las demandas se procesan ordenadas por objectiveId.
 */
export function allocatePurchaseOrder(oc: PurchaseOrder, demandsIn: OcDemand[]): OcAllocationSummary {
  const kind = resolvePurchaseOrderKind(oc);
  const total = purchaseOrderTotalHours(oc);
  const demands = [...demandsIn]
    .map((d) => ({ objectiveId: String(d.objectiveId || '').trim(), prestadoHours: Math.max(0, Number(d.prestadoHours) || 0) }))
    .sort((a, b) => a.objectiveId.localeCompare(b.objectiveId));
  const consumed = demands.reduce((a, d) => a + d.prestadoHours, 0);
  const byObjective: OcObjectiveAllocation[] = [];

  if (kind === 'GENERAL') {
    let remaining = total;
    for (const d of demands) {
      const billable = remaining == null ? d.prestadoHours : Math.min(d.prestadoHours, remaining);
      if (remaining != null) remaining = Math.max(0, remaining - billable);
      byObjective.push({
        objectiveId: d.objectiveId,
        authorizedHours: total,
        consumedHours: d.prestadoHours,
        billableHours: billable,
        fromUnassignedHours: 0,
      });
    }
    for (const row of byObjective) {
      row.balanceHours = remaining;
      row.ratio = total ? consumed / total : undefined;
    }
    const billable = byObjective.reduce((a, r) => a + r.billableHours, 0);
    return {
      kind,
      totalHours: total,
      assignedHours: 0,
      unassignedHours: remaining,
      consumedHours: round1(consumed),
      billableHours: round1(billable),
      balanceHours: remaining,
      ratio: total ? consumed / total : undefined,
      byObjective,
    };
  }

  if (kind === 'POR_OBJETIVO') {
    for (const d of demands) {
      const line = purchaseOrderLineHours(oc, d.objectiveId);
      const cap = line ?? num(oc.authorizedHours);
      const billable = cap == null ? d.prestadoHours : Math.min(d.prestadoHours, cap);
      byObjective.push({
        objectiveId: d.objectiveId,
        assignedHours: line,
        authorizedHours: cap,
        consumedHours: d.prestadoHours,
        billableHours: billable,
        fromUnassignedHours: 0,
        balanceHours: cap == null ? undefined : Math.max(0, cap - d.prestadoHours),
        ratio: cap ? d.prestadoHours / cap : undefined,
      });
    }
    const billable = byObjective.reduce((a, r) => a + r.billableHours, 0);
    const assigned = purchaseOrderAssignedHours(oc);
    return {
      kind,
      totalHours: total,
      assignedHours: assigned,
      unassignedHours: 0,
      consumedHours: round1(consumed),
      billableHours: round1(billable),
      balanceHours: total == null ? undefined : Math.max(0, total - billable),
      ratio: total ? consumed / total : undefined,
      byObjective,
    };
  }

  // BOLSA
  const assigned = purchaseOrderAssignedHours(oc);
  let unassigned = total == null ? undefined : Math.max(0, total - assigned);
  const overflow = new Map<string, number>();
  for (const d of demands) {
    const line = purchaseOrderLineHours(oc, d.objectiveId) ?? 0;
    const inAssignment = Math.min(d.prestadoHours, line);
    overflow.set(d.objectiveId, d.prestadoHours - inAssignment);
    byObjective.push({
      objectiveId: d.objectiveId,
      assignedHours: line,
      authorizedHours: line,
      consumedHours: d.prestadoHours,
      billableHours: inAssignment,
      fromUnassignedHours: 0,
    });
  }
  if (BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE) {
    for (const row of byObjective) {
      const extra = overflow.get(row.objectiveId) || 0;
      if (extra <= 0) continue;
      const take = unassigned == null ? extra : Math.min(extra, unassigned);
      if (take <= 0) continue;
      row.fromUnassignedHours = take;
      row.billableHours += take;
      row.authorizedHours = (row.authorizedHours ?? 0) + take;
      if (unassigned != null) unassigned = Math.max(0, unassigned - take);
    }
  }
  for (const row of byObjective) {
    const cap = row.authorizedHours ?? 0;
    row.balanceHours = Math.max(0, cap - row.consumedHours);
    const own = row.assignedHours || 0;
    row.ratio = own > 0 ? row.consumedHours / own : (cap > 0 ? row.consumedHours / cap : undefined);
  }
  const billable = byObjective.reduce((a, r) => a + r.billableHours, 0);
  return {
    kind,
    totalHours: total,
    assignedHours: assigned,
    unassignedHours: unassigned,
    consumedHours: round1(consumed),
    billableHours: round1(billable),
    balanceHours: total == null ? undefined : Math.max(0, total - billable),
    ratio: total ? consumed / total : undefined,
    byObjective,
  };
}

export type OcConsumptionLevel = 'ok' | 'warn' | 'full';

export function ocConsumptionLevel(ratio: number | undefined): OcConsumptionLevel {
  if (ratio == null) return 'ok';
  if (ratio >= OC_FULL_RATIO) return 'full';
  if (ratio >= OC_WARN_RATIO) return 'warn';
  return 'ok';
}
