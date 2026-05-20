import { Timestamp } from 'firebase/firestore';

/** Normaliza fechas Firestore (Timestamp, {seconds}, string) a YYYY-MM-DD para comparar rangos. */
export function toYyyyMmDd(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Timestamp) {
    const d = value.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const o = value as { seconds: number; nanoseconds?: number };
    const d = new Timestamp(o.seconds, o.nanoseconds ?? 0).toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(value).trim().slice(0, 10);
}

/** true si el rango [startDate, endDate] solapa al menos un día del mes calendario year/month (0-based). */
export function slaCoversCalendarMonth(
  startDate: unknown,
  endDate: unknown,
  year: number,
  month: number,
): boolean {
  const startRaw = toYyyyMmDd(startDate);
  const endRaw = toYyyyMmDd(endDate);
  if (!startRaw && !endRaw) return false;
  const start = startRaw || '1970-01-01';
  const end = endRaw || '2099-12-31';
  const viewMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const viewMonthEndStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
  return start <= viewMonthEndStr && end >= viewMonthStr;
}
