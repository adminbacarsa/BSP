export type LedgerPlanMode = 'published' | 'draft' | 'both';

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
}): { worked: number; weights: Record<string, number> };

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
}): {
  days: any[];
  monthly: any[];
  totals: Record<string, number>;
};
