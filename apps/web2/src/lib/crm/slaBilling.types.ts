/**
 * Modo de facturación por contrato (servicios_sla.billingMode).
 *
 * ORDEN DE COMPRA — modelo de datos (Firestore):
 * Colección `ordenes_compra` (no embebido en el SLA: un cliente tiene muchas OC en el tiempo,
 * vigencias distintas y auditoría independiente del versionado de contrato).
 *
 * Doc `ordenes_compra/{id}`:
 * - empresaId, clientId
 * - ocNumber: string (número oficial del cliente)
 * - startDate, endDate: YYYY-MM-DD
 * - status: 'ACTIVE' | 'INACTIVE' (soft delete) | 'CANCELLED' (anulada; no se borra)
 * - cancelledAt / cancelledBy: solo si status es CANCELLED
 * - kind?: 'GENERAL' | 'POR_OBJETIVO' | 'BOLSA' (tipo de tope; legacy sin kind: lines → POR_OBJETIVO, si no GENERAL)
 *   GENERAL      = un tope total único (authorizedHours) que consumen todos los objetivos que usan la OC.
 *   POR_OBJETIVO = horas por objetivo (lines); el total es la suma de las líneas.
 *   BOLSA        = total fijo (authorizedHours) + asignación por objetivo (lines); lo sin asignar queda
 *                  disponible y, si BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE, lo consume cualquier objetivo
 *                  que agotó su asignación. Nunca se supera el total.
 * - authorizedHours?: number (techo total: GENERAL y BOLSA)
 * - authorizedAmount?: number (techo en ARS, opcional si facturan por monto)
 * - currency?: 'ARS'
 * - lines?: Array<{ objectiveId?, positionName?, authorizedHours?, authorizedAmount? }>
 *   (POR_OBJETIVO y BOLSA: horas por objetivo)
 * - notes?: string
 *
 * SLA en modo ORDEN_COMPRA: billingPurchaseOrderId → doc anterior.
 * La prefactura factura min(prestado, autorizado) y muestra saldo (ver purchaseOrderAllocation.ts).
 * "Prestado" en ORDEN_COMPRA = horas cubiertas por franja (executedBillableHoursByFranja),
 * el mismo criterio que billingMode EJECUTADO: no es el plan ni el reloj crudo.
 */
export type SlaBillingMode = 'PLANIFICADO' | 'EJECUTADO' | 'FIJO' | 'ORDEN_COMPRA';

export const DEFAULT_SLA_BILLING_MODE: SlaBillingMode = 'PLANIFICADO';

export type PurchaseOrderKind = 'GENERAL' | 'POR_OBJETIVO' | 'BOLSA';

export type PurchaseOrderLine = {
  objectiveId?: string;
  positionName?: string;
  authorizedHours?: number;
  authorizedAmount?: number;
};

export type PurchaseOrder = {
  id: string;
  empresaId: string;
  clientId: string;
  ocNumber: string;
  startDate: string;
  endDate: string;
  status: 'ACTIVE' | 'INACTIVE' | 'CANCELLED';
  kind?: PurchaseOrderKind;
  authorizedHours?: number;
  authorizedAmount?: number;
  currency?: 'ARS';
  lines?: PurchaseOrderLine[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

export type SlaBillingFields = {
  /** null / ausente = Auto según el contrato comercial del cliente (ver resolveSlaBillingMode). */
  billingMode?: SlaBillingMode | null;
  /** FIJO: horas a facturar por mes calendario (independiente de malla). */
  billingFixedMonthlyHours?: number;
  /** FIJO: monto fijo mensual (si se usa monto en lugar de horas × tarifa). */
  billingFixedMonthlyAmount?: number;
  /** ORDEN_COMPRA: referencia a ordenes_compra/{id}. */
  billingPurchaseOrderId?: string;
};

export type ProformaBillingRow = {
  objectiveId: string;
  objectiveName: string;
  slaId?: string;
  billingMode: SlaBillingMode;
  /** Horas prestadas (plan/ejec/fijo teórico) antes de tope OC. */
  prestadoHours: number;
  /** Horas (o equivalente) a facturar en el período. */
  billableHours: number;
  authorizedHours?: number;
  balanceHours?: number;
  fixedMonthlyAmount?: number;
  ocNumber?: string;
  ocId?: string;
  ocKind?: PurchaseOrderKind;
  /** BOLSA: horas tomadas de lo sin asignar de la OC para este objetivo. */
  ocFromUnassignedHours?: number;
};
