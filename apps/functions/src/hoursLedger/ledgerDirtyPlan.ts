/**
 * Qué objetivo-mes queda sucio, y qué filas del libro tienen el motor viejo.
 * Puro: no lee Firestore. Al cambiar reglas de horas, subir LEDGER_ENGINE_VERSION.
 */
export const LEDGER_ENGINE_VERSION = 1;

export type DirtyMark = { empresaId: string; objectiveId: string; periodKey: string };

export function ledgerDirtyDocId(empresaId: string, objectiveId: string, periodKey: string) {
  return [empresaId, objectiveId, periodKey].join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}

export function periodKeyFromInstant(value: unknown): string {
  const ms = instantMs(value);
  if (ms == null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === 'year')?.value || '';
  const m = parts.find((p) => p.type === 'month')?.value || '';
  return y && m ? `${y}-${m}` : '';
}

/** Mes en curso + 2 cerrados, calendario Argentina. */
export function hotPeriodKeys(now = new Date()): string[] {
  const cur = periodKeyFromInstant(now);
  const [y, m] = cur.split('-').map(Number);
  const out: string[] = [];
  for (let i = 2; i >= 0; i -= 1) {
    const idx = y * 12 + (m - 1) - i;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out;
}

function instantMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  const sec = o.seconds ?? o._seconds;
  if (typeof sec === 'number' && sec > 0) return sec * 1000;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00.000-03:00`).getTime();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  return null;
}

function empresaOf(data: Record<string, unknown> | undefined) {
  return String(data?.empresaId || '').trim();
}

function objectiveOf(data: Record<string, unknown> | undefined) {
  return String(data?.objectiveId || data?.objetivoId || '').trim();
}

function push(out: DirtyMark[], empresaId: string, objectiveId: string, periodKey: string) {
  if (!empresaId || !objectiveId || !/^\d{4}-\d{2}$/.test(periodKey)) return;
  const key = `${empresaId}|${objectiveId}|${periodKey}`;
  if (out.some((m) => `${m.empresaId}|${m.objectiveId}|${m.periodKey}` === key)) return;
  out.push({ empresaId, objectiveId, periodKey });
}

function turnoMark(data: Record<string, unknown> | undefined, out: DirtyMark[]) {
  if (!data) return;
  const period = periodKeyFromInstant(data.startTime) || periodKeyFromInstant(data.scheduleDate) || periodKeyFromInstant(data.fecha);
  push(out, empresaOf(data), objectiveOf(data), period);
}

/** Fichada, alta o cambio de horario: solo el objetivo y el mes del turno (antes y después). */
export function dirtyMarksForTurno(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): DirtyMark[] {
  const out: DirtyMark[] = [];
  turnoMark(before, out);
  turnoMark(after, out);
  return out;
}

export function dirtyMarksForPlanif(docId: string, data: Record<string, unknown> | undefined): DirtyMark[] {
  const out: DirtyMark[] = [];
  const parsed = String(docId || '').match(/^(.*)_(\d{4})_(\d{1,2})$/);
  const objectiveId = objectiveOf(data) || (parsed ? parsed[1] : '');
  const y = Number(data?.year ?? data?.año ?? parsed?.[2]);
  const m = Number(data?.month ?? data?.mes ?? parsed?.[3]);
  const period = Number.isFinite(y) && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : '';
  push(out, empresaOf(data), objectiveId, period);
  return out;
}

function monthsInclusive(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(start)) return [];
  const last = /^\d{4}-\d{2}$/.test(end) && end >= start ? end : start;
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = last.split('-').map(Number);
  for (let i = 0; i < 36; i += 1) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Ausencia: cada mes entre startDate y endDate del objetivo. Sin objectiveId no marca. */
export function dirtyMarksForAbsence(data: Record<string, unknown> | undefined): DirtyMark[] {
  const out: DirtyMark[] = [];
  if (!data) return out;
  const start = periodKeyFromInstant(data.startDate)
    || periodKeyFromInstant(data.startTime)
    || periodKeyFromInstant(data.fecha)
    || periodKeyFromInstant(data.date)
    || periodKeyFromInstant(data.scheduleDate);
  const end = periodKeyFromInstant(data.endDate) || periodKeyFromInstant(data.endTime) || start;
  for (const period of monthsInclusive(start, end)) {
    push(out, empresaOf(data), objectiveOf(data), period);
  }
  return out;
}

function objectiveIdsOf(data: Record<string, unknown> | undefined): string[] {
  const direct = objectiveOf(data);
  const raw = data?.objetivos ?? data?.objectives;
  const ids = new Set<string>();
  if (direct) ids.add(direct);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) ids.add(item.trim());
      else if (item && typeof item === 'object') {
        const id = String((item as { id?: string; objectiveId?: string }).id || (item as { objectiveId?: string }).objectiveId || '').trim();
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

/** SLA o ficha de cliente: los objetivos tocados, solo en la ventana hot. */
export function dirtyMarksForObjectives(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  hotPeriods: string[],
): DirtyMark[] {
  const out: DirtyMark[] = [];
  const empresaId = empresaOf(after) || empresaOf(before);
  const ids = new Set([...objectiveIdsOf(before), ...objectiveIdsOf(after)]);
  for (const objectiveId of ids) {
    for (const periodKey of hotPeriods) push(out, empresaId, objectiveId, periodKey);
  }
  return out;
}

/**
 * Qué encolar para un mes hot. Con libro: solo los objetivos de versión vieja. Sin libro:
 * el mes entero, salvo que ya haya un job de esta versión (encolado, corriendo o terminado).
 */
export function staleEnginePlan(
  rows: Array<{ level?: string; objectiveId?: string; engineVersion?: unknown }>,
  job: Record<string, unknown> | undefined,
  version = LEDGER_ENGINE_VERSION,
): { objectiveIds?: string[] } | null {
  if (rows.length > 0) {
    const stale = objectivesNeedingEngine(rows, version);
    return stale.length ? { objectiveIds: stale } : null;
  }
  const jobVersion = Number(job?.engineVersion || 0);
  const status = String(job?.status || '');
  if (jobVersion >= version && (status === 'QUEUED' || status === 'RUNNING' || status === 'DONE')) return null;
  return {};
}

export function objectivesNeedingEngine(
  rows: Array<{ level?: string; objectiveId?: string; engineVersion?: unknown }>,
  version = LEDGER_ENGINE_VERSION,
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.level !== 'objetivo') continue;
    const id = String(row.objectiveId || '').trim();
    if (!id) continue;
    if (Number(row.engineVersion || 0) < version && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
