import type { ServiceSLA } from '@/services/slaService';
import type { ProformaDetailMode } from './proformaMode';
import type {
  ProformaBillingRow,
  PurchaseOrder,
  SlaBillingFields,
  SlaBillingMode,
} from './slaBilling.types';
import { DEFAULT_SLA_BILLING_MODE } from './slaBilling.types';

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

export function proformaDetailModeToBillingHint(mode: ProformaDetailMode): SlaBillingMode | null {
  if (mode === 'planned') return 'PLANIFICADO';
  if (mode === 'executed') return 'EJECUTADO';
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

function ocCoversPeriod(oc: PurchaseOrder, startYmd: string, endYmd: string): boolean {
  if (oc.status === 'INACTIVE') return false;
  return oc.startDate <= endYmd && oc.endDate >= startYmd;
}

function authorizedHoursForObjective(
  oc: PurchaseOrder,
  objectiveId: string,
  positionNames?: string[],
): number | undefined {
  const lines = oc.lines || [];
  if (lines.length === 0) return oc.authorizedHours;
  const oid = String(objectiveId || '').trim();
  const matching = lines.filter((l) => {
    if (l.objectiveId && String(l.objectiveId).trim() !== oid) return false;
    if (l.positionName && positionNames?.length) {
      return positionNames.some((p) => p === l.positionName);
    }
    return !l.positionName || !positionNames?.length;
  });
  if (matching.length === 0) {
    const objOnly = lines.filter((l) => String(l.objectiveId || '').trim() === oid);
    if (objOnly.length === 0) return oc.authorizedHours;
    const sum = objOnly.reduce((a, l) => a + (Number(l.authorizedHours) || 0), 0);
    return sum > 0 ? sum : oc.authorizedHours;
  }
  const sum = matching.reduce((a, l) => a + (Number(l.authorizedHours) || 0), 0);
  return sum > 0 ? sum : oc.authorizedHours;
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
};

export function buildProformaBillingRows(input: BuildProformaBillingInput): ProformaBillingRow[] {
  const rows: ProformaBillingRow[] = [];
  const ocById = new Map(input.purchaseOrders.map((o) => [o.id, o]));

  for (const srv of input.vigenteSlas) {
    const billing = slaBillingFields(srv, { clientHasOpenContract: input.clientHasOpenContract });
    const oid = String(srv.objectiveId ?? '').trim();
    const oName = String(srv.objectiveName ?? '').trim();
    const oKey = oName.toUpperCase();
    const useFranja = billing.billingMode === 'EJECUTADO' || billing.billingMode === 'ORDEN_COMPRA';
    const byId = useFranja ? input.franjaByObjectiveId : input.plannedByObjectiveId;
    const byName = useFranja ? input.franjaByObjectiveName : input.plannedByObjectiveName;
    const prestado = (oid && byId[oid]) ?? byName[oKey] ?? 0;

    let billable = prestado;
    let authorized: number | undefined;
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
        authorized = authorizedHoursForObjective(oc, oid);
        ocNumber = oc.ocNumber;
        ocId = oc.id;
        if (authorized != null && authorized >= 0) {
          billable = Math.min(Math.round(prestado), Math.round(authorized));
        }
      }
    }

    rows.push({
      objectiveId: oid,
      objectiveName: oName || oid || 'Objetivo',
      slaId: srv.id,
      billingMode: billing.billingMode,
      prestadoHours: Math.round(prestado),
      billableHours: Math.round(billable),
      authorizedHours: authorized != null ? Math.round(authorized) : undefined,
      balanceHours:
        authorized != null ? Math.max(0, Math.round(authorized) - Math.round(prestado)) : undefined,
      fixedMonthlyAmount: fixedAmount,
      ocNumber,
      ocId,
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
