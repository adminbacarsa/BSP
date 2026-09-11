import { Timestamp } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type SupervisionMainTab = 'TABLERO' | 'BANDEJA' | 'CAMPO';

/** Sub-secciones del tab Campo (libro, rondas, consignas). */
export type SupervisionCampoSection = 'NOVEDADES' | 'VISITAS' | 'CONSIGNAS';

/** Tabs legacy — migración desde localStorage. */
export type SupervisionMainTabLegacy = SupervisionMainTab | 'NOVEDADES' | 'MAS';

export function normalizeSupervisionMainTab(tab: string | null | undefined): SupervisionMainTab {
  if (tab === 'NOVEDADES' || tab === 'MAS') return 'CAMPO';
  if (tab === 'TABLERO' || tab === 'BANDEJA' || tab === 'CAMPO') return tab;
  return 'TABLERO';
}

export function legacyMainTabToCampoSection(tab: string | null | undefined): SupervisionCampoSection | null {
  if (tab === 'NOVEDADES') return 'NOVEDADES';
  if (tab === 'MAS') return 'VISITAS';
  return null;
}

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

/** Ausencia con campos opcionales usados para filtrar por objetivo del supervisor */
export type ScopedAbsence = {
  id?: string;
  objectiveId?: string;
  shiftId?: string;
  clientId?: string;
  [key: string]: unknown;
};

/**
 * Resuelve objectiveId de ausencias vía shiftId (cache) y filtra por alcance del supervisor.
 * Si objectiveIds está vacío y canViewAll es false → sin resultados.
 */
export async function filterAbsencesByObjectives<T extends ScopedAbsence>(
  items: T[],
  objectiveIds: string[],
  canViewAll: boolean,
  shiftObjectiveCache: Map<string, string>,
): Promise<T[]> {
  if (canViewAll) return items;
  if (!objectiveIds.length) return [];

  const scope = new Set(objectiveIds);
  const missingShiftIds = new Set<string>();

  items.forEach(a => {
    const oid = String(a.objectiveId || '').trim();
    const sid = String(a.shiftId || '').trim();
    if (!oid && sid && !shiftObjectiveCache.has(sid)) missingShiftIds.add(sid);
  });

  await Promise.all(
    [...missingShiftIds].map(async sid => {
      try {
        const snap = await getDoc(doc(db, 'turnos', sid));
        shiftObjectiveCache.set(sid, snap.exists() ? String(snap.data()?.objectiveId || '').trim() : '');
      } catch {
        shiftObjectiveCache.set(sid, '');
      }
    }),
  );

  return items.filter(a => {
    const oid = String(a.objectiveId || '').trim()
      || shiftObjectiveCache.get(String(a.shiftId || '').trim())
      || '';
    return oid && scope.has(oid);
  });
}

export function filterSolicitudesByObjectives<T extends { objectiveId: string }>(
  items: T[],
  objectiveIds: string[],
  canViewAll: boolean,
): T[] {
  if (canViewAll) return items;
  if (!objectiveIds.length) return [];
  const scope = new Set(objectiveIds);
  return items.filter(s => scope.has(s.objectiveId));
}

const MAX_RFZ_RANGO_DIAS = 31;

/** Lista inclusive YYYY-MM-DD desde `from` hasta `to` (mismo día si to vacío). */
export function listYmdDatesInclusive(from: string, to?: string): string[] {
  const start = String(from || '').trim().slice(0, 10);
  if (!start) return [];
  const endRaw = String(to || '').trim().slice(0, 10);
  const end = endRaw && endRaw >= start ? endRaw : start;
  const out: string[] = [];
  const cur = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return [start];
  while (cur <= last) {
    out.push(cur.toLocaleDateString('en-CA'));
    cur.setDate(cur.getDate() + 1);
    if (out.length > MAX_RFZ_RANGO_DIAS) break;
  }
  return out;
}

export function formatYmdAr(ymd: string): string {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}
