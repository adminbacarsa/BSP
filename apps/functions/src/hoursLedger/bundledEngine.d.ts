export type LedgerPlanMode = 'published' | 'draft' | 'both';

export function planHoursOf(
  mode: LedgerPlanMode,
  row: { planPublished: number; planDraft: number },
): number;

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
}): {
  days: any[];
  monthly: any[];
  totals: Record<string, number>;
};
