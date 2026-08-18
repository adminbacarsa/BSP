/** Extracto mensual de horas (cuenta corriente SLA vs plan vs real). */

export const HOURS_BALANCE_COLLECTION = 'hours_balances';

export type HoursBalanceSource = 'planning' | 'sla' | 'crm-bootstrap' | 'manual';

export type HoursBalanceRow = {
  empresaId: string;
  objectiveId: string;
  objectiveName: string;
  clientId: string;
  clientName: string;
  year: number;
  month: number;
  periodKey: string;
  /** Debe: horas vendidas SLA del mes. */
  slaHours: number;
  /** Haber plan: cobertura planificada (base, sin extra ext/adel). */
  plannedHours: number;
  vacantHours: number;
  /** Haber real: horas fichadas (misma regla que CRM). */
  realHours: number;
  ftHours: number;
  extHours: number;
  adelHours: number;
  opsHours: number;
  absenceHours: number;
  /** Plan + ext + adel + FT + ops. */
  resultante: number;
  /** SLA − planificado. Positivo = faltante de cobertura. */
  saldoPlan: number;
  /** SLA − real. Positivo = faltante de ejecución. */
  saldoReal: number;
  rebuiltFrom: HoursBalanceSource;
};

export function hoursBalancePeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function hoursBalanceDocId(empresaId: string, objectiveId: string, year: number, month: number): string {
  const emp = String(empresaId || '').trim() || 'sin-empresa';
  const oid = String(objectiveId || '').trim() || 'sin-obj';
  return `${emp}_${oid}_${hoursBalancePeriodKey(year, month)}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
