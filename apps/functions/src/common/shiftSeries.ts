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
  /**
   * FIFO. En `relieverFor`: los otros salientes de la misma franja (mismo puesto, fin ±30 min);
   * el que más tiempo lleva en el puesto se lleva al primer entrante que ficha.
   * En `outgoingFor`: los otros entrantes de la franja (fichados o no).
   */
  peers?: readonly SeriesShift[];
  /**
   * Turnos del legajo (u otros) para el desempate: si dos salientes ficharon en el mismo
   * segundo, se releva primero al que tiene el próximo turno planificado más cerca.
   */
  roster?: readonly SeriesShift[];
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

function positiveMs(value: unknown): number {
  const t = readMs(value);
  return t > 0 ? t : 0;
}

/**
 * Inicio real efectivo de la fichada. Orden: `checkInAt`, `realStartTime`, `checkInTime`,
 * `presenciaAt`. Un campo vacío no vale 0: si no hay marca, el resultado es 0 y el
 * llamador sigue con el inicio planificado. Nunca se ordena por un `checkInAt` vacío.
 */
export function effectiveStartMs(shift: SeriesShift): number {
  if (typeof shift.checkInMs === 'number' && shift.checkInMs > 0) return shift.checkInMs;
  return (
    positiveMs(shift.checkInAt)
    || positiveMs(shift.realStartTime)
    || positiveMs(shift.checkInTime)
    || positiveMs(shift.presenciaAt)
    || 0
  );
}

function fichajeMs(shift: SeriesShift): number {
  return effectiveStartMs(shift);
}

const REST_DUTY_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS']);

/** Franco, licencia o borrador: no es el próximo turno que exige descanso. */
export function isRestOrLicenseShift(shift: SeriesShift): boolean {
  const code = String(shift.code ?? shift.type ?? shift.shiftCode ?? '').trim().toUpperCase();
  return shift.draft === true || shift.isFranco === true || REST_DUTY_CODES.has(code);
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

const idOf = (shift: SeriesShift | null | undefined): string => String(shift?.id ?? '');

const sameShift = (a: SeriesShift, b: SeriesShift): boolean => a === b || (!!idOf(a) && idOf(a) === idOf(b));

/** Inicio real (fichada) o, si no fichó, el planificado: cuánto lleva en el puesto. */
export function workStartMsOf(shift: SeriesShift): number {
  return fichajeMs(shift) || seriesBoundMs(shift, 'start');
}

/**
 * Inicio del próximo turno planificado del legajo, después del fin de este.
 * Se saltea franco y licencia. 0 si no hay.
 */
export function nextDutyStartMsOf(shift: SeriesShift, roster: readonly SeriesShift[] | undefined): number {
  const stamped = positiveMs(shift.nextDutyStartMs);
  if (stamped) return stamped;
  const emp = String(shift.employeeId ?? '').trim();
  if (!emp || !roster?.length) return 0;
  const after = seriesBoundMs(shift, 'end') || workStartMsOf(shift);
  let best = 0;
  for (const row of roster) {
    if (!row || sameShift(row, shift)) continue;
    if (String(row.employeeId ?? '').trim() !== emp) continue;
    if (isRestOrLicenseShift(row)) continue;
    const start = seriesBoundMs(row, 'start');
    if (!start || (after > 0 && start <= after)) continue;
    if (!best || start < best) best = start;
  }
  return best;
}

/**
 * Orden FIFO de salientes. Primero el inicio real efectivo más antiguo (al segundo:
 * un `checkInAt` vacío no cuenta como 0). Mismo segundo: primero el que tiene el
 * próximo turno planificado más cerca (franco y licencia no cuentan). Si no hay
 * diferencia, id estable.
 */
export function compareOutgoingsFifo(a: SeriesShift, b: SeriesShift, opts?: SeriesPickOpts): number {
  const sa = Math.floor(workStartMsOf(a) / 1000);
  const sb = Math.floor(workStartMsOf(b) / 1000);
  if (sa !== sb) return sa - sb;
  const duty = (shift: SeriesShift) => {
    const start = nextDutyStartMsOf(shift, opts?.roster);
    return start > 0 ? start : Number.MAX_SAFE_INTEGER;
  };
  const da = duty(a);
  const db = duty(b);
  if (da !== db) return da - db;
  return idOf(a).localeCompare(idOf(b));
}

/** FIFO salientes: ver `compareOutgoingsFifo`. */
export function sortOutgoingsFifo<T extends SeriesShift>(rows: readonly T[], opts?: SeriesPickOpts): T[] {
  return [...rows].sort((a, b) => compareOutgoingsFifo(a, b, opts));
}

/** Entrante que no va a venir: su hueco se lo queda el saliente que nadie releva. */
export function isAbsentIncoming(shift: SeriesShift): boolean {
  return shift.isAbsent === true || String(shift.status ?? '').toUpperCase() === 'ABSENT';
}

/**
 * Clave FIFO del entrante: los que ficharon por orden de fichada; los que todavía no ficharon
 * por inicio planificado; los ausentes al final (se emparejan con el saliente que sobra).
 */
function incomingFifoKey(shift: SeriesShift): [number, number] {
  if (isAbsentIncoming(shift)) return [2, seriesBoundMs(shift, 'start')];
  const fichaje = fichajeMs(shift);
  return fichaje > 0 ? [0, fichaje] : [1, seriesBoundMs(shift, 'start')];
}

/** FIFO entrantes: fichados por orden de llegada; sin fichar por inicio planificado y luego id. */
export function sortIncomingsFifo<T extends SeriesShift>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const [ga, ta] = incomingFifoKey(a);
    const [gb, tb] = incomingFifoKey(b);
    return (ga - gb) || (ta - tb) || idOf(a).localeCompare(idOf(b));
  });
}

