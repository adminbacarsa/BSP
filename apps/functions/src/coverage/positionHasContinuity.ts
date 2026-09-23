import type { Firestore } from 'firebase-admin/firestore';
import { normalizarSlaDeFirestore } from '../cerebro/types';
import { leerSlaYDerivarCobertura } from '../cerebro/inteligencia-servicio/s1-leer-sla';

const TZ = 'America/Argentina/Cordoba';
const CONTINUITY_WINDOW_MS = 30 * 60 * 1000;

const normPos = (n: unknown): string =>
  String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');

function posMatch(a: unknown, b: unknown): boolean {
  const na = normPos(a);
  const nb = normPos(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith(nb) || nb.endsWith(na)) return true;
  return false;
}

function ymdInTz(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function weekdayLetter(d: Date): string {
  const en = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
  const map: Record<string, string> = {
    Mon: 'L',
    Tue: 'M',
    Wed: 'X',
    Thu: 'J',
    Fri: 'V',
    Sat: 'S',
    Sun: 'D',
  };
  return map[en] || 'L';
}

function slaVigenteEnFecha(slaDoc: Record<string, unknown>, dateStr: string): boolean {
  const start = String(slaDoc.startDate || '').trim();
  const end = String(slaDoc.endDate || '').trim();
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

function findRawPosition(slaDoc: Record<string, unknown>, positionName: string): Record<string, unknown> | null {
  const positions: Record<string, unknown>[] = (slaDoc.positions as Record<string, unknown>[]) || [];
  const target = normPos(positionName);
  for (const p of positions) {
    if (posMatch(p.name, positionName)) return p;
    if (target && normPos(p.name) === target) return p;
  }
  return null;
}

function isBandExcludedOnDate(
  pos: Record<string, unknown> | null,
  dateStr: string,
  bandCode: string,
): boolean {
  if (!pos) return false;
  const map = pos.excludedShiftDates as Record<string, string[]> | undefined;
  const codes = map?.[dateStr];
  if (!codes?.length) return false;
  const u = String(bandCode || '').toUpperCase();
  return codes.some((c) => String(c || '').toUpperCase() === u);
}

/** Minutos desde medianoche AR para HH:mm en la fecha calendario de `anchor`. */
function hmToMsOnDay(anchor: Date, hm: string): number {
  const [h, m] = String(hm || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(anchor);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const mo = parts.find((p) => p.type === 'month')?.value || '01';
  const da = parts.find((p) => p.type === 'day')?.value || '01';
  const iso = `${y}-${mo}-${da}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const utcGuess = Date.parse(`${iso}-03:00`);
  if (!Number.isNaN(utcGuess)) return utcGuess;
  return anchor.getTime();
}

/**
 * True si el SLA define un turno que EMPIEZA dentro de ±30 min del fin del turno saliente,
 * en día activo y no excluido (America/Argentina/Cordoba).
 */
export function positionHasContinuityFromSlaDoc(
  slaDoc: Record<string, unknown> | null | undefined,
  positionName: string,
  shiftEndTime: Date,
): boolean {
  if (!slaDoc) return false;
  const dateStr = ymdInTz(shiftEndTime);
  if (!slaVigenteEnFecha(slaDoc, dateStr)) return false;

  const rawPos = findRawPosition(slaDoc, positionName);
  const sla = normalizarSlaDeFirestore({ ...slaDoc, id: slaDoc.id || 'sla' });
  const needs = leerSlaYDerivarCobertura(sla);
  const endMs = shiftEndTime.getTime();
  const dayLetter = weekdayLetter(shiftEndTime);

  for (const need of needs) {
    if (!posMatch(need.puestoName, positionName)) continue;
    if (need.excludedDates?.includes(dateStr)) continue;
    if (!need.diasSemana.includes(dayLetter)) continue;
    if (isBandExcludedOnDate(rawPos, dateStr, need.banda)) continue;
    const startMs = hmToMsOnDay(shiftEndTime, need.horaInicio);
    const diff = Math.abs(startMs - endMs);
    if (diff <= CONTINUITY_WINDOW_MS) return true;
  }
  return false;
}

export async function loadPositionHasContinuity(
  db: Firestore,
  objectiveId: string,
  positionName: string,
  shiftEndTime: Date,
): Promise<boolean> {
  const oid = String(objectiveId || '').trim();
  if (!oid) return false;
  const slaSnap = await db
    .collection('servicios_sla')
    .where('objectiveId', '==', oid)
    .where('status', '==', 'active')
    .limit(3)
    .get();
  for (const d of slaSnap.docs) {
    if (positionHasContinuityFromSlaDoc(d.data(), positionName, shiftEndTime)) {
      return true;
    }
  }
  return false;
}
