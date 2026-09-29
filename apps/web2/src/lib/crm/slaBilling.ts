import type { ServiceSLA } from '@/services/slaService';
import type { ProformaDetailMode } from './proformaMode';
import type {
  ProformaBillingRow,
  PurchaseOrder,
  PurchaseOrderKind,
  SlaBillingFields,
  SlaBillingMode,
} from './slaBilling.types';
import { DEFAULT_SLA_BILLING_MODE } from './slaBilling.types';
import { allocatePurchaseOrder, authorizedHoursForObjective, type OcDemand } from './purchaseOrderAllocation';

export { authorizedHoursForObjective };

export function normalizeSlaBillingMode(raw: unknown): SlaBillingMode {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'EJECUTADO' || v === 'FIJO' || v === 'ORDEN_COMPRA' || v === 'PLANIFICADO') return v;
  return DEFAULT_SLA_BILLING_MODE;
}

export function hasExplicitSlaBillingMode(srv: SlaBillingFields): boolean {
  const v = String(srv.billingMode ?? '').trim().toUpperCase();
  return v === 'EJECUTADO' || v === 'FIJO' || v === 'ORDEN_COMPRA' || v === 'PLANIFICADO';
}

/** Contexto comercial del cliente (colección `contracts`) para SLAs sin billingMode propio. */
export type SlaBillingContext = {
  clientHasOpenContract?: boolean;
};

/** Criterio previo a billingMode: un contrato comercial `abierto` factura lo ejecutado. */
export function clientHasOpenCommercialContract(
  contracts: Array<{ type?: unknown; status?: unknown }> | null | undefined,
): boolean {
  return (contracts || []).some(
    (c) => String(c?.type ?? '') === 'abierto' && String(c?.status ?? '').toUpperCase() !== 'INACTIVE',
  );
}

/**
 * Modo efectivo del contrato: el billingMode del SLA manda; sin billingMode,
 * contrato comercial abierto → EJECUTADO, si no PLANIFICADO.
 */
export function resolveSlaBillingMode(srv: SlaBillingFields, ctx: SlaBillingContext = {}): SlaBillingMode {
  if (hasExplicitSlaBillingMode(srv)) return normalizeSlaBillingMode(srv.billingMode);
  return ctx.clientHasOpenContract ? 'EJECUTADO' : DEFAULT_SLA_BILLING_MODE;
}

export function slaBillingFields(
  srv: ServiceSLA & SlaBillingFields,
  ctx: SlaBillingContext = {},
): Required<Pick<SlaBillingFields, 'billingMode'>> & SlaBillingFields {
  return {
    billingMode: resolveSlaBillingMode(srv, ctx),
    billingFixedMonthlyHours: srv.billingFixedMonthlyHours,
    billingFixedMonthlyAmount: srv.billingFixedMonthlyAmount,
    billingPurchaseOrderId: srv.billingPurchaseOrderId,
  };
}

/**
 * Modo de grilla prefactura derivado del contrato (sin override manual).
 * ORDEN_COMPRA factura lo prestado por franja (igual que EJECUTADO); FIJO muestra la malla.
 */
export function billingModeToProformaDetailMode(mode: SlaBillingMode): 'planned' | 'executed' {
  return mode === 'EJECUTADO' || mode === 'ORDEN_COMPRA' ? 'executed' : 'planned';
}

/** Modo de contrato forzado por el selector Detalle horas; null = Auto (cada contrato con el suyo). */
export function proformaDetailModeToBillingHint(mode: ProformaDetailMode): SlaBillingMode | null {
  if (mode === 'planned') return 'PLANIFICADO';
  if (mode === 'executed') return 'EJECUTADO';
  if (mode === 'fijo') return 'FIJO';
  if (mode === 'orden_compra') return 'ORDEN_COMPRA';
  return null;
}

/** Etiqueta del modo que realmente aplica a un SLA sin billingMode propio. */
export function autoBillingModeLabel(ctx: SlaBillingContext): string {
  return ctx.clientHasOpenContract ? 'Auto: ejecutado (contrato abierto)' : 'Auto: planificado';
}

export function billingModeLabel(mode: SlaBillingMode): string {
  switch (mode) {
    case 'PLANIFICADO':
      return 'Planificado';
    case 'EJECUTADO':
      return 'Ejecutado';
    case 'FIJO':
      return 'Fijo';
    case 'ORDEN_COMPRA':
      return 'Orden de compra';
    default:
      return mode;
  }
}

