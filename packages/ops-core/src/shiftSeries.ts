import { isReliefEligibleShift, reliefShiftCode } from './reliefEligibility';

/** Fin del saliente = inicio del entrante, salvo que el llamador abra la ventana. */
export const SHIFT_SERIES_ALIGN_MS = 30 * 60 * 1000;

/**
 * Rotaciones paralelas. El sufijo numérico es la serie (M2 → T2 → N2).
 * D12/N12 es el par de 12 h: N12 no es «N de la serie 12».
 */
const EIGHT_BANDS = ['M', 'T', 'N'] as const;

export type SeriesShift = Record<string, unknown> & {
  id?: string;
  startMs?: number;
  endMs?: number;
  checkInMs?: number;
};

export type SeriesHandoffKind = 'SERIES' | 'FALLBACK' | 'REJECT';

export type SeriesPickOpts = {
  /** |inicio − fin| máximo. Default 30 min. Lo ignoran earliest/latestIncomingMs. */
  alignMs?: number;
  earliestIncomingMs?: number;
  latestIncomingMs?: number;
};

type ParsedSeries =
  | { kind: '8'; band: (typeof EIGHT_BANDS)[number]; suffix: string }
  | { kind: '12'; band: 'D12' | 'N12' };

function normCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function parseShiftSeries(code: unknown): ParsedSeries | null {
  const c = normCode(code);
  if (c === 'D12' || c === 'N12') return { kind: '12', band: c };
  const m = /^(M|T|N)(\d*)$/.exec(c);
  if (!m) return null;
  return { kind: '8', band: m[1] as (typeof EIGHT_BANDS)[number], suffix: m[2] || '' };
}

export function isRecognizedSeriesCode(code: unknown): boolean {
  return parseShiftSeries(code) !== null;
}

function codeOf(parsed: ParsedSeries): string {
  if (parsed.kind === '12') return parsed.band;
  return `${parsed.band}${parsed.suffix}`;
}

export function nextSeriesCode(code: unknown): string | null {
  const parsed = parseShiftSeries(code);
  if (!parsed) return null;
  if (parsed.kind === '12') return parsed.band === 'D12' ? 'N12' : 'D12';
  const i = EIGHT_BANDS.indexOf(parsed.band);
  return `${EIGHT_BANDS[(i + 1) % EIGHT_BANDS.length]}${parsed.suffix}`;
}

export function prevSeriesCode(code: unknown): string | null {
  const parsed = parseShiftSeries(code);
  if (!parsed) return null;
  if (parsed.kind === '12') return parsed.band === 'D12' ? 'N12' : 'D12';
  const i = EIGHT_BANDS.indexOf(parsed.band);
  return `${EIGHT_BANDS[(i + 2) % EIGHT_BANDS.length]}${parsed.suffix}`;
}

const INHERITED_CODE_KEYS = ['titularCode', 'coveredShiftCode', 'sourceShiftCode', 'band', 'banda'] as const;

/**
 * Código que entra a la serie. La cobertura del titular (ops_cov que no es traza
 * EXT/ADV) hereda el código del titular si el propio no es una serie (FT, vacío, custom).
 */
export function seriesCodeOf(shift: Record<string, unknown> | null | undefined): string {
  if (!shift) return '';
  const own = reliefShiftCode(shift);
  const origin = String(shift.origin || '').toUpperCase();
  const coverage =
    origin === 'OPERATIONS_COVERAGE'
    && shift.coverageHoursOnSource !== true
    && String(shift.coverageType || '').toUpperCase() !== 'EXTEND'
    && String(shift.coverageType || '').toUpperCase() !== 'ADVANCE';
  if (coverage && !isRecognizedSeriesCode(own)) {
    for (const key of INHERITED_CODE_KEYS) {
      const inherited = normCode(shift[key]);
      if (isRecognizedSeriesCode(inherited)) return inherited;
    }
  }
  return own;
}

/** El entrante releva al saliente por serie, por horario (código no reconocible) o no releva. */
export function seriesHandoffKind(outgoingCode: unknown, incomingCode: unknown): SeriesHandoffKind {
  const outgoing = parseShiftSeries(outgoingCode);
  const incoming = parseShiftSeries(incomingCode);
  if (!outgoing || !incoming) return 'FALLBACK';
  return codeOf(incoming) === nextSeriesCode(codeOf(outgoing)) ? 'SERIES' : 'REJECT';
}

function readMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (value && typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof o.toDate === 'function') {
      const t = o.toDate().getTime();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export function seriesBoundMs(shift: SeriesShift | null | undefined, kind: 'start' | 'end'): number {
  if (!shift) return 0;
  const direct = kind === 'start' ? shift.startMs : shift.endMs;
  if (typeof direct === 'number' && direct > 0) return direct;
  const obj = kind === 'start' ? shift.shiftDateObj : shift.endDateObj;
  const raw = kind === 'start' ? shift.startTime : shift.endTime;
  return readMs(obj) || readMs(raw);
}

function fichajeMs(shift: SeriesShift): number {
  if (typeof shift.checkInMs === 'number' && shift.checkInMs > 0) return shift.checkInMs;
  return (
    readMs(shift.checkInAt)
    || readMs(shift.realStartTime)
    || readMs(shift.checkInTime)
    || readMs(shift.presenciaAt)
    || 0
  );
}

export function reliefPositionsMatch(a: unknown, b: unknown): boolean {
  const norm = (n: unknown) =>
    String(n ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^puesto\s+/, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

function incomingStartsInWindow(start: number, outgoingEnd: number, opts?: SeriesPickOpts): boolean {
  if (!start || !outgoingEnd) return false;
  if (opts && (opts.earliestIncomingMs != null || opts.latestIncomingMs != null)) {
    if (opts.earliestIncomingMs != null && start < opts.earliestIncomingMs) return false;
    if (opts.latestIncomingMs != null && start > opts.latestIncomingMs) return false;
    return true;
  }
  const align = opts?.alignMs ?? SHIFT_SERIES_ALIGN_MS;
  return Math.abs(start - outgoingEnd) <= align;
}

function rankRows<T extends SeriesShift>(
  rows: readonly T[],
  anchor: SeriesShift,
  anchorIsOutgoing: boolean,
  targetMs: number,
): T | null {
  if (!rows.length || !targetMs) return null;
  const scored = rows.map((row) => {
    const outCode = anchorIsOutgoing ? seriesCodeOf(anchor) : seriesCodeOf(row);
    const inCode = anchorIsOutgoing ? seriesCodeOf(row) : seriesCodeOf(anchor);
    const kind = seriesHandoffKind(outCode, inCode);
    const bound = anchorIsOutgoing ? seriesBoundMs(row, 'start') : seriesBoundMs(row, 'end');
    return { row, kind, dist: Math.abs(bound - targetMs), fichaje: fichajeMs(row) };
  }).filter((row) => row.kind !== 'REJECT');
  if (!scored.length) return null;
  scored.sort((a, b) => {
    const ka = a.kind === 'SERIES' ? 0 : 1;
    const kb = b.kind === 'SERIES' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.dist !== b.dist) return a.dist - b.dist;
    return b.fichaje - a.fichaje;
  });
  return scored[0].row;
}

/** Quién releva a este saliente: misma serie gana; si el código no es serie, queda el horario. */
export function relieverFor<T extends SeriesShift>(
  outgoing: T,
  candidates: readonly T[],
  opts?: SeriesPickOpts,
): T | null {
  const outgoingEnd = seriesBoundMs(outgoing, 'end');
  if (!outgoingEnd) return null;
  const pool = candidates.filter((candidate) => {
    if (!candidate) return false;
    if (candidate.id && outgoing.id && candidate.id === outgoing.id) return false;
    if (!isReliefEligibleShift(candidate)) return false;
    if (!reliefPositionsMatch(candidate.positionName, outgoing.positionName)) return false;
    const start = seriesBoundMs(candidate, 'start');
    return incomingStartsInWindow(start, outgoingEnd, opts);
  });
  return rankRows(pool, outgoing, true, outgoingEnd);
}

/**
 * Cambio de franja con menos lugares: se quedan los `slots` salientes con menos
 * tiempo en el puesto (fichada más reciente). El resto cierra a su horario.
 */
export function keepsNextBandSlot<T extends SeriesShift>(
  outgoing: T,
  siblings: readonly T[],
  slots: number,
): boolean {
  if (!Number.isFinite(slots)) return true;
  if (slots <= 0) return false;
  const pool = siblings.some((s) => s.id === outgoing.id) ? [...siblings] : [outgoing, ...siblings];
  if (pool.length <= slots) return true;
  const ranked = pool
    .map((s) => ({ id: String(s.id || ''), fichaje: fichajeMs(s) || seriesBoundMs(s, 'start') }))
    .sort((a, b) => (b.fichaje - a.fichaje) || a.id.localeCompare(b.id));
  return ranked.slice(0, slots).some((r) => r.id === String(outgoing.id || ''));
}

/** A quién releva este entrante. Quien arranca con el hueco no es saliente. */
export function outgoingFor<T extends SeriesShift>(
  incoming: T,
  candidates: readonly T[],
  opts?: SeriesPickOpts,
): T | null {
  const gapStart = seriesBoundMs(incoming, 'start');
  if (!gapStart) return null;
  const align = opts?.alignMs ?? SHIFT_SERIES_ALIGN_MS;
  const pool = candidates.filter((candidate) => {
    if (!candidate) return false;
    if (candidate.id && incoming.id && candidate.id === incoming.id) return false;
    if (!isReliefEligibleShift(candidate)) return false;
    if (!reliefPositionsMatch(candidate.positionName, incoming.positionName)) return false;
    const start = seriesBoundMs(candidate, 'start');
    const end = seriesBoundMs(candidate, 'end');
    if (start <= 0 || start >= gapStart - 60_000) return false;
    if (!end || Math.abs(end - gapStart) > align) return false;
    return true;
  });
  return rankRows(pool, incoming, false, gapStart);
}
