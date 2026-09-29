export type LedgerPlanMode = 'published' | 'draft' | 'both';

export function assignWorkedShares(
  total: number,
  weights: Record<string, number>,
  inOperation: ReadonlySet<string>,
): {
  worked: number;
  workedOutside: number;
  rows: Array<{ objectiveId: string; worked: number; workedOutside: number }>;
};

export function planHoursOf(
  mode: LedgerPlanMode,
  row: { planPublished: number; planDraft: number },
): number;

export function personaMonthWorked(input: {
  turnos: any[];
  ausencias: any[];
  publishStatusMap: Record<string, boolean>;
  year: number;
  month: number;
  hoursCoreEnabled: boolean;
  empNameById: Record<string, string>;
}): {
  worked: number;
  weights: Record<string, number>;
  parts: Array<{ employeeId: string; objectiveId: string; date: string; worked: number; ft: number; ext: number; adv: number }>;
};

export function jornadaPagada(t: any): number;

export function applyBillableOnRows(rows: Array<{
  objectiveId?: string;
  periodKey?: string;
  billingMode?: string;
  planPublished?: number;
  covered?: number;
  worked?: number;
  billingFixedHours?: number;
  billingPurchaseOrderId?: string;
  billingAuthorizedHours?: number;
  billingBalanceHours?: number;
  billingOcKind?: string;
  billable?: number;
  workedNotBilled?: number;
  billedNotWorked?: number;
}>, purchaseOrders?: any[]): void;

export function buildLedgerMonth(input: {
  empresaId: string;
  year: number;
  month: number;
  hoursCoreEnabled: boolean;
  clients: any[];
  slas: any[];
  turnos: any[];
  ausencias: any[];
  publishStatusMap: Record<string, boolean>;
  empNameById: Record<string, string>;
  onlyObjectiveIds?: string[];
  skipPersona?: boolean;
  includeUnscopedPaidAbsences?: boolean;
  contracts?: any[];
  purchaseOrders?: any[];
}): {
  days: any[];
  monthly: any[];
  totals: Record<string, number>;
};
