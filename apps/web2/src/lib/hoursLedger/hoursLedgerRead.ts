/**
 * Lectura del libro de horas (H2b). Fuente única para Servicios, CRM, Análisis,
 * Dashboard, Estado de cronogramas y prefactura. No escribe hours_balances.
 */
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import {
  buildObjectiveOwnerIndex,
  resolveObjectiveOwner,
  type OwnerClientLike,
} from '@/lib/crm/objectiveClientOwner';

export type HoursLedgerPlanMode = 'published' | 'draft' | 'both';

/** Día por puesto del libro (`hours_ledger`). */
export type HoursLedgerDayRow = {
  id?: string;
  empresaId?: string;
  periodKey?: string;
  date: string;
  clientId: string;
  objectiveId: string;
  puestoId: string;
  slaActive: number;
  slaClosed: number;
  planPublished: number;
  planDraft: number;
  worked: number;
};

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
  slaWithoutPlan?: number;
  planPublished: number;
  planDraft: number;
  worked: number;
  workedOutside?: number;
  covered?: number;
  uncovered?: number;
  ft?: number;
  ext?: number;
  adv?: number;
  novedadPaga?: number;
  novedadPagaOutside?: number;
  licV?: number;
  licE?: number;
  licL?: number;
  licA?: number;
  licPG?: number;
  licSUS?: number;
  licSGS?: number;
  ausenciaHoras?: number;
  ausenciaHorasOutside?: number;
  ausenciaTurnos?: number;
  ausenciaTurnosOutside?: number;
  ausenciaLegajos?: number;
  uncoveredAusencia?: number;
  uncoveredRetiro?: number;
  uncoveredFaltaPlan?: number;
};

/** Códigos de la tarjeta Licencias, en el orden que se muestran. */
export const HOURS_LEDGER_LIC_CODES = [
  { key: 'licV', label: 'V' },
  { key: 'licE', label: 'E' },
  { key: 'licL', label: 'L' },
  { key: 'licA', label: 'ART' },
  { key: 'licPG', label: 'PG' },
  { key: 'licSUS', label: 'SUS' },
  { key: 'licSGS', label: 'SGS' },
] as const;

export type HoursLedgerSource = 'libro' | 'preview' | 'anterior' | 'vacio' | 'calculando';

export type HoursLedgerMonth = {
  periodKey: string;
  source: HoursLedgerSource;
  empresa: HoursLedgerMonthRow | null;
  clients: HoursLedgerMonthRow[];
  objectives: HoursLedgerMonthRow[];
  monthly: HoursLedgerMonthRow[];
  /** Detalle diario si vino con el libro (preview sincrónico). Si no, `fetchHoursLedgerDays`. */
  days?: HoursLedgerDayRow[];
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
    slaWithoutPlan: Number(raw.slaWithoutPlan) || 0,
    planPublished: Number(raw.planPublished) || 0,
    planDraft: Number(raw.planDraft) || 0,
    worked: Number(raw.worked) || 0,
    workedOutside: Number(raw.workedOutside) || 0,
    covered: Number(raw.covered) || 0,
    uncovered: Number(raw.uncovered) || 0,
    ft: Number(raw.ft) || 0,
    ext: Number(raw.ext) || 0,
    adv: Number(raw.adv) || 0,
    novedadPaga: Number(raw.novedadPaga) || 0,
    novedadPagaOutside: Number(raw.novedadPagaOutside) || 0,
    licV: Number(raw.licV) || 0,
    licE: Number(raw.licE) || 0,
    licL: Number(raw.licL) || 0,
    licA: Number(raw.licA) || 0,
    licPG: Number(raw.licPG) || 0,
    licSUS: Number(raw.licSUS) || 0,
    licSGS: Number(raw.licSGS) || 0,
    ausenciaHoras: Number(raw.ausenciaHoras) || 0,
    ausenciaHorasOutside: Number(raw.ausenciaHorasOutside) || 0,
    ausenciaTurnos: Number(raw.ausenciaTurnos) || 0,
    ausenciaTurnosOutside: Number(raw.ausenciaTurnosOutside) || 0,
    ausenciaLegajos: Number(raw.ausenciaLegajos) || 0,
    uncoveredAusencia: Number(raw.uncoveredAusencia) || 0,
    uncoveredRetiro: Number(raw.uncoveredRetiro) || 0,
    uncoveredFaltaPlan: Number(raw.uncoveredFaltaPlan) || 0,
  };
}

