import type { ServiceSLA } from '@/services/slaService';
import type { ProformaDetailMode } from './proformaMode';
import type {
  ProformaBillingRow,
  PurchaseOrder,
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
  const ocDemands = new Map<string, OcDemand[]>();
  const ocRowIdx = new Map<string, number[]>();

  for (const srv of input.vigenteSlas) {
    const contractBilling = slaBillingFields(srv, { clientHasOpenContract: input.clientHasOpenContract });
    const billing = input.modeOverride ? { ...contractBilling, billingMode: input.modeOverride } : contractBilling;
    const oid = String(srv.objectiveId ?? '').trim();
    const oName = String(srv.objectiveName ?? '').trim();
    const oKey = oName.toUpperCase();
    const useFranja = billing.billingMode === 'EJECUTADO' || billing.billingMode === 'ORDEN_COMPRA';
    const byId = useFranja ? input.franjaByObjectiveId : input.plannedByObjectiveId;
    const byName = useFranja ? input.franjaByObjectiveName : input.plannedByObjectiveName;
    const prestado = (oid && byId[oid]) ?? byName[oKey] ?? 0;

    let billable = prestado;
    let ocNumber: string | undefined;
    let ocId: string | undefined;
    let fixedAmount: number | undefined;

    if (billing.billingMode === 'FIJO') {
      const fixedH = Number(billing.billingFixedMonthlyHours);
      if (Number.isFinite(fixedH) && fixedH > 0) {
        billable = Math.round(fixedH);
      } else {
        billable = prestado;
      }
      fixedAmount = billing.billingFixedMonthlyAmount;
    } else if (billing.billingMode === 'ORDEN_COMPRA') {
      const ocRef = String(billing.billingPurchaseOrderId ?? '').trim();
      const oc = ocRef ? ocById.get(ocRef) : undefined;
      if (oc && ocCoversPeriod(oc, input.periodStartYmd, input.periodEndYmd)) {
        ocNumber = oc.ocNumber;
        ocId = oc.id;
        const list = ocDemands.get(oc.id) || [];
        list.push({ objectiveId: oid, prestadoHours: Math.round(prestado) });
        ocDemands.set(oc.id, list);
        const idx = ocRowIdx.get(oc.id) || [];
        idx.push(rows.length);
        ocRowIdx.set(oc.id, idx);
      }
    }

    rows.push({
      objectiveId: oid,
      objectiveName: oName || oid || 'Objetivo',
      slaId: srv.id,
      billingMode: billing.billingMode,
      prestadoHours: Math.round(prestado),
      billableHours: Math.round(billable),
      fixedMonthlyAmount: fixedAmount,
      ocNumber,
      ocId,
    });
  }

  // El tope de la OC se reparte entre todos los objetivos que la usan (GENERAL / POR_OBJETIVO / BOLSA).
  for (const [id, demands] of ocDemands) {
    const oc = ocById.get(id);
    if (!oc) continue;
    const summary = allocatePurchaseOrder(oc, demands);
    const byObjective = new Map(summary.byObjective.map((a) => [a.objectiveId, a]));
    for (const i of ocRowIdx.get(id) || []) {
      const row = rows[i];
      const alloc = byObjective.get(row.objectiveId);
      if (!alloc) continue;
      row.ocKind = summary.kind;
      row.billableHours = Math.round(alloc.billableHours);
      row.authorizedHours = alloc.authorizedHours != null ? Math.round(alloc.authorizedHours) : undefined;
      row.balanceHours = alloc.balanceHours != null ? Math.round(alloc.balanceHours) : undefined;
      row.ocFromUnassignedHours = alloc.fromUnassignedHours > 0 ? Math.round(alloc.fromUnassignedHours) : undefined;
    }
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
