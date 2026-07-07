/**
 * Fechas operativas VPLAN — alineado al planificador (America/Argentina/Cordoba).
 * Turnos N con startTime UTC pueden caer en el día calendario AR anterior.
 */

import { Timestamp } from 'firebase-admin/firestore';

export const VPLAN_AR_TIMEZONE = 'America/Argentina/Cordoba';

function timestampToDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const s = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  return null;
}

/** YYYY-MM-DD en zona Argentina (misma lógica que getDateKey del planificador). */
export function formatDateStrCordoba(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = Date.parse(s);
    if (!Number.isFinite(parsed)) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: VPLAN_AR_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(parsed));
  }
  const d = timestampToDate(val);
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VPLAN_AR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