export function ocCoversPeriod(oc: PurchaseOrder, startYmd: string, endYmd: string): boolean {
  if (oc.status === 'INACTIVE' || oc.status === 'CANCELLED') return false;
  return oc.startDate <= endYmd && oc.endDate >= startYmd;
}

function ymdOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  const d = typeof o.toDate === 'function'
    ? o.toDate()
    : (typeof (o.seconds ?? o._seconds) === 'number' ? new Date(((o.seconds ?? o._seconds) as number) * 1000) : null);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dayCount(fromYmd: string, toYmd: string): number {
  if (!fromYmd || !toYmd || fromYmd > toYmd) return 0;
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

const r1Bill = (n: number) => Math.round((Number(n) || 0) * 10) / 10;

/** Horas fijas del mes, prorrateadas si la vigencia no cubre el período entero. */
export function prorateFixedMonthlyHours(
  fixedMonthlyHours: number,
  contractStart: string,
  contractEnd: string,
  periodStart: string,
  periodEnd: string,
): number {
  const fixed = Number(fixedMonthlyHours) || 0;
  if (!(fixed > 0)) return 0;
  const periodDays = dayCount(periodStart, periodEnd);
  if (!(periodDays > 0)) return 0;
  const start = contractStart && contractStart > periodStart ? contractStart : periodStart;
  const end = contractEnd && contractEnd < periodEnd ? contractEnd : periodEnd;
  const valid = dayCount(start, end);
  if (!(valid > 0)) return 0;
  if (valid >= periodDays) return r1Bill(fixed);
  return r1Bill((fixed * valid) / periodDays);
}

export type BillableContractInput = {
  mode: SlaBillingMode;
  /** PLANIFICADO: plan publicado. */
  planHours: number;
  /** EJECUTADO y base de ORDEN_COMPRA: cubiertas por franja. */
  coveredHours: number;
  fixedMonthlyHours?: number | null;
  contractStart?: string;
  contractEnd?: string;
  periodStartYmd: string;
  periodEndYmd: string;
  /** ORDEN_COMPRA: la OC del contrato. Sin OC vigente se factura lo cubierto sin tope. */
  purchaseOrder?: PurchaseOrder | null;
  /** ORDEN_COMPRA: objetivo de esta fila dentro del reparto. */
  objectiveId?: string;
  /**
   * ORDEN_COMPRA: consumo de TODOS los objetivos que usan la misma OC en el período
   * (incluido este). El tope se reparte con allocatePurchaseOrder.
   */
  ocDemands?: OcDemand[];
};

export type BillableContractResult = {
  billableHours: number;
  basisHours: number;
  authorizedHours?: number;
  balanceHours?: number;
  ocKind?: PurchaseOrderKind;
  ocFromUnassignedHours?: number;
};

/** Única fórmula de horas facturables. La usan la prefactura y el libro. */
export function billableHoursForContract(input: BillableContractInput): BillableContractResult {
  const plan = Math.max(0, Number(input.planHours) || 0);
  const covered = Math.max(0, Number(input.coveredHours) || 0);
  if (input.mode === 'EJECUTADO') {
    return { billableHours: r1Bill(covered), basisHours: r1Bill(covered) };
  }
  if (input.mode === 'FIJO') {
    const fixed = prorateFixedMonthlyHours(
      Number(input.fixedMonthlyHours) || 0,
      String(input.contractStart || ''),
      String(input.contractEnd || ''),
      input.periodStartYmd,
      input.periodEndYmd,
    );
    const billable = fixed > 0 ? fixed : r1Bill(plan);
    return { billableHours: billable, basisHours: billable };
  }
  if (input.mode === 'ORDEN_COMPRA') {
    const oc = input.purchaseOrder;
    if (!oc || !ocCoversPeriod(oc, input.periodStartYmd, input.periodEndYmd)) {
      return { billableHours: r1Bill(covered), basisHours: r1Bill(covered) };
    }
    const oid = String(input.objectiveId || '').trim();
    const demands = input.ocDemands?.length
      ? input.ocDemands
      : [{ objectiveId: oid, prestadoHours: covered }];
    const summary = allocatePurchaseOrder(oc, demands);
    const alloc = summary.byObjective.find((a) => a.objectiveId === oid);
    if (!alloc) return { billableHours: r1Bill(covered), basisHours: r1Bill(covered), ocKind: summary.kind };
    return {
      billableHours: r1Bill(alloc.billableHours),
      basisHours: r1Bill(covered),
      authorizedHours: alloc.authorizedHours != null ? r1Bill(alloc.authorizedHours) : undefined,
      balanceHours: alloc.balanceHours != null ? r1Bill(alloc.balanceHours) : undefined,
      ocKind: summary.kind,
      ocFromUnassignedHours: alloc.fromUnassignedHours > 0 ? r1Bill(alloc.fromUnassignedHours) : undefined,
    };
  }
  return { billableHours: r1Bill(plan), basisHours: r1Bill(plan) };
}

export function billableGaps(worked: number, billable: number) {
  const w = Number(worked) || 0;
  const b = Number(billable) || 0;
  return {
    workedNotBilled: r1Bill(Math.max(0, w - b)),
    billedNotWorked: r1Bill(Math.max(0, b - w)),
  };
}

export type BuildProformaBillingInput = {
  vigenteSlas: (ServiceSLA & { id: string } & SlaBillingFields)[];
  purchaseOrders: PurchaseOrder[];
  periodStartYmd: string;
  periodEndYmd: string;
  /** PLANIFICADO: horas de malla planificada. */
  plannedByObjectiveId: Record<string, number>;
  plannedByObjectiveName: Record<string, number>;
  /**
   * EJECUTADO y ORDEN_COMPRA: horas cubiertas por franja (tope de banda, sin doble turno+ops_cov).
   * Es el "prestado" de la OC.
   */
  franjaByObjectiveId: Record<string, number>;
  franjaByObjectiveName: Record<string, number>;
  /** Horas de servicio por objetivo. */
  slaByObjectiveId?: Record<string, number>;
  /** Horas trabajadas para el cliente. Si falta, Prestado queda en la base del modo. */
  workedByObjectiveId?: Record<string, number>;
  clientHasOpenContract?: boolean;
  /**
   * Modo forzado desde el selector Detalle horas de la prefactura. null/ausente = Auto:
   * cada contrato factura con su propio modo. FIJO sin horas fijas en el contrato factura lo
   * planificado; ORDEN_COMPRA sin OC (o con OC que no cubre el período) factura lo ejecutado sin tope.
   */
  modeOverride?: SlaBillingMode | null;
};

export function buildProformaBillingRows(input: BuildProformaBillingInput): ProformaBillingRow[] {
  const rows: ProformaBillingRow[] = [];
  const ocById = new Map(input.purchaseOrders.map((o) => [o.id, o]));

  const prepared = input.vigenteSlas.map((srv) => {
    const contractBilling = slaBillingFields(srv, { clientHasOpenContract: input.clientHasOpenContract });
    const billing = input.modeOverride ? { ...contractBilling, billingMode: input.modeOverride } : contractBilling;
    const oid = String(srv.objectiveId ?? '').trim();
    const oName = String(srv.objectiveName ?? '').trim();
    const oKey = oName.toUpperCase();
    const planH = (oid && input.plannedByObjectiveId[oid]) ?? input.plannedByObjectiveName[oKey] ?? 0;
    const coveredH = (oid && input.franjaByObjectiveId[oid]) ?? input.franjaByObjectiveName[oKey] ?? 0;
    let oc: PurchaseOrder | undefined;
    if (billing.billingMode === 'ORDEN_COMPRA') {
      const ocRef = String(billing.billingPurchaseOrderId ?? '').trim();
      const found = ocRef ? ocById.get(ocRef) : undefined;
      if (found && ocCoversPeriod(found, input.periodStartYmd, input.periodEndYmd)) oc = found;
    }
    return { srv, billing, oid, oName, planH, coveredH, oc };
  });

  const ocDemands = new Map<string, OcDemand[]>();
  for (const p of prepared) {
    if (!p.oc) continue;
    const list = ocDemands.get(p.oc.id) || [];
    list.push({ objectiveId: p.oid, prestadoHours: p.coveredH });
    ocDemands.set(p.oc.id, list);
  }

  for (const p of prepared) {
    const { srv, billing, oid, oName, planH, coveredH, oc } = p;
    const useFranja = billing.billingMode === 'EJECUTADO' || billing.billingMode === 'ORDEN_COMPRA';
    const workedKnown = input.workedByObjectiveId;
    const prestado = workedKnown
      ? ((oid && workedKnown[oid]) || 0)
      : (useFranja ? coveredH : planH);

    const priced = billableHoursForContract({
      mode: billing.billingMode,
      planHours: planH,
      coveredHours: coveredH,
      fixedMonthlyHours: billing.billingFixedMonthlyHours,
      contractStart: ymdOf((srv as { startDate?: unknown }).startDate),
      contractEnd: ymdOf((srv as { endDate?: unknown }).endDate),
      periodStartYmd: input.periodStartYmd,
      periodEndYmd: input.periodEndYmd,
      purchaseOrder: oc ?? null,
      objectiveId: oid,
      ocDemands: oc ? ocDemands.get(oc.id) : undefined,
    });

    const prestadoR = r1Bill(prestado);
    rows.push({
      objectiveId: oid,
      objectiveName: oName || oid || 'Objetivo',
      slaId: srv.id,
      billingMode: billing.billingMode,
      slaHours: r1Bill((oid && input.slaByObjectiveId?.[oid]) || 0),
      prestadoHours: prestadoR,
      billableHours: priced.billableHours,
      diferenciaHours: r1Bill(prestadoR - priced.billableHours),
      authorizedHours: priced.authorizedHours,
      balanceHours: priced.balanceHours,
      fixedMonthlyAmount: billing.billingMode === 'FIJO' ? billing.billingFixedMonthlyAmount : undefined,
      ocNumber: oc?.ocNumber,
      ocId: oc?.id,
      ocKind: priced.ocKind,
      ocFromUnassignedHours: priced.ocFromUnassignedHours,
    });
  }

  return rows.sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

export type ClientProformaDetailModes = {
  /** Modo del encabezado (el más frecuente entre contratos vigentes); objetivos sin SLA usan este. */
  mode: 'planned' | 'executed';
  mixed: boolean;
  dominant: SlaBillingMode;
  /** Modo Auto de la grilla por objetivo: cada objetivo sigue a su contrato. */
  byObjectiveId: Record<string, 'planned' | 'executed'>;
  /** Clave = nombre de objetivo normalizado (trim, espacios simples, mayúsculas). */
  byObjectiveName: Record<string, 'planned' | 'executed'>;
};

export function normalizeBillingObjectiveKey(name: unknown): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function resolveClientDefaultProformaDetailMode(
  slas: (ServiceSLA & SlaBillingFields)[],
  ctx: SlaBillingContext = {},
): ClientProformaDetailModes {
  const counts = new Map<SlaBillingMode, number>();
  const byObjectiveId: Record<string, 'planned' | 'executed'> = {};
  const byObjectiveName: Record<string, 'planned' | 'executed'> = {};
  for (const s of slas) {
    const billingMode = slaBillingFields(s, ctx).billingMode;
    counts.set(billingMode, (counts.get(billingMode) || 0) + 1);
    const detail = billingModeToProformaDetailMode(billingMode);
    const oid = String(s.objectiveId ?? '').trim();
    const oKey = normalizeBillingObjectiveKey(s.objectiveName);
    // Dos contratos vigentes en el mismo objetivo con modos distintos: se muestra lo ejecutado.
    if (oid) byObjectiveId[oid] = byObjectiveId[oid] === 'executed' ? 'executed' : detail;
    if (oKey) byObjectiveName[oKey] = byObjectiveName[oKey] === 'executed' ? 'executed' : detail;
  }
  const fallback: SlaBillingMode = ctx.clientHasOpenContract ? 'EJECUTADO' : DEFAULT_SLA_BILLING_MODE;
  let dominant: SlaBillingMode = fallback;
  let best = 0;
  for (const [m, n] of counts) {
    if (n > best) {
      dominant = m;
      best = n;
    }
  }
  return {
    mode: billingModeToProformaDetailMode(dominant),
    mixed: counts.size > 1,
    dominant,
    byObjectiveId,
    byObjectiveName,
  };
}

/** ¿El modo Auto de la grilla usa lo ejecutado para este turno? Sigue al contrato de su objetivo. */
export function autoDetailUsesExecutedForObjective(
  modes: Pick<ClientProformaDetailModes, 'mode' | 'byObjectiveId' | 'byObjectiveName'>,
  objectiveId: unknown,
  objectiveName: unknown,
): boolean {
  const oid = String(objectiveId ?? '').trim();
  const byId = oid ? modes.byObjectiveId[oid] : undefined;
  const byName = modes.byObjectiveName[normalizeBillingObjectiveKey(objectiveName)];
  return (byId ?? byName ?? modes.mode) === 'executed';
}

export function sumBillableContractHours(rows: ProformaBillingRow[]): number {
  return rows.reduce((a, r) => a + r.billableHours, 0);
}
