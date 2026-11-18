/**
 * Turno cortado: un solo documento de `turnos` con dos (o más) tramos en `blocks`.
 * `startTime`/`endTime` son los del primer tramo; al fichar un tramo posterior el CC corre `endTime`
 * al fin de ese tramo. El cierre automático y la ausencia automática no pueden tratar el fin del
 * primer tramo como fin del turno ni el corte entre tramos como una ausencia.
 *
 * Sin imports: lo usan los jobs de functions y se prueba suelto con node --test.
 */

/** Argentina no usa horario de verano: UTC−3 fijo. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BloqueTurnoCortado = { startTime: string; endTime: string };

type TimestampLike = { toMillis?: () => number } | null | undefined;

type TurnoCortadoData = {
  blocks?: unknown;
  startTime?: TimestampLike;
  endTime?: TimestampLike;
  isPresent?: unknown;
  realStartTime?: unknown;
  presenciaBloques?: unknown;
};

function hmAMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Los tramos válidos del turno; null si el turno es de un solo horario. */
export function bloquesDeTurnoCortado(data: { blocks?: unknown } | null | undefined): BloqueTurnoCortado[] | null {
  const raw = data?.blocks;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = raw
    .map((b) => ({
      startTime: String((b as { startTime?: unknown })?.startTime || '').slice(0, 5),
      endTime: String((b as { endTime?: unknown })?.endTime || '').slice(0, 5),
    }))
    .filter((b) => hmAMin(b.startTime) !== null && hmAMin(b.endTime) !== null);
  return out.length >= 2 ? out : null;
}

/** Inicio y fin (ms) de cada tramo, a partir del día AR en que arranca el primero. */
export function tramosDeTurnoCortado(
  startMs: number,
  bloques: readonly BloqueTurnoCortado[],
): Array<{ startMs: number; endMs: number }> {
  const dia = Math.floor((startMs - AR_OFFSET_MS) / DAY_MS) * DAY_MS + AR_OFFSET_MS;
  const out: Array<{ startMs: number; endMs: number }> = [];
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

/**
 * Fin real del turno cortado: el del último tramo (o el `endTime` del documento si ya es posterior).
 * 0 si el turno no es cortado o no tiene inicio.
 */
export function finUltimoTramoMs(data: TurnoCortadoData | null | undefined): number {
  const bloques = bloquesDeTurnoCortado(data);
  const startMs = data?.startTime?.toMillis?.() ?? 0;
  if (!bloques || !startMs) return 0;
  const tramos = tramosDeTurnoCortado(startMs, bloques);
  const ultimo = tramos[tramos.length - 1]?.endMs ?? 0;
  const docEnd = data?.endTime?.toMillis?.() ?? 0;
  return Math.max(ultimo, docEnd);
}

/** El turno cortado ya tuvo presencia en algún tramo (ingresó, aunque el corte lo deje en PENDING). */
export function turnoCortadoConPresencia(data: TurnoCortadoData | null | undefined): boolean {
  if (!bloquesDeTurnoCortado(data)) return false;
  if (data?.isPresent === true || data?.realStartTime) return true;
  const pb = data?.presenciaBloques;
  if (!pb || typeof pb !== 'object') return false;
  return Object.values(pb as Record<string, { realStartTime?: unknown } | null | undefined>)
    .some((t) => !!t?.realStartTime);
}

/** Apertura de la fichada de cada tramo: 15 min antes de su inicio. */
export const VENTANA_ANTES_TRAMO_MS = 15 * 60 * 1000;

/**
 * El tramo `n` (1-based) ya tiene ingreso. El tramo 1 usa los campos del turno
 * (o `presenciaBloques.b1`); los demás viven en `presenciaBloques.bN`.
 */
export function tramoConPresencia(data: TurnoCortadoData | null | undefined, n: number): boolean {
  const pb = data?.presenciaBloques as Record<string, { realStartTime?: unknown } | null | undefined> | undefined;
  if (pb && typeof pb === 'object' && pb[`b${n}`]?.realStartTime) return true;
  if (n === 1) return data?.isPresent === true || !!data?.realStartTime;
  return false;
}

export type PlanFichadaTramo =
  | { tipo: 'normal' }
  | { tipo: 'ya'; tramo: number }
  | { tipo: 'tramo'; tramo: number; startMs: number; endMs: number };

/**
 * Qué tramo corresponde fichar en `nowMs`. Turno de un solo horario, o cortado dentro del
 * tramo 1: `normal`. Desde 15 min antes del tramo N (≥ 2): si ese tramo ya tiene ingreso,
 * `ya`; si el anterior tiene ingreso, `tramo` (hay que fichar el N). Sin ingreso previo
 * cae al flujo normal, que rechaza la fichada.
 */
export function planFichadaTramo(data: TurnoCortadoData | null | undefined, nowMs: number): PlanFichadaTramo {
  const bloques = bloquesDeTurnoCortado(data);
  const startMs = data?.startTime?.toMillis?.() ?? 0;
  if (!bloques || !startMs) return { tipo: 'normal' };
  const tramos = tramosDeTurnoCortado(startMs, bloques);
  for (let n = tramos.length; n >= 2; n -= 1) {
    const t = tramos[n - 1];
    if (nowMs < t.startMs - VENTANA_ANTES_TRAMO_MS) continue;
    if (tramoConPresencia(data, n)) return { tipo: 'ya', tramo: n };
    if (tramoConPresencia(data, n - 1)) return { tipo: 'tramo', tramo: n, startMs: t.startMs, endMs: t.endMs };
  }
  return { tipo: 'normal' };
}

/** Sigue abierto: es un turno cortado y todavía no terminó su último tramo. */
export function turnoCortadoEnCurso(data: TurnoCortadoData | null | undefined, nowMs: number): boolean {
  const fin = finUltimoTramoMs(data);
  return fin > 0 && nowMs < fin;
}
