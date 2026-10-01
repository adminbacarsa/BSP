import { isOpsCoverageHoursOnSourceDoc } from './coverageSemantics';
import { NON_RELIEF_EXTRA_CODES, isReliefEligibleShift } from './reliefEligibility';
import { formatHmAR } from './retentionDisplay';
import {
  SHIFT_SERIES_ALIGN_MS,
  isRecognizedSeriesCode,
  keepsNextBandSlot,
  seriesBoundMs,
  seriesCodeOf,
  seriesHandoffKind,
  type SeriesShift,
} from './shiftSeries';

/**
 * Entre el fin planificado y el cierre del cron. Espejo de
 * `nextBandSlotsFromSlaDoc` / `positionHasContinuityFromSlaDoc`
 * (`apps/functions/src/coverage/positionHasContinuity.ts`) más el cupo
 * `keepsNextBandSlot` y el fin de servicio sin cronograma.
 *
 * Devuelve el texto gris de la tarjeta, o `null` cuando sí hay que mostrar
 * ESPERANDO RELEVO (hay franja siguiente y este saliente conserva un lugar).
 */

const TZ = 'America/Argentina/Cordoba';
const CONTINUITY_WINDOW_MS = 30 * 60 * 1000;
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const HORARIOS: Record<string, { startTime: string; endTime: string }> = {
  M: { startTime: '06:00', endTime: '14:00' },
  T: { startTime: '14:00', endTime: '22:00' },
  N: { startTime: '22:00', endTime: '06:00' },
  D12: { startTime: '07:00', endTime: '19:00' },
  N12: { startTime: '19:00', endTime: '07:00' },
};

export type CierreSinContinuidadInput = {
  /** Docs `servicios_sla` del objetivo (raw: `positions[].allowedShiftTypes`). */
  slaDocs?: readonly Record<string, unknown>[] | null;
  positionName?: unknown;
  shiftEnd: Date;
  outgoingCode?: unknown;
  outgoing: SeriesShift;
  /** Turnos del mismo objetivo. El cupo se resuelve entre los salientes de la misma serie. */
  siblings?: readonly SeriesShift[];
  /** El fin cae en un mes cuyo cronograma no está publicado. */
  finServicioSinCronograma?: boolean;
};

function normPos(n: unknown): string {
  return String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
}

