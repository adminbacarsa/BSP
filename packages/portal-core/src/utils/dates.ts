import type { FirestoreTimestampLike } from '@cosp/portal-types';

export function toDate(val: FirestoreTimestampLike): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
  const seconds = typeof val === 'object' ? (val.seconds ?? val._seconds) : undefined;
  if (typeof seconds === 'number') return new Date(seconds * 1000);
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateAr(val: FirestoreTimestampLike): string {
  const d = toDate(val);
  return d ? d.toLocaleDateString('es-AR') : '-';
}

export function formatTimeAr(val: FirestoreTimestampLike): string {
  const d = toDate(val);
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-';
}
