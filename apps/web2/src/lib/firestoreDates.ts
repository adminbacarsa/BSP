// Sin `firebase/firestore`: este helper también corre en Functions (motor del libro de horas).
// Los Timestamp del SDK cliente y del Admin SDK entran por duck typing (`toDate` / `seconds`).

/** Normaliza fechas Firestore (Timestamp, {seconds}, string) a YYYY-MM-DD para comparar rangos. */
export function toYyyyMmDd(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'object' && value !== null) {
    const o = value as {
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
      toDate?: () => Date;
    };
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === 'number') {
      const nanos = o.nanoseconds ?? o._nanoseconds ?? 0;
      const d = new Date(sec * 1000 + Math.floor(nanos / 1e6));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
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
