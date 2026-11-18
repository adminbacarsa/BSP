import type { Shift } from '@cosp/portal-types';
import { toDate } from '../utils/dates';

/** Argentina no usa horario de verano: UTC−3 fijo. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Apertura de la fichada de cada tramo: 15 min antes de su inicio (espejo de functions). */
const VENTANA_ANTES_TRAMO_MS = 15 * 60 * 1000;

type Bloque = { startTime: string; endTime: string };
type Tramo = { startMs: number; endMs: number };

function hmAMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function bloquesDeTurnoCortado(shift: { blocks?: unknown } | null | undefined): Bloque[] | null {
  const raw = shift?.blocks;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = raw
    .map((b) => ({
      startTime: String((b as { startTime?: unknown })?.startTime || '').slice(0, 5),
      endTime: String((b as { endTime?: unknown })?.endTime || '').slice(0, 5),
    }))
    .filter((b) => hmAMin(b.startTime) !== null && hmAMin(b.endTime) !== null);
  return out.length >= 2 ? out : null;
}

export function tramosDeTurnoCortado(startMs: number, bloques: readonly Bloque[]): Tramo[] {
  const dia = Math.floor((startMs - AR_OFFSET_MS) / DAY_MS) * DAY_MS + AR_OFFSET_MS;
  const out: Tramo[] = [];
  let piso = dia;
  for (const b of bloques) {
    let s = dia + (hmAMin(b.startTime) as number) * 60000;
    while (s < piso) s += DAY_MS;
    let e = dia + (hmAMin(b.endTime) as number) * 60000;
    while (e <= s) e += DAY_MS;
    out.push({ startMs: s, endMs: e });
    piso = e;
  }
  return out;
}

type PresenciaBloques = Record<string, { realStartTime?: unknown; checkInAt?: unknown } | null | undefined>;

function presenciaDe(shift: Shift): PresenciaBloques {
  const pb = (shift as { presenciaBloques?: unknown }).presenciaBloques;
  return pb && typeof pb === 'object' ? (pb as PresenciaBloques) : {};
}

function tramoConPresencia(shift: Shift, n: number): boolean {
  if (presenciaDe(shift)[`b${n}`]?.realStartTime) return true;
  if (n === 1) return shift.isPresent === true || !!shift.realStartTime;
  return false;
}

/**
 * Qué tramo del turno cortado se muestra y ficha en `nowMs` (espejo de `planFichadaTramo` en functions).
 * `null` si el turno no es cortado o sigue en el tramo 1: se muestra tal cual.
 */
export function tramoActivoDeTurnoCortado(
  shift: Shift,
  nowMs: number,
): { tipo: 'ya' | 'tramo'; tramo: number; startMs: number; endMs: number } | null {
  const bloques = bloquesDeTurnoCortado(shift as { blocks?: unknown });
  const inicio = toDate(shift.startTime)?.getTime() ?? 0;
  if (!bloques || !inicio) return null;
  const tramos = tramosDeTurnoCortado(inicio, bloques);
  for (let n = tramos.length; n >= 2; n -= 1) {
    const t = tramos[n - 1];
    if (nowMs < t.startMs - VENTANA_ANTES_TRAMO_MS) continue;
    if (tramoConPresencia(shift, n)) return { tipo: 'ya', tramo: n, ...t };
    if (tramoConPresencia(shift, n - 1)) return { tipo: 'tramo', tramo: n, ...t };
  }
  return null;
}

/**
 * El turno tal como lo ve el guardia ahora. Un turno cortado en su tramo 2+ se muestra con el
 * horario de ese tramo: sin ingreso («Listo para fichar») o con el ingreso de ese tramo. El
 * `id` es el mismo: la fichada va al mismo documento y el servidor decide el tramo.
 */
export function vistaTurnoCortado(shift: Shift, nowMs: number): Shift {
  const activo = tramoActivoDeTurnoCortado(shift, nowMs);
  if (!activo) return shift;
  const base = { ...shift, startTime: new Date(activo.startMs), endTime: new Date(activo.endMs) } as Shift;
  if (activo.tipo === 'tramo') {
    return {
      ...base,
      isPresent: false,
      status: 'PENDING',
      isCompleted: false,
      checkInTime: null,
      checkInAt: null,
      realStartTime: null,
      presentAt: null,
      lateArrivalAt: null,
    } as Shift;
  }
  const pb = presenciaDe(shift)[`b${activo.tramo}`];
  return {
    ...base,
    realStartTime: (pb?.realStartTime ?? shift.realStartTime) as Shift['realStartTime'],
    checkInAt: (pb?.checkInAt ?? shift.checkInAt) as Shift['checkInAt'],
  } as Shift;
}

/** Algún turno de la lista es cortado: hace falta refrescar la vista con el reloj. */
export function hayTurnoCortado(shifts: readonly Shift[]): boolean {
  return shifts.some((s) => bloquesDeTurnoCortado(s as { blocks?: unknown }) !== null);
}
