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

/**
 * Techo de la OC para un objetivo en el período.
 * null = la OC no aplica (no hay tope). El reparto por línea vive en authorizedHoursForObjective.
 */
export function purchaseOrderAuthorizedHours(
  oc: PurchaseOrder | null | undefined,
  objectiveId: string,
  periodStartYmd: string,
  periodEndYmd: string,
): number | null {
  if (!oc || !ocCoversPeriod(oc, periodStartYmd, periodEndYmd)) return null;
  const hours = authorizedHoursForObjective(oc, objectiveId);
  return hours == null ? null : hours;
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
  /** null = sin tope de OC. */
  authorizedHours?: number | null;
};

/** Única fórmula de horas facturables. La usan la prefactura y el libro. */
export function billableHoursForContract(input: BillableContractInput): {
  billableHours: number;
  basisHours: number;
  authorizedHours?: number;
  balanceHours?: number;
} {
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
    const auth = input.authorizedHours;
    if (auth != null && Number.isFinite(Number(auth)) && Number(auth) >= 0) {
      const cap = r1Bill(Number(auth));
      return {
        billableHours: r1Bill(Math.min(covered, cap)),
        basisHours: r1Bill(covered),
        authorizedHours: cap,
        balanceHours: r1Bill(Math.max(0, cap - covered)),
      };
    }
    return { billableHours: r1Bill(covered), basisHours: r1Bill(covered) };
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
  /** Horas de servicio por objetivo. */
  slaByObjectiveId?: Record<string, number>;
  /** Horas trabajadas para el cliente. Si falta, Prestado queda en la base del modo. */
  workedByObjectiveId?: Record<string, number>;
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
    const planH = (oid && input.plannedByObjectiveId[oid]) ?? input.plannedByObjectiveName[oKey] ?? 0;
    const coveredH = (oid && input.franjaByObjectiveId[oid]) ?? input.franjaByObjectiveName[oKey] ?? 0;
    const useFranja = billing.billingMode === 'EJECUTADO' || billing.billingMode === 'ORDEN_COMPRA';
    const workedKnown = input.workedByObjectiveId;
    const prestado = workedKnown
      ? ((oid && workedKnown[oid]) || 0)
      : (useFranja ? coveredH : planH);

    let ocNumber: string | undefined;
    let ocId: string | undefined;
    let fixedAmount: number | undefined;
    let cap: number | null = null;

    if (billing.billingMode === 'FIJO') {
      fixedAmount = billing.billingFixedMonthlyAmount;
    } else if (billing.billingMode === 'ORDEN_COMPRA') {
      const ocRef = String(billing.billingPurchaseOrderId ?? '').trim();
      const oc = ocRef ? ocById.get(ocRef) : undefined;
      cap = purchaseOrderAuthorizedHours(oc, oid, input.periodStartYmd, input.periodEndYmd);
      if (oc && (cap != null || ocCoversPeriod(oc, input.periodStartYmd, input.periodEndYmd))) {
        ocNumber = oc.ocNumber;
        ocId = oc.id;
      }
    }

    const priced = billableHoursForContract({
      mode: billing.billingMode,
      planHours: planH,
      coveredHours: coveredH,
      fixedMonthlyHours: billing.billingFixedMonthlyHours,
      contractStart: ymdOf((srv as { startDate?: unknown }).startDate),
      contractEnd: ymdOf((srv as { endDate?: unknown }).endDate),
      periodStartYmd: input.periodStartYmd,
      periodEndYmd: input.periodEndYmd,
      authorizedHours: cap,
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
