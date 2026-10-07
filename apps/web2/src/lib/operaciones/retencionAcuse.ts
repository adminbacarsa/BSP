/** «vio la retención HH:MM» en la tarjeta del retenido. Misma hora que la app. */

function aMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof o.toDate === 'function') {
      const t = o.toDate().getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

export function textoAcuseRetencion(at: unknown): string | null {
  const ms = aMs(at);
  if (!ms) return null;
  const hm = new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return `vio la retención ${hm}`;
}