function asDayRow(raw: Record<string, unknown>, id?: string): HoursLedgerDayRow {
  return {
    id: id || String(raw.id || ''),
    empresaId: String(raw.empresaId || ''),
    periodKey: String(raw.periodKey || ''),
    date: String(raw.date || ''),
    clientId: String(raw.clientId || ''),
    objectiveId: String(raw.objectiveId || ''),
    puestoId: String(raw.puestoId || ''),
    slaActive: Number(raw.slaActive) || 0,
    slaClosed: Number(raw.slaClosed) || 0,
    planPublished: Number(raw.planPublished) || 0,
    planDraft: Number(raw.planDraft) || 0,
    worked: Number(raw.worked) || 0,
  };
}

function fromMonthlyList(
  periodKey: string,
  monthly: HoursLedgerMonthRow[],
  source: HoursLedgerSource,
  days?: HoursLedgerDayRow[],
): HoursLedgerMonth {
  return {
    periodKey,
    source,
    empresa: monthly.find((r) => r.level === 'empresa') || null,
    clients: monthly.filter((r) => r.level === 'cliente'),
    objectives: monthly.filter((r) => r.level === 'objetivo'),
    monthly,
    ...(days ? { days } : {}),
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

/** Días por puesto del libro guardado (`hours_ledger`). Vacío si el mes no está persistido. */
export async function fetchHoursLedgerDays(empresaId: string, periodKey: string): Promise<HoursLedgerDayRow[]> {
  const snap = await getDocs(query(
    collection(db, 'hours_ledger'),
    where('empresaId', '==', empresaId),
    where('periodKey', '==', periodKey),
  ));
  return snap.docs.map((d) => asDayRow(d.data() as Record<string, unknown>, d.id));
}

export type HoursLedgerTrendPoint = { label: string; sla: number; planificado: number; ejecutado: number };

/**
 * Serie diaria SLA / plan (según selector) / trabajadas a partir del detalle del libro.
 * Un punto por día calendario del mes (los días sin filas quedan en 0).
 */
export function dailyTrendFromLedgerDays(
  days: HoursLedgerDayRow[],
  planMode: HoursLedgerPlanMode,
  year: number,
  month: number,
): HoursLedgerTrendPoint[] {
  const periodKey = periodKeyOf(year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const byDay = new Map<string, { sla: number; plan: number; worked: number }>();
  for (const d of days) {
    if (!d.date || !d.date.startsWith(periodKey)) continue;
    const cur = byDay.get(d.date) || { sla: 0, plan: 0, worked: 0 };
    cur.sla += Number(d.slaActive) || 0;
    cur.plan += planHoursOf(planMode, d);
    cur.worked += Number(d.worked) || 0;
    byDay.set(d.date, cur);
  }
  const out: HoursLedgerTrendPoint[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const key = `${periodKey}-${String(day).padStart(2, '0')}`;
    const v = byDay.get(key);
    out.push({
      label: String(day),
      sla: Math.round(v?.sla || 0),
      planificado: Math.round(v?.plan || 0),
      ejecutado: Math.round(v?.worked || 0),
    });
  }
  return out;
}

export type HoursLedgerJobView = {
  status: string;
  total: number;
  processed: number;
  currentObjectiveName: string;
  error: string;
  createdBy: string;
  finishedAt: string;
  dryRun: boolean;
  failed: Array<{ objectiveId?: string; name?: string; error?: string }>;
};

export function hoursLedgerJobDocId(empresaId: string, periodKey: string, dryRun = true) {
  return `${empresaId}_${periodKey}_${dryRun ? 'dry' : 'save'}`.replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}

export type LedgerProgress = HoursLedgerJobView & { pct: number; periodKey: string };

const progressListeners = new Set<(p: LedgerProgress | null) => void>();

export function subscribeLedgerProgress(cb: (p: LedgerProgress | null) => void) {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function emitProgress(periodKey: string, raw: Record<string, unknown> | undefined) {
  if (!raw) {
    progressListeners.forEach((cb) => cb(null));
    return;
  }
  const total = Number(raw.total) || 0;
  const processed = Number(raw.processed) || 0;
  const view: LedgerProgress = {
    periodKey,
    status: String(raw.status || ''),
    total,
    processed,
    pct: total > 0 ? Math.round((100 * processed) / total) : (String(raw.status) === 'DONE' ? 100 : 0),
    currentObjectiveName: String(raw.currentObjectiveName || ''),
    error: String(raw.error || ''),
    createdBy: String(raw.createdBy || ''),
    finishedAt: String(raw.finishedAt || ''),
    dryRun: raw.dryRun !== false,
    failed: Array.isArray(raw.failed) ? raw.failed as LedgerProgress['failed'] : [],
  };
  progressListeners.forEach((cb) => cb(view));
}

export function watchHoursLedgerJob(empresaId: string, periodKey: string, dryRun: boolean, cb: (job: Record<string, unknown> | null) => void) {
  return onSnapshot(doc(db, 'hours_ledger_jobs', hoursLedgerJobDocId(empresaId, periodKey, dryRun)), (snap) => {
    const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    emitProgress(periodKey, data || undefined);
    cb(data);
  });
}

function waitHoursLedgerJob(empresaId: string, periodKey: string, dryRun: boolean): Promise<HoursLedgerMonth> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('El recálculo sigue en segundo plano. Volvé a abrir la pantalla para ver el avance.'));
    }, 15 * 60 * 1000);
    const unsub = watchHoursLedgerJob(empresaId, periodKey, dryRun, (job) => {
      if (!job) return;
      const status = String(job.status || '');
      if (status !== 'DONE' && status !== 'ERROR') return;
      clearTimeout(timer);
      unsub();
      const result = job.result as { monthly?: HoursLedgerMonthRow[] } | null;
      const monthly = (result?.monthly || []).map((r) => asMonthRow(r as unknown as Record<string, unknown>, r.id));
      if (status === 'ERROR' && !monthly.length) {
        reject(new Error(String(job.error || 'El recálculo falló')));
        return;
      }
      resolve(fromMonthlyList(periodKey, monthly, monthly.length ? 'preview' : 'vacio'));
    });
  });
}

