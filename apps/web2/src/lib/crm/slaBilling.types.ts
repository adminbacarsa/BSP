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
 * - status: 'ACTIVE' | 'INACTIVE' (soft delete)
 * - authorizedHours?: number (techo global del período)
 * - authorizedAmount?: number (techo en ARS, opcional si facturan por monto)
 * - currency?: 'ARS'
 * - lines?: Array<{ objectiveId?, positionName?, authorizedHours?, authorizedAmount? }>
 *   (opcional: reparte el techo por objetivo/puesto; si falta, usa authorizedHours global)
 * - notes?: string
 *
 * SLA en modo ORDEN_COMPRA: billingPurchaseOrderId → doc anterior.
 * La prefactura factura min(prestado, autorizado) y muestra saldo.
 * "Prestado" en ORDEN_COMPRA = horas cubiertas por franja (executedBillableHoursByFranja),
 * el mismo criterio que billingMode EJECUTADO: no es el plan ni el reloj crudo.
 */
export type SlaBillingMode = 'PLANIFICADO' | 'EJECUTADO' | 'FIJO' | 'ORDEN_COMPRA';

export const DEFAULT_SLA_BILLING_MODE: SlaBillingMode = 'PLANIFICADO';

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
  status: 'ACTIVE' | 'INACTIVE';
  authorizedHours?: number;
  authorizedAmount?: number;
  currency?: 'ARS';
  lines?: PurchaseOrderLine[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
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
  /** Horas de servicio (SLA) del período. */
  slaHours?: number;
  /** Horas trabajadas para el cliente. Sin mapa de trabajadas, queda la base del modo (plan o franja). */
  prestadoHours: number;
  /** Horas a facturar en el período, según el modo del contrato. */
  billableHours: number;
  /** prestado − facturado. Positivo: se trabajó más de lo que se cobra. */
  diferenciaHours?: number;
  authorizedHours?: number;
  balanceHours?: number;
  fixedMonthlyAmount?: number;
  ocNumber?: string;
  ocId?: string;
};
