/**
 * Política de retención COSP (hot / warm / cold).
 *
 * - Hot: mes en curso + 2 meses calendario cerrados
 * - Warm: hasta 12 meses calendario hacia atrás (incluye hot); historial app
 * - Cold: anterior a esos 12 meses → no operar online (export/backup)
 *
 * Zona: fechas de calendario en local/AR; usar year+month 1–12 en APIs de UI.
 */

export type ArchiveTier = 'hot' | 'warm' | 'cold';

/** Meses cerrados previos que siguen en hot (además del mes en curso). */
export const HOT_CLOSED_MONTHS = 2;

/**
 * Cantidad de meses calendario accesibles online contando el mes en curso.
 * Sep 2026 → desde Oct 2025 inclusive (12 meses).
 */
export const ONLINE_MONTHS_SPAN = 12;

export type YearMonth = { year: number; month: number }; // month 1–12

export function toYearMonth(d: Date): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function yearMonthKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

/** Resta `delta` meses calendario a un YearMonth. */
export function addCalendarMonths(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Primer y último instante del mes calendario. */
export function calendarMonthBounds(ym: YearMonth): { start: Date; end: Date } {
  return {
    start: new Date(ym.year, ym.month - 1, 1, 0, 0, 0, 0),
    end: new Date(ym.year, ym.month, 0, 23, 59, 59, 999),
  };
}

/** Meses hot: actual + HOT_CLOSED_MONTHS cerrados (orden cronológico). */
export function hotYearMonths(now = new Date()): YearMonth[] {
  const cur = toYearMonth(now);
  const out: YearMonth[] = [];
  for (let i = HOT_CLOSED_MONTHS; i >= 0; i -= 1) {
    out.push(addCalendarMonths(cur, -i));
  }
  return out;
}

/** Ventana hot como rango de fechas [start, end]. */
export function hotWindow(now = new Date()): { start: Date; end: Date; months: YearMonth[] } {
  const months = hotYearMonths(now);
  const start = calendarMonthBounds(months[0]).start;
  const end = calendarMonthBounds(months[months.length - 1]).end;
  return { start, end, months };
}

/**
 * Mes más viejo aún online (warm+hot).
 * Span = ONLINE_MONTHS_SPAN meses inclusive del actual.
 */
export function onlineOldestYearMonth(now = new Date()): YearMonth {
  const cur = toYearMonth(now);
  return addCalendarMonths(cur, -(ONLINE_MONTHS_SPAN - 1));
}

/** Warm = online pero no hot (histórico app). */
export function warmWindow(now = new Date()): { start: Date; end: Date } {
  const hot = hotWindow(now);
  const oldest = onlineOldestYearMonth(now);
  const warmStart = calendarMonthBounds(oldest).start;
  // Fin warm = día anterior al inicio hot (si oldest cae dentro de hot, warm vacío)
  const warmEndMs = hot.start.getTime() - 1;
  return {
    start: warmStart,
    end: new Date(Math.max(warmStart.getTime(), warmEndMs)),
  };
}

export function classifyYearMonth(year: number, month: number, now = new Date()): ArchiveTier {
  const ym = { year, month };
  const hot = hotYearMonths(now);
  if (hot.some((h) => h.year === ym.year && h.month === ym.month)) return 'hot';
  const oldest = onlineOldestYearMonth(now);
  if (compareYearMonth(ym, oldest) >= 0) return 'warm';
  return 'cold';
}

export function classifyDate(d: Date, now = new Date()): ArchiveTier {
  return classifyYearMonth(d.getFullYear(), d.getMonth() + 1, now);
}

export function isOnlineYearMonth(year: number, month: number, now = new Date()): boolean {
  return classifyYearMonth(year, month, now) !== 'cold';
}

export function isHotYearMonth(year: number, month: number, now = new Date()): boolean {
  return classifyYearMonth(year, month, now) === 'hot';
}

/**
 * Navegación planificación / reportes.
 * - hot: OK
 * - warm: OK con aviso (historial)
 * - cold: bloqueado
 */
export function planningMonthAccess(
  year: number,
  month: number,
  now = new Date(),
): { allowed: boolean; tier: ArchiveTier; message: string } {
  const tier = classifyYearMonth(year, month, now);
  const label = new Date(year, month - 1, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
  if (tier === 'hot') {
    return { allowed: true, tier, message: '' };
  }
  if (tier === 'warm') {
    return {
      allowed: true,
      tier,
      message: `${label}: historial (warm). Solo consulta/corrección puntual — no es la malla operativa.`,
    };
  }
  return {
    allowed: false,
    tier,
    message: `${label} está fuera de la ventana online (máx. ${ONLINE_MONTHS_SPAN} meses). Pedí export/cold storage.`,
  };
}

/** Texto corto para UI / CLAUDE. */
export function retentionPolicySummary(): string {
  return (
    `Hot = mes en curso + ${HOT_CLOSED_MONTHS} cerrados; ` +
    `Warm/online = últimos ${ONLINE_MONTHS_SPAN} meses; ` +
    `Cold = anteriores.`
  );
}
