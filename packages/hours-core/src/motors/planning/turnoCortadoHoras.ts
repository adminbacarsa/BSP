/**
 * Turno cortado: un solo documento con dos o más tramos en `blocks` (10–13 + 14–17).
 * La jornada es la suma de los tramos: el hueco entre ellos no se trabaja ni se paga.
 * `startTime` es el inicio del primer tramo y `endTime` el fin operativo vigente (Operaciones lo
 * corre al fin del último tramo marcado), así que `fin − inicio` incluye el hueco.
 *
 * Sin imports: lo usan el libro de horas, Liquidación, Reportes y la prefactura.
 */

/** Argentina no usa horario de verano: UTC−3 fijo. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HuecoCortado = { startMs: number; endMs: number };

function aMs(val: unknown): number | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.getTime();
  if (typeof val === 'object') {
    const o = val as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.toDate === 'function') return o.toDate().getTime();
    const s = Number(o.seconds ?? o._seconds);
    if (Number.isFinite(s) && s > 0) return s * 1000;
    return null;
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val > 1e12 ? val : val * 1000;
  if (typeof val === 'string') {
    const t = new Date(val).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function hmAMin(hm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Inicio y fin planificados de cada tramo; null si el turno no es cortado. */
export function tramosPlanificadosCortado(
  data: { blocks?: unknown; startTime?: unknown } | null | undefined,
): HuecoCortado[] | null {
  const raw = data?.blocks;
  const startMs = aMs(data?.startTime);
  if (!Array.isArray(raw) || raw.length < 2 || !startMs) return null;
  const dia = Math.floor((startMs - AR_OFFSET_MS) / DAY_MS) * DAY_MS + AR_OFFSET_MS;
  const out: HuecoCortado[] = [];
  let piso = dia;
  for (const b of raw) {
    const ini = hmAMin((b as { startTime?: unknown })?.startTime);
    const fin = hmAMin((b as { endTime?: unknown })?.endTime);
    if (ini == null || fin == null) return null;
    let s = dia + ini * 60000;
    while (s < piso) s += DAY_MS;
    let e = dia + fin * 60000;
    while (e <= s) e += DAY_MS;
    out.push({ startMs: s, endMs: e });
    piso = e;
  }
  return out;
}

/** Huecos entre tramos consecutivos según el horario planificado. */
export function huecosPlanificadosCortado(
  data: { blocks?: unknown; startTime?: unknown } | null | undefined,
): HuecoCortado[] {
  const tramos = tramosPlanificadosCortado(data);
  if (!tramos) return [];
  const out: HuecoCortado[] = [];
  for (let i = 0; i < tramos.length - 1; i += 1) {
    if (tramos[i + 1].startMs > tramos[i].endMs) out.push({ startMs: tramos[i].endMs, endMs: tramos[i + 1].startMs });
  }
  return out;
}

/**
 * Huecos entre tramos con la presencia real: desde el egreso real del tramo (o su fin planificado)
 * hasta el ingreso real del siguiente (o su inicio planificado).
 */
export function huecosRealesCortado(
  data: { blocks?: unknown; startTime?: unknown; presenciaBloques?: unknown } | null | undefined,
): HuecoCortado[] {
  const tramos = tramosPlanificadosCortado(data);
  if (!tramos) return [];
  const pb = (data?.presenciaBloques && typeof data.presenciaBloques === 'object'
    ? data.presenciaBloques
    : {}) as Record<string, { realStartTime?: unknown; realEndTime?: unknown } | null | undefined>;
  const out: HuecoCortado[] = [];
  for (let i = 0; i < tramos.length - 1; i += 1) {
    const finReal = aMs(pb[`b${i + 1}`]?.realEndTime) ?? tramos[i].endMs;
    const inicioSig = aMs(pb[`b${i + 2}`]?.realStartTime) ?? tramos[i + 1].startMs;
    if (inicioSig > finReal) out.push({ startMs: finReal, endMs: inicioSig });
  }
  return out;
}

/** Milisegundos de `huecos` que caen dentro de [desdeMs, hastaMs]. */
export function solapeHuecosMs(huecos: readonly HuecoCortado[], desdeMs: number, hastaMs: number): number {
  let n = 0;
  for (const h of huecos) n += Math.max(0, Math.min(h.endMs, hastaMs) - Math.max(h.startMs, desdeMs));
  return n;
}

/** Horas del hueco entre tramos que quedan dentro de [desde, hasta] (reloj planificado). */
export function horasHuecoCortado(
  data: { blocks?: unknown; startTime?: unknown } | null | undefined,
  desde: Date,
  hasta: Date,
): number {
  return solapeHuecosMs(huecosPlanificadosCortado(data), desde.getTime(), hasta.getTime()) / 3600000;
}