export async function previewHoursLedgerMonth(empresaId: string, periodKey: string): Promise<HoursLedgerMonth> {
  const call = httpsCallable(functions, 'rebuildHoursLedger', { timeout: 60000 });
  const res = await call({ empresaId, period: periodKey, dryRun: true, force: true });
  const data = (res.data || {}) as { monthly?: HoursLedgerMonthRow[]; days?: HoursLedgerDayRow[]; jobId?: string };
  if (data.monthly) {
    const monthly = data.monthly.map((r) => asMonthRow(r as unknown as Record<string, unknown>, r.id));
    const days = Array.isArray(data.days)
      ? data.days.map((r) => asDayRow(r as unknown as Record<string, unknown>, r.id))
      : undefined;
    return fromMonthlyList(periodKey, monthly, monthly.length ? 'preview' : 'vacio', days);
  }
  if (!data.jobId) return fromMonthlyList(periodKey, [], 'vacio');
  return waitHoursLedgerJob(empresaId, periodKey, true);
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

/**
 * Horas por cliente del libro. Con `clients` (listado del CRM) agrupa los objetivos por su
 * dueño actual (`clients.objetivos[].id`, mismo criterio que el motor y el trigger I1), así un
 * libro guardado con clientId de un cliente borrado igual cae en el cliente vigente.
 * Sin `clients` usa las filas `level=cliente` tal cual.
 */
export function byClientMetricsFromLedger(
  book: HoursLedgerMonth,
  planMode: HoursLedgerPlanMode = 'published',
  clients?: OwnerClientLike[],
): Record<string, { sla: number; planned: number; real: number }> {
  const out: Record<string, { sla: number; planned: number; real: number }> = {};
  const add = (cid: string, row: { slaActive?: number; planPublished?: number; planDraft?: number; worked?: number }) => {
    const cur = out[cid] || { sla: 0, planned: 0, real: 0 };
    cur.sla += Number(row.slaActive) || 0;
    cur.planned += planHoursOf(planMode, row);
    cur.real += Number(row.worked) || 0;
    out[cid] = cur;
  };
  if (clients && clients.length > 0 && book.objectives.length > 0) {
    const index = buildObjectiveOwnerIndex(clients);
    for (const o of book.objectives) {
      const owner = resolveObjectiveOwner(index, o.objectiveId, { objectiveName: o.objectiveName, clientName: o.clientName });
      const cid = owner?.clientId
        || (o.clientId && index.clientById.has(o.clientId) ? o.clientId : '')
        || '_sin_cliente';
      add(cid, o);
    }
  } else {
    for (const c of book.clients) add(c.clientId || '_sin_cliente', c);
  }
  for (const cid of Object.keys(out)) {
    out[cid] = {
      sla: Math.round(out[cid].sla),
      planned: Math.round(out[cid].planned),
      real: Math.round(out[cid].real),
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