export type ReliefPairKind = SeriesHandoffKind | 'FORCED';

export type ReliefPair<T extends SeriesShift> = {
  outgoing: T;
  incoming: T | null;
  /** FORCED = vínculo ya escrito por el servidor (`relievedBy` / `relievedOutgoingShiftId`). */
  kind: ReliefPairKind | null;
};

/**
 * Emparejamiento único del relevo de franja (FIFO). Salientes ordenados por inicio real
 * ascendente; entrantes por orden de fichada (los que no ficharon, por inicio planificado y
 * luego id). Primero se respetan los vínculos que ya escribió el servidor, después la serie
 * (M→T, M2→T2, D12→N12) y por último el horario para códigos que no son serie. El
 * emparejamiento es dinámico: si ficha primero el que la tarjeta no esperaba, igual releva al
 * que más tiempo lleva en el puesto y la tarjeta se actualiza. Con nadie fichado y mismo
 * inicio, gana el vínculo de la retención (`retentionAbsenceShiftId`).
 */
export function pairReliefs<T extends SeriesShift>(
  outgoings: readonly T[],
  incomings: readonly T[],
  opts?: SeriesPickOpts,
): ReliefPair<T>[] {
  const outs = sortOutgoingsFifo(outgoings.filter((row) => !!row), opts);
  const ins = sortIncomingsFifo(incomings.filter((row) => !!row && isReliefEligibleShift(row)));
  const claimed = new Set<T>();
  const picked = new Map<T, { incoming: T; kind: ReliefPairKind }>();

  const compatible = (out: T, inc: T): boolean => {
    if (sameShift(out, inc)) return false;
    if (!reliefPositionsMatch(inc.positionName, out.positionName)) return false;
    // Un entrante que ya relevó a otro saliente (lo escribió el servidor) no vuelve a emparejarse.
    const linkedOut = String(inc.relievedOutgoingShiftId ?? '').trim();
    if (linkedOut && idOf(out) && linkedOut !== idOf(out)) return false;
    return incomingStartsInWindow(seriesBoundMs(inc, 'start'), seriesBoundMs(out, 'end'), opts);
  };
  const claim = (out: T, inc: T, kind: ReliefPairKind) => {
    claimed.add(inc);
    picked.set(out, { incoming: inc, kind });
  };

  for (const out of outs) {
    const relievedBy = String(out.relievedBy ?? '').trim();
    const forced = ins.find((inc) => {
      if (claimed.has(inc) || !compatible(out, inc)) return false;
      if (relievedBy && String(inc.employeeId ?? '').trim() === relievedBy) return true;
      const linkedOut = String(inc.relievedOutgoingShiftId ?? '').trim();
      return !!linkedOut && linkedOut === idOf(out);
    });
    if (forced) claim(out, forced, 'FORCED');
  }

  const pairStage = (outOrder: readonly T[], absent: boolean) => {
    for (const wanted of ['SERIES', 'FALLBACK'] as const) {
      for (const out of outOrder) {
        if (picked.has(out)) continue;
        const cands = ins.filter((inc) =>
          !claimed.has(inc)
          && isAbsentIncoming(inc) === absent
          && compatible(out, inc)
          && seriesHandoffKind(seriesCodeOf(out), seriesCodeOf(inc)) === wanted);
        if (!cands.length) continue;
        const first = cands[0];
        const [g0, t0] = incomingFifoKey(first);
        const linkedId = String(out.retentionAbsenceShiftId ?? '').trim();
        const tied = cands.filter((inc) => {
          const [g, t] = incomingFifoKey(inc);
          return g === g0 && t === t0;
        });
        const pick = (linkedId && tied.find((inc) => idOf(inc) === linkedId)) || first;
        claim(out, pick, wanted);
      }
    }
  };
  // Los que vienen (fichados o pendientes) relevan por FIFO: el más antiguo primero.
  pairStage(outs, false);
  // El ausente deja su hueco al saliente que sobra: el más nuevo (mismo criterio que el cupo por franja).
  pairStage([...outs].reverse(), true);

  return outs.map((out) => {
    const hit = picked.get(out);
    return { outgoing: out, incoming: hit?.incoming ?? null, kind: hit?.kind ?? null };
  });
}

