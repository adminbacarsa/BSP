/**
 * Lectura del libro de horas (H2b). Fuente única para Servicios, CRM, Análisis,
 * Dashboard, Estado de cronogramas y prefactura. No escribe hours_balances.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';

export type HoursLedgerPlanMode = 'published' | 'draft' | 'both';

export type HoursLedgerMonthRow = {
  id?: string;
  level: 'empresa' | 'cliente' | 'objetivo';
  empresaId?: string;
  periodKey?: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  slaActive: number;
  slaInactive: number;
  slaClosed: number;
  planPublished: number;
  planDraft: number;
  worked: number;
  covered?: number;
  uncovered?: number;
  ft?: number;
  ext?: number;
  adv?: number;
  novedadPaga?: number;
};

export type HoursLedgerSource = 'libro' | 'preview' | 'anterior' | 'vacio' | 'calculando';

export type HoursLedgerMonth = {
  periodKey: string;
  source: HoursLedgerSource;
  empresa: HoursLedgerMonthRow | null;
  clients: HoursLedgerMonthRow[];
  objectives: HoursLedgerMonthRow[];
  monthly: HoursLedgerMonthRow[];
};

export const HOURS_LEDGER_PLAN_OPTIONS: { value: HoursLedgerPlanMode; label: string }[] = [
  { value: 'published', label: 'Publicadas' },
  { value: 'draft', label: 'Solo borradores' },
  { value: 'both', label: 'Publicadas + borradores' },
];

export function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function planHoursOf(mode: HoursLedgerPlanMode, row: { planPublished?: number; planDraft?: number } | null | undefined): number {
  if (!row) return 0;
  if (mode === 'draft') return Number(row.planDraft) || 0;
  if (mode === 'both') return (Number(row.planPublished) || 0) + (Number(row.planDraft) || 0);
  return Number(row.planPublished) || 0;
}

export function officialHoursFromEmpresa(row: HoursLedgerMonthRow | null | undefined) {
  return {
    sla: Math.round(Number(row?.slaActive) || 0),
    planPublished: Math.round(Number(row?.planPublished) || 0),
    planDraft: Math.round(Number(row?.planDraft) || 0),
    worked: Math.round(Number(row?.worked) || 0),
  };
}

function asMonthRow(raw: Record<string, unknown>, id?: string): HoursLedgerMonthRow {
  return {
    id: id || String(raw.id || ''),
    level: (raw.level as HoursLedgerMonthRow['level']) || 'objetivo',
    empresaId: String(raw.empresaId || ''),
    periodKey: String(raw.periodKey || ''),
    clientId: String(raw.clientId || ''),
    clientName: String(raw.clientName || ''),
    objectiveId: String(raw.objectiveId || ''),
    objectiveName: String(raw.objectiveName || ''),
    slaActive: Number(raw.slaActive) || 0,
    slaInactive: Number(raw.slaInactive) || 0,
    slaClosed: Number(raw.slaClosed) || 0,
    planPublished: Number(raw.planPublished) || 0,
    planDraft: Number(raw.planDraft) || 0,
    worked: Number(raw.worked) || 0,
    covered: Number(raw.covered) || 0,
    uncovered: Number(raw.uncovered) || 0,
    ft: Number(raw.ft) || 0,
    ext: Number(raw.ext) || 0,
    adv: Number(raw.adv) || 0,
    novedadPaga: Number(raw.novedadPaga) || 0,
  };
}

function fromMonthlyList(periodKey: string, monthly: HoursLedgerMonthRow[], source: HoursLedgerSource): HoursLedgerMonth {
  return {
    periodKey,
    source,
    empresa: monthly.find((r) => r.level === 'empresa') || null,
    clients: monthly.filter((r) => r.level === 'cliente'),
    objectives: monthly.filter((r) => r.level === 'objetivo'),
    monthly,
  };
}

export async function fetchHoursLedgerMonthly(empresaId: string, periodKey: string): Promise<HoursLedgerMonth> {
  const snap = await getDocs(query(
    collection(db, 'hours_ledger_monthly'),
    where('empresaId', '==', empresaId),
    where('periodKey', '==', periodKey),
  ));
  const monthly = snap.docs.map((d) => asMonthRow(d.data() as Record<string, unknown>, d.id));
  return fromMonthlyList(periodKey, monthly, monthly.length ? 'libro' : 'vacio');
}

export async function previewHoursLedgerMonth(empresaId: string, periodKey: string): Promise<HoursLedgerMonth> {
  const call = httpsCallable(functions, 'rebuildHoursLedger');
  const res = await call({ empresaId, period: periodKey, dryRun: true });
  const data = (res.data || {}) as { monthly?: HoursLedgerMonthRow[] };
  const monthly = (data.monthly || []).map((r) => asMonthRow(r as unknown as Record<string, unknown>, r.id));
  return fromMonthlyList(periodKey, monthly, monthly.length ? 'preview' : 'vacio');
}

/**
 * Si hay libro, lo usa. Si no, dispara rebuildHoursLedger en dryRun y espera.
 * Si el callable falla, el llamador puede mostrar el extracto viejo rotulado «anterior».
 */
export async function loadHoursLedgerOrPreview(empresaId: string, periodKey: string): Promise<HoursLedgerMonth> {
  const stored = await fetchHoursLedgerMonthly(empresaId, periodKey);
  if (stored.source === 'libro' && stored.empresa) return stored;
  return previewHoursLedgerMonth(empresaId, periodKey);
}

export function byClientMetricsFromLedger(
  book: HoursLedgerMonth,
  planMode: HoursLedgerPlanMode = 'published',
): Record<string, { sla: number; planned: number; real: number }> {
  const out: Record<string, { sla: number; planned: number; real: number }> = {};
  for (const c of book.clients) {
    const cid = c.clientId || '_sin_cliente';
    out[cid] = {
      sla: Math.round(c.slaActive || 0),
      planned: Math.round(planHoursOf(planMode, c)),
      real: Math.round(c.worked || 0),
    };
  }
  return out;
}

export function slaHoursByObjectiveFromLedger(book: HoursLedgerMonth): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of book.objectives) {
    if (!o.objectiveId) continue;
    out[o.objectiveId] = Math.round(o.slaActive || 0);
  }
  return out;
}

export function planHoursByObjectiveFromLedger(
  book: HoursLedgerMonth,
  planMode: HoursLedgerPlanMode = 'published',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of book.objectives) {
    if (!o.objectiveId) continue;
    out[o.objectiveId] = Math.round(planHoursOf(planMode, o));
  }
  return out;
}
