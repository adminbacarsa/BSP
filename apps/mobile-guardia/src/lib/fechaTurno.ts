/**
 * Fecha visible de un turno (hora Argentina).
 * Hoy / Mañana cuando cae en esos días; si no, «Sáb 17/10».
 * Si el fin es otro día: «Hoy 23:00–Mañana 07:00».
 */
const TZ = 'America/Argentina/Buenos_Aires';
const WEEKDAY = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export function toDateTurno(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    const o = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
    return null;
  }
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function arYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function arHm(d: Date): string {
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ,
  });
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function weekdayOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** «Hoy» | «Mañana» | «Sáb 17/10». `ymd` es yyyy-MM-dd en calendario AR. */
export function etiquetaDiaYmd(ymd: string, now = new Date()): string {
  const today = arYmd(now);
  if (ymd === today) return 'Hoy';
  if (ymd === addDaysYmd(today, 1)) return 'Mañana';
  const [, m, d] = ymd.split('-');
  return `${weekdayOfYmd(ymd)} ${d}/${m}`;
}

/**
 * «Hoy · 10:00–20:00» | «Mañana · 10:00–20:00» | «Sáb 17/10 · 10:00–20:00».
 * Si cruza medianoche: «Hoy 23:00–Mañana 07:00».
 */
export function formatCuandoTurno(start: unknown, end?: unknown, now = new Date()): string | null {
  const s = toDateTurno(start);
  if (!s) return null;
  const hi = arHm(s);
  const startYmd = arYmd(s);
  const e = toDateTurno(end);
  if (!e) return `${etiquetaDiaYmd(startYmd, now)} · ${hi}`;
  const hf = arHm(e);
  const endYmd = arYmd(e);
  if (startYmd !== endYmd) {
    return `${etiquetaDiaYmd(startYmd, now)} ${hi}–${etiquetaDiaYmd(endYmd, now)} ${hf}`;
  }
  return `${etiquetaDiaYmd(startYmd, now)} · ${hi}–${hf}`;
}

/**
 * Arma el mismo texto desde la fecha `dd/MM/yyyy` y el horario `HH:MM–HH:MM`
 * que ya guarda la tarjeta de convocatoria.
 */
export function formatCuandoDesdePartes(
  fecha: string | null | undefined,
  horario: string | null | undefined,
  now = new Date(),
): string | null {
  const m = String(fecha || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) {
    const fallback = [fecha, horario].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
    return fallback || null;
  }
  const ymd = `${m[3]}-${m[2]}-${m[1]}`;
  const hm = String(horario || '').trim().match(/^(\d{2}:\d{2})(?:–(\d{2}:\d{2}))?$/);
  if (!hm) return etiquetaDiaYmd(ymd, now);
  const start = `${ymd}T${hm[1]}:00-03:00`;
  if (!hm[2]) return formatCuandoTurno(start, undefined, now);
  const endYmd = hm[2] < hm[1] ? addDaysYmd(ymd, 1) : ymd;
  return formatCuandoTurno(start, `${endYmd}T${hm[2]}:00-03:00`, now);
}

/** Línea de una jornada de consulta: «Mañana · M 07:00–15:00» o «Jue 15/10 · M 07:00–15:00». */
export function formatLineaJornada(
  fechaYmd: string,
  code: string,
  horaInicio: string,
  horaFin: string,
  now = new Date(),
): string {
  const ymd = String(fechaYmd || '').slice(0, 10);
  const hi = String(horaInicio || '').slice(0, 5);
  const hf = String(horaFin || '').slice(0, 5);
  const dia = etiquetaDiaYmd(ymd, now);
  const sigla = String(code || '').trim();
  const pref = sigla ? `${sigla} ` : '';
  if (hi && hf && hf < hi) {
    return `${dia} · ${pref}${hi}–${etiquetaDiaYmd(addDaysYmd(ymd, 1), now)} ${hf}`;
  }
  const rango = hi && hf ? `${hi}–${hf}` : hi || hf;
  return rango ? `${dia} · ${pref}${rango}` : `${dia}${sigla ? ` · ${sigla}` : ''}`;
}