/** Los otros salientes de la misma franja: mismo puesto, fin a ±align del fin del ancla. */
function outgoingPeersOf<T extends SeriesShift>(outgoing: T, peers: readonly SeriesShift[] | undefined, opts?: SeriesPickOpts): T[] {
  const outgoingEnd = seriesBoundMs(outgoing, 'end');
  const align = opts?.alignMs ?? SHIFT_SERIES_ALIGN_MS;
  return ((peers || []) as T[]).filter((peer) => {
    if (!peer || sameShift(peer, outgoing)) return false;
    if (!isReliefEligibleShift(peer)) return false;
    if (!reliefPositionsMatch(peer.positionName, outgoing.positionName)) return false;
    const end = seriesBoundMs(peer, 'end');
    return !!end && Math.abs(end - outgoingEnd) <= align;
  });
}

/**
 * Quién releva a este saliente: misma serie gana; si el código no es serie, queda el horario.
 * Con `opts.peers` (los otros salientes de la franja) el emparejamiento es FIFO: el que más
 * tiempo lleva en el puesto se lleva al primer entrante que fichó.
 */
export function relieverFor<T extends SeriesShift>(
  outgoing: T,
  candidates: readonly T[],
  opts?: SeriesPickOpts,
): T | null {
  const outgoingEnd = seriesBoundMs(outgoing, 'end');
  if (!outgoingEnd) return null;
  const pool = candidates.filter((candidate) => {
    if (!candidate) return false;
    if (sameShift(candidate, outgoing)) return false;
    if (!isReliefEligibleShift(candidate)) return false;
    if (!reliefPositionsMatch(candidate.positionName, outgoing.positionName)) return false;
    const start = seriesBoundMs(candidate, 'start');
    return incomingStartsInWindow(start, outgoingEnd, opts);
  });
  if (!pool.length) return null;
  const outs = [outgoing, ...outgoingPeersOf(outgoing, opts?.peers, opts)];
  const pair = pairReliefs(outs, pool, opts).find((row) => row.outgoing === outgoing);
  return pair?.incoming ?? null;
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

/**
 * A quién releva este entrante. Quien arranca con el hueco no es saliente; un saliente que ya
 * tiene relevo de otro (`relievedBy`) tampoco. Misma serie gana; entre iguales, el que más
 * tiempo lleva en el puesto (FIFO). Con `opts.peers` (los otros entrantes de la franja) se usa
 * el emparejamiento completo, así la tarjeta de quien todavía no fichó muestra lo que va a pasar.
 */
export function outgoingFor<T extends SeriesShift>(
  incoming: T,
  candidates: readonly T[],
  opts?: SeriesPickOpts,
): T | null {
  const gapStart = seriesBoundMs(incoming, 'start');
  if (!gapStart) return null;
  const align = opts?.alignMs ?? SHIFT_SERIES_ALIGN_MS;
  const incomingEmp = String(incoming.employeeId ?? '').trim();
  const pool = candidates.filter((candidate) => {
    if (!candidate) return false;
    if (sameShift(candidate, incoming)) return false;
    if (!isReliefEligibleShift(candidate)) return false;
    if (!reliefPositionsMatch(candidate.positionName, incoming.positionName)) return false;
    const start = seriesBoundMs(candidate, 'start');
    const end = seriesBoundMs(candidate, 'end');
    if (start <= 0 || start >= gapStart - 60_000) return false;
    if (!end || Math.abs(end - gapStart) > align) return false;
    const relievedBy = String(candidate.relievedBy ?? '').trim();
    if (relievedBy && (!incomingEmp || relievedBy !== incomingEmp)) return false;
    return true;
  });
  if (!pool.length) return null;

  if (opts?.peers?.length) {
    // Un entrante que ya relevó a otro saliente (relievedBy en el saliente o relievedOutgoingShiftId en él) no compite por este hueco.
    const takenEmps = new Set(
      candidates
        .map((candidate) => String(candidate?.relievedBy ?? '').trim())
        .filter((emp) => emp && emp !== incomingEmp),
    );
    const ins = [
      incoming,
      ...(opts.peers as T[]).filter((peer) => {
        if (!peer || sameShift(peer, incoming)) return false;
        if (pool.some((out) => sameShift(out, peer))) return false;
        const peerEmp = String(peer.employeeId ?? '').trim();
        if (peerEmp && takenEmps.has(peerEmp)) return false;
        const relieved = String(peer.relievedOutgoingShiftId ?? '').trim();
        if (relieved && !pool.some((out) => idOf(out) === relieved)) return false;
        return true;
      }),
    ];
    const pair = pairReliefs(pool, ins, { ...opts, alignMs: align }).find((row) => row.incoming === incoming);
    return pair?.outgoing ?? null;
  }

  const scored = pool
    .map((row) => ({
      row,
      kind: seriesHandoffKind(seriesCodeOf(row), seriesCodeOf(incoming)),
      dist: Math.abs(seriesBoundMs(row, 'end') - gapStart),
      since: workStartMsOf(row),
    }))
    .filter((row) => row.kind !== 'REJECT');
  if (!scored.length) return null;
  // El que ficha releva al más antiguo (FIFO); el ausente retiene al más nuevo (el que sobra).
  const newestFirst = isAbsentIncoming(incoming);
  scored.sort((a, b) => {
    const ka = a.kind === 'SERIES' ? 0 : 1;
    const kb = b.kind === 'SERIES' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.dist !== b.dist) return a.dist - b.dist;
    const fifo = compareOutgoingsFifo(a.row, b.row, opts);
    return newestFirst ? -fifo : fifo;
  });
  return scored[0].row;
}