function posMatch(a: unknown, b: unknown): boolean {
  const na = normPos(a);
  const nb = normPos(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.endsWith(nb) || nb.endsWith(na);
}

function ymdInTz(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function weekdayLetter(d: Date): string {
  const en = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
  const map: Record<string, string> = { Mon: 'L', Tue: 'M', Wed: 'X', Thu: 'J', Fri: 'V', Sat: 'S', Sun: 'D' };
  return map[en] || 'L';
}

function datePrefix(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return ymdInTz(value);
  if (typeof value === 'object') {
    const o = value as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return ymdInTz(o.toDate());
    if (typeof o.seconds === 'number') return ymdInTz(new Date(o.seconds * 1000));
  }
  return String(value).trim().slice(0, 10);
}

function slaVigente(doc: Record<string, unknown>, dateStr: string): boolean {
  const start = datePrefix(doc.startDate);
  const end = datePrefix(doc.endDate);
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

function hmToMsOnDay(anchor: Date, hm: string): number {
  const [h, m] = String(hm || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(anchor);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const mo = parts.find((p) => p.type === 'month')?.value || '01';
  const da = parts.find((p) => p.type === 'day')?.value || '01';
  const utcGuess = Date.parse(`${y}-${mo}-${da}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
  return Number.isNaN(utcGuess) ? anchor.getTime() : utcGuess;
}

type Banda = { code: string; startTime: string; days: string[]; excludedDates: string[]; quantity: number };

function bandasDe(pos: Record<string, unknown>, slaExcluded: string[]): Banda[] {
  const raw = (pos.allowedShiftTypes ?? pos.shifts) as Record<string, unknown>[] | undefined;
  const active = (pos.activeDays as string[] | undefined)?.length ? (pos.activeDays as string[]) : [...DIAS];
  const posExcluded = (pos.excludedDates as string[] | undefined) || [];
  const excluded = [...new Set([...slaExcluded, ...posExcluded])];
  const fallbackQty = Number(pos.quantity);
  const qtyOf = (row: Record<string, unknown> | null): number => {
    const q = Number(row?.quantity);
    if (Number.isFinite(q) && q >= 0) return q;
    return Number.isFinite(fallbackQty) && fallbackQty >= 0 ? fallbackQty : 1;
  };
  if (raw && raw.length > 0) {
    return raw.map((row) => ({
      code: String(row.code || '').toUpperCase(),
      startTime: String(row.startTime || '06:00'),
      days: (row.days as string[] | undefined)?.length ? (row.days as string[]) : active,
      excludedDates: excluded,
      quantity: qtyOf(row),
    }));
  }
  const cv = String(pos.coverageType || '').toLowerCase();
  const codes = cv === '12hs_diurno' ? ['D12'] : cv === '12hs_nocturno' ? ['N12'] : ['M', 'T', 'N'];
  return codes.map((code) => ({
    code,
    startTime: HORARIOS[code].startTime,
    days: active,
    excludedDates: excluded,
    quantity: qtyOf(null),
  }));
}

/** Lugares de la franja que empieza al terminar el turno. `null` = sin continuidad. */
function nextBandSlotsFromSlaDoc(
  slaDoc: Record<string, unknown> | null | undefined,
  positionName: string,
  shiftEnd: Date,
  outgoingCode: unknown,
): number | null {
  if (!slaDoc) return null;
  const dateStr = ymdInTz(shiftEnd);
  if (!slaVigente(slaDoc, dateStr)) return null;
  const positions = (slaDoc.positions as Record<string, unknown>[]) || [];
  const pos = positions.find((p) => posMatch(p.name, positionName));
  if (!pos) return null;
  const excludedMap = pos.excludedShiftDates as Record<string, string[]> | undefined;
  const dayLetter = weekdayLetter(shiftEnd);
  const endMs = shiftEnd.getTime();
  let slots: number | null = null;
  for (const banda of bandasDe(pos, (slaDoc.excludedDates as string[]) || [])) {
    if (!banda.code || NON_RELIEF_EXTRA_CODES.has(banda.code)) continue;
    if (outgoingCode != null && String(outgoingCode).trim() && seriesHandoffKind(outgoingCode, banda.code) === 'REJECT') continue;
    if (banda.excludedDates.includes(dateStr)) continue;
    if (banda.days.length > 0 && !banda.days.includes(dayLetter)) continue;
    const banned = excludedMap?.[dateStr];
    if (banned?.some((c) => String(c || '').toUpperCase() === banda.code)) continue;
    const startMs = hmToMsOnDay(shiftEnd, banda.startTime);
    if (Math.abs(startMs - endMs) <= CONTINUITY_WINDOW_MS) {
      slots = (slots ?? 0) + banda.quantity;
    }
  }
  return slots;
}

function salientesDeLaFranja(outgoing: SeriesShift, siblings: readonly SeriesShift[], endMs: number): SeriesShift[] {
  const outCode = seriesCodeOf(outgoing);
  const pool = siblings.some((s) => s === outgoing || (s.id && outgoing.id && String(s.id) === String(outgoing.id)))
    ? siblings
    : [outgoing, ...siblings];
  return pool.filter((row) => {
    if (!row) return false;
    if (row === outgoing || (row.id && outgoing.id && String(row.id) === String(outgoing.id))) return true;
    if (isOpsCoverageHoursOnSourceDoc(row)) return false;
    if (!isReliefEligibleShift(row)) return false;
    if (row.isAbsent === true || String(row.status || '').toUpperCase() === 'ABSENT') return false;
    const eid = String(row.employeeId || '').trim();
    if (!eid || eid === 'VACANTE' || row.isUnassigned === true) return false;
    const worked = row.isPresent === true || !!(row.realStartTime || row.checkInAt || row.checkInTime);
    if (!worked) return false;
    if (!posMatch(row.positionName, outgoing.positionName)) return false;
    const en = seriesBoundMs(row, 'end');
    if (!en || Math.abs(en - endMs) > SHIFT_SERIES_ALIGN_MS) return false;
    const code = seriesCodeOf(row);
    if (isRecognizedSeriesCode(outCode) && isRecognizedSeriesCode(code) && code !== outCode) return false;
    return true;
  });
}

export function etiquetaCierreSinContinuidad(input: CierreSinContinuidadInput): string | null {
  const hm = formatHmAR(input.shiftEnd.getTime());
  const sinFranja = `CIERRA ${hm} · sin franja siguiente`;
  if (input.finServicioSinCronograma) return sinFranja;
  let slots: number | null = null;
  for (const doc of input.slaDocs || []) {
    const n = nextBandSlotsFromSlaDoc(doc, String(input.positionName || ''), input.shiftEnd, input.outgoingCode);
    if (n != null) slots = Math.max(slots ?? 0, n);
  }
  if (slots == null) return sinFranja;
  const endMs = input.shiftEnd.getTime();
  const salientes = salientesDeLaFranja(input.outgoing, input.siblings || [], endMs);
  if (!keepsNextBandSlot(input.outgoing, salientes, slots)) {
    return `CIERRA ${hm} · sin lugar en la franja siguiente`;
  }
  return null;
}
