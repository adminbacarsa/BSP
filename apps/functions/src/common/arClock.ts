/** Argentina no usa horario de verano: UTC−3 fijo, independiente del TZ del proceso (Functions corre en UTC). */
export const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 AR del día calendario AR que contiene `ms`. */
export function arMidnightMs(ms: number): number {
  return Math.floor((ms - AR_OFFSET_MS) / DAY_MS) * DAY_MS + AR_OFFSET_MS;
}

/** Hora AR (0–23) de `ms`. */
export function arHour(ms: number): number {
  return new Date(ms - AR_OFFSET_MS).getUTCHours();
}

/** Día calendario AR `YYYY-MM-DD` de `ms`. */
export function arYmd(ms: number): string {
  return new Date(ms - AR_OFFSET_MS).toISOString().slice(0, 10);
}

/** HH:mm AR sobre el día calendario AR de `dayMs`. */
export function arHmOnDayMs(dayMs: number, h: number, m: number): number {
  return arMidnightMs(dayMs) + (h * 60 + m) * 60 * 1000;
}

/** HH:mm AR sobre el día `YYYY-MM-DD`. */
export function arHmOnYmdMs(ymd: string, h: number, m: number): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  return Date.UTC(y, (mo || 1) - 1, d || 1) + AR_OFFSET_MS + (h * 60 + m) * 60 * 1000;
}

/** Día calendario AR que contiene `ms`: 00:00:00 a 23:59:59 AR. */
export function arDayBoundsMs(ms: number): { startMs: number; endMs: number } {
  const startMs = arMidnightMs(ms);
  return { startMs, endMs: startMs + DAY_MS - 1000 };
}
