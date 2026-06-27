import { Timestamp } from 'firebase/firestore';

export type SupervisionMainTab = 'TABLERO' | 'BANDEJA' | 'NOVEDADES' | 'MAS';

export type UrgencyLevel = 'HOY' | 'MANANA' | 'NORMAL';

export function fmtTs(ts: Timestamp | string | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function todayStrAr(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function tomorrowStrAr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

export function urgencyLevel(fecha: string): UrgencyLevel {
  const hoy = todayStrAr();
  const manana = tomorrowStrAr();
  if (fecha === hoy) return 'HOY';
  if (fecha === manana) return 'MANANA';
  return 'NORMAL';
}

export function hoursSincePending(ts: Timestamp | string | undefined): number | null {
  if (!ts) return null;
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 3600000));
}

export function pendingHoursLabel(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return 'Hace menos de 1 h';
  if (hours === 1) return 'Hace 1 h';
  return `Hace ${hours} h`;
}

export function objectiveCoverageStatus(stats: {
  vacantes: number;
  ausentes: number;
  alertas: number;
}): 'OK' | 'ALERTA' | 'CRITICO' {
  if (stats.vacantes > 0 || stats.ausentes > 0) return 'CRITICO';
  if (stats.alertas > 0) return 'ALERTA';
  return 'OK';
}

export const COVERAGE_STATUS_STYLES: Record<'OK' | 'ALERTA' | 'CRITICO', { dot: string; bg: string; text: string; label: string }> = {
  OK: { dot: 'bg-emerald-500', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'Cubierto' },
  ALERTA: { dot: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Atención' },
  CRITICO: { dot: 'bg-rose-500', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700', label: 'Crítico' },
};

export const URGENCY_STYLES: Record<UrgencyLevel, { cls: string; label: string }> = {
  HOY: { cls: 'bg-rose-100 text-rose-700 border-rose-200', label: 'Hoy' },
  MANANA: { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Mañana' },
  NORMAL: { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Programado' },
};
