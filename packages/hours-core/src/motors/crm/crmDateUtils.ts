export const toDateSafe = (val: unknown): Date | null => {
  if (!val) return null;
  const v = val as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function getDateKeyInTimezone(date: Date): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  return `${year}-${month}-${day}`;
}

/** Fecha de celda del cronograma (columna del mes). Prioriza scheduleDate guardado al asignar. */
export function resolveTurnoScheduleDateKey(t: Record<string, unknown> | null | undefined): string | null {
  if (!t) return null;
  for (const field of ['scheduleDate', 'planningDate', 'fecha']) {
    const raw = String(t[field] ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  const st = toDateSafe(t.startTime);
  if (!st) return null;
  return getDateKeyInTimezone(st);
}
