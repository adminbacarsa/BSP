/**
 * Selección de turnos del panel "Trabajaron" (TOT) para un día AR.
 *
 * El día de un turno es su `scheduleDate` (celda del cronograma) o, si no tiene,
 * el día AR de su inicio planificado. Un nocturno que arranca el 25 a las 23:00
 * es del 25 aunque termine el 26.
 */

export type WorkedDayDoc = { id: string; data: Record<string, any> };

export type WorkedDayShift = { id: string; data: Record<string, any>; coversName: string };

/** Licencias, ausencias y francos: no son horas trabajadas aunque figuren presentes. */
export const WORKED_EXCLUDED_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'LT', 'F', 'FF', 'FP']);

const AR_OFFSET_MS = 3 * 3600e3;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') return t.toDate();
  if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function arYmd(d: Date): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

export function workedDayKey(s: Record<string, any>): string | null {
  const sched = String(s.scheduleDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sched)) return sched;
  const st = toDate(s.startTime);
  return st ? arYmd(st) : null;
}

function codeOf(s: Record<string, any>): string {
  return String(s.code || s.type || '').trim().toUpperCase();
}

function linkIds(s: Record<string, any>): string[] {
  return [s.titularShiftId, s.absenceShiftId, s.coveredShiftId]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}

function nameKey(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Ids de titular referenciados por coberturas que no vinieron en la consulta del día. */
export function missingCoverageLinkIds(docs: WorkedDayDoc[]): string[] {
  const have = new Set(docs.map((d) => d.id));
  const out = new Set<string>();
  for (const d of docs) for (const id of linkIds(d.data)) if (!have.has(id)) out.add(id);
  return [...out];
}

function hasFichada(s: Record<string, any>): boolean {
  return !!(toDate(s.realStartTime) || toDate(s.checkInTime));
}

function isWorker(s: Record<string, any>): boolean {
  if (s.isDeleted === true || s.isFranco === true) return false;
  if (!s.employeeId || s.employeeId === 'VACANTE' || s.isUnassigned === true) return false;
  return !WORKED_EXCLUDED_CODES.has(codeOf(s));
}

export function selectWorkedDayShifts(
  docs: WorkedDayDoc[],
  day: string,
  linkedNames: Map<string, string> = new Map(),
): WorkedDayShift[] {
  const byId = new Map(docs.map((d) => [d.id, d.data]));
  const nameOf = (id: string) => linkedNames.get(id) || String(byId.get(id)?.employeeName || '');

  const coversNameFor = (s: Record<string, any>): string => {
    const self = nameKey(String(s.employeeName || ''));
    const candidates = [
      String(s.coversEmployeeName || ''),
      String(s.coverageUsedCoversEmployeeName || ''),
      ...linkIds(s).map(nameOf),
    ];
    for (const c of candidates) {
      const k = nameKey(c);
      if (!k || k === 'VACANTE' || k === self) continue;
      return c;
    }
    return '';
  };

  /** Cobertura de uno mismo: dato inválido (no es trabajo real sobre el titular). */
  const coversSelf = (s: Record<string, any>): boolean => {
    const emp = String(s.employeeId || '');
    const self = nameKey(String(s.employeeName || ''));
    return linkIds(s).some((id) => {
      const t = byId.get(id);
      if (t && String(t.employeeId || '') === emp) return true;
      const n = nameKey(nameOf(id));
      return !!n && n === self;
    });
  };

  const out: WorkedDayShift[] = [];
  const outById = new Map<string, WorkedDayShift>();
  const onSourceCovs: WorkedDayDoc[] = [];

  for (const d of docs) {
    const s = d.data;
    if (!isWorker(s)) continue;
    if (coversSelf(s)) continue;
    if (s.coverageHoursOnSource === true) {
      onSourceCovs.push(d);
      continue;
    }
    if (!hasFichada(s)) continue;
    if (workedDayKey(s) !== day) continue;
    const row = { id: d.id, data: s, coversName: coversNameFor(s) };
    out.push(row);
    outById.set(d.id, row);
  }

  // EXT/ADV: las horas van en el turno propio del que cubre. Si ese turno está en la
  // lista, se le anota a quién cubre; si no (ej. salió de su franco), va la cobertura.
  for (const d of onSourceCovs) {
    const s = d.data;
    const covers = coversNameFor(s);
    const source = outById.get(String(s.sourceShiftId || '').trim());
    if (source) {
      if (!source.coversName && covers) source.coversName = covers;
      continue;
    }
    if (!hasFichada(s) || workedDayKey(s) !== day) continue;
    const row = { id: d.id, data: s, coversName: covers };
    out.push(row);
    outById.set(d.id, row);
  }

  return out;
}
