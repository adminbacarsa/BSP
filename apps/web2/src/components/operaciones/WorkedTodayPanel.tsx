import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { Download, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';

type Props = {
  empresaId: string;
  scopeEmpresa: boolean;
  clientId?: string;
  filterText?: string;
  /** Catálogo del monitor: los turnos a veces no traen objectiveName/clientName. */
  objectives?: Array<{ id: string; name?: string; clientId?: string; clientName?: string }>;
};

type Row = {
  id: string;
  clientId: string;
  clientName: string;
  objectiveName: string;
  positionName: string;
  employeeName: string;
  code: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  realStart: Date | null;
  realEnd: Date | null;
  lateMinutes: number;
  inProgress: boolean;
  closeLabel: string;
  closeKind: CloseKind;
  checkInBy: string;
  coversName: string;
};

const TZ = 'America/Argentina/Buenos_Aires';

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') return t.toDate();
  if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const hm = (d: Date | null) =>
  d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '—';

function todayAr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Medianoche AR del día `ymd` (AR es UTC−3 sin horario de verano). */
function arMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00-03:00`);
}

type CloseKind = 'EN_SERVICIO' | 'RETENIDO' | 'RELEVO' | 'SIN_RELEVO' | 'SALIDA' | 'AUTO' | 'RETIRO';

const CLOSE_KIND_LABEL: Record<CloseKind, string> = {
  EN_SERVICIO: 'En servicio',
  RETENIDO: 'Retenido',
  RELEVO: 'Relevo',
  SIN_RELEVO: 'Fin sin relevo (SLA)',
  SALIDA: 'Salida manual',
  AUTO: 'Cierre automático',
  RETIRO: 'Retiro anticipado',
};

function closeKindFor(s: Record<string, any>): CloseKind {
  const reason = String(s.completionReason || s.autoCloseReason || '').toUpperCase();
  const done = s.isCompleted === true || String(s.status || '').toUpperCase() === 'COMPLETED';
  if (s.isInterrupted || String(s.status || '').toUpperCase() === 'INTERRUPTED') return 'RETIRO';
  if (reason.startsWith('RELEVO') || (done && s.relievedByName)) return 'RELEVO';
  if (reason === 'SIN_CONTINUIDAD_SLA') return 'SIN_RELEVO';
  if (reason.startsWith('AUTO') || reason.includes('TOPE') || reason.includes('12H')) return 'AUTO';
  if (done) return 'SALIDA';
  if (s.isRetention) return 'RETENIDO';
  return 'EN_SERVICIO';
}

type SortKey = 'PLAN' | 'REAL' | 'TURNO' | 'ACTIVOS' | 'CIERRE';

function closeLabelFor(s: Record<string, any>): string {
  const reason = String(s.completionReason || s.autoCloseReason || '').toUpperCase();
  if (s.relievedByName && (reason.startsWith('RELEVO') || s.isCompleted)) return `Relevo: ${s.relievedByName}`;
  if (reason === 'SIN_CONTINUIDAD_SLA') return 'Fin de turno (sin relevo en SLA)';
  if (reason.startsWith('RELEVO')) return 'Relevo';
  if (reason === 'AUTO_COVERAGE_COMPLETE') return 'Fin de recargo (puesto cubierto)';
  if (reason.includes('TOPE') || reason.includes('12H')) return 'Cierre por tope 12 h';
  if (reason.startsWith('AUTO')) return 'Cierre automático';
  if (s.isInterrupted || String(s.status || '').toUpperCase() === 'INTERRUPTED') return 'Retiro anticipado';
  if (s.isCompleted) return s.checkoutBy || s.completedBy ? `Salida (${s.checkoutBy || s.completedBy})` : 'Salida';
  if (s.isRetention) return 'Retenido (esperando relevo)';
  return 'En servicio';
}

function checkInByLabel(s: Record<string, any>): string {
  const src = String(s.presenciaSource || s.checkInMethod || '').toUpperCase();
  if (src === 'PORTAL_GPS') return 'App (GPS)';
  if (src === 'OPERATIONS') return 'Operador';
  if (src === 'VIGI') return 'VIGI';
  if (src === 'DEMO') return 'Demo';
  if (src.startsWith('MANUAL')) return 'Manual';
  return src || '—';
}

export function WorkedTodayPanel({ empresaId, scopeEmpresa, clientId, filterText, objectives }: Props) {
  const objById = useMemo(() => new Map((objectives || []).map((o) => [String(o.id), o])), [objectives]);
  const [day, setDay] = useState<string>(todayAr());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'ACTIVOS' | 'CERRADOS'>('TODOS');
  const [kindFilter, setKindFilter] = useState<CloseKind | ''>('');
  const [sortBy, setSortBy] = useState<SortKey>('PLAN');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const dayStart = arMidnight(day);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
        // Desde el mediodía anterior: incluye nocturnos que terminan dentro del día.
        const from = Timestamp.fromDate(new Date(dayStart.getTime() - 12 * 3600e3));
        const to = Timestamp.fromDate(dayEnd);
        const base = collection(db, 'turnos');
        const q = scopeEmpresa && empresaId
          ? query(base, where('empresaId', '==', empresaId), where('startTime', '>=', from), where('startTime', '<', to))
          : query(base, where('startTime', '>=', from), where('startTime', '<', to));
        const snap = await getDocs(q);
        const out: Row[] = [];
        const objInfo = (id: unknown) => objById.get(String(id || ''));
        for (const d of snap.docs) {
          const s = d.data() as Record<string, any>;
          if (s.isDeleted === true || s.isFranco === true) continue;
          if (!s.employeeId || s.employeeId === 'VACANTE' || s.isUnassigned === true) continue;
          if (s.coverageHoursOnSource === true) continue;
          // Licencias / ausencias no son horas trabajadas aunque el turno figure "presente" (Demo).
          if (['V', 'L', 'E', 'A', 'AA', 'PG', 'LT', 'F', 'FF', 'FP'].includes(String(s.code || '').toUpperCase())) continue;
          const realStart = toDate(s.realStartTime) || toDate(s.checkInTime);
          if (!realStart) continue;
          const plannedStart = toDate(s.startTime);
          const plannedEnd = toDate(s.endTime);
          const realEnd = toDate(s.realEndTime) || toDate(s.checkOutTime);
          const inProgress = !s.isCompleted && !realEnd;
          const workedEnd = realEnd || (inProgress ? new Date() : plannedEnd);
          if (realStart >= dayEnd || (workedEnd && workedEnd < dayStart)) continue;
          const lateFromPlan =
            plannedStart ? Math.round((realStart.getTime() - plannedStart.getTime()) / 60000) : 0;
          out.push({
            id: d.id,
            clientId: String(s.clientId || ''),
            clientName: String(s.clientName || objInfo(s.objectiveId)?.clientName || s.clientId || 'Sin cliente'),
            objectiveName: String(s.objectiveName || objInfo(s.objectiveId)?.name || s.objectiveId || 'Sin objetivo'),
            positionName: String(s.positionName || ''),
            employeeName: String(s.employeeName || s.employeeId),
            code: String(s.code || s.type || ''),
            plannedStart,
            plannedEnd,
            realStart,
            realEnd,
            lateMinutes: Math.max(Number(s.lateMinutes) || 0, lateFromPlan > 5 ? lateFromPlan : 0),
            inProgress,
            closeLabel: closeLabelFor(s),
            closeKind: closeKindFor(s),
            checkInBy: checkInByLabel(s),
            coversName: String(s.coversEmployeeName || s.coverageUsedCoversEmployeeName || ''),
          });
        }
        if (!cancelled) setRows(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [day, empresaId, scopeEmpresa, objById]);

  const grouped = useMemo(() => {
    const q = String(filterText || '').trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (clientId && r.clientId !== clientId) return false;
      if (statusFilter === 'ACTIVOS' && !r.inProgress) return false;
      if (statusFilter === 'CERRADOS' && r.inProgress) return false;
      if (kindFilter && r.closeKind !== kindFilter) return false;
      if (!q) return true;
      return [r.employeeName, r.objectiveName, r.clientName, r.positionName].some((x) => x.toLowerCase().includes(q));
    });
    const byClient = new Map<string, Map<string, Row[]>>();
    for (const r of filtered) {
      if (!byClient.has(r.clientName)) byClient.set(r.clientName, new Map());
      const byObj = byClient.get(r.clientName)!;
      if (!byObj.has(r.objectiveName)) byObj.set(r.objectiveName, []);
      byObj.get(r.objectiveName)!.push(r);
    }
    return [...byClient.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([client, objs]) => ({
        client,
        objectives: [...objs.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([objective, list]) => ({
            objective,
            list: list.sort((a, b) => {
              const t = (d: Date | null) => d?.getTime() ?? 0;
              const kindOrder = Object.keys(CLOSE_KIND_LABEL) as CloseKind[];
              switch (sortBy) {
                case 'REAL':
                  return t(a.realStart) - t(b.realStart);
                case 'TURNO':
                  return a.code.localeCompare(b.code) || t(a.plannedStart) - t(b.plannedStart);
                case 'ACTIVOS':
                  return Number(b.inProgress) - Number(a.inProgress) || t(a.plannedStart) - t(b.plannedStart);
                case 'CIERRE':
                  return kindOrder.indexOf(a.closeKind) - kindOrder.indexOf(b.closeKind) || t(a.plannedStart) - t(b.plannedStart);
                default:
                  return t(a.plannedStart) - t(b.plannedStart) || a.positionName.localeCompare(b.positionName);
              }
            }),
          })),
      }));
  }, [rows, filterText, clientId, statusFilter, kindFilter, sortBy]);

  const kindCounts = useMemo(() => {
    const m = new Map<CloseKind, number>();
    for (const r of rows) if (!clientId || r.clientId === clientId) m.set(r.closeKind, (m.get(r.closeKind) || 0) + 1);
    return m;
  }, [rows, clientId]);

  const total = grouped.reduce((n, c) => n + c.objectives.reduce((m, o) => m + o.list.length, 0), 0);

  const exportCsv = () => {
    const header = ['Fecha', 'Cliente', 'Objetivo', 'Puesto', 'Guardia', 'Turno', 'Plan inicio', 'Plan fin', 'Entrada real', 'Salida real', 'Tardanza (min)', 'Presente por', 'Cierre', 'Cubre a'];
    const lines = [header];
    for (const c of grouped) for (const o of c.objectives) for (const r of o.list) {
      lines.push([day, c.client, o.objective, r.positionName, r.employeeName, r.code, hm(r.plannedStart), hm(r.plannedEnd),
        hm(r.realStart), r.inProgress ? 'en servicio' : hm(r.realEnd), String(r.lateMinutes || 0), r.checkInBy, r.closeLabel, r.coversName]);
    }
    const csv = lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trabajaron_${day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
        <span className="text-[10px] font-black uppercase text-slate-500">Trabajaron</span>
        <input
          type="date"
          value={day}
          max={todayAr()}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-slate-50"
        />
        <span className="text-[10px] font-bold text-slate-400">{loading ? 'Cargando…' : `${total} guardia(s)`}</span>
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || total === 0}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-40"
        >
          <Download size={12} /> Excel
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2">
        {(['TODOS', 'ACTIVOS', 'CERRADOS'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatusFilter(k)}
            className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${statusFilter === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            {k === 'TODOS' ? 'Todos' : k === 'ACTIVOS' ? 'Activos' : 'Cerrados'}
          </button>
        ))}
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as CloseKind | '')}
          className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-slate-50"
          title="Filtrar por tipo de cierre"
        >
          <option value="">Tipo de cierre: todos</option>
          {(Object.keys(CLOSE_KIND_LABEL) as CloseKind[]).map((k) => (
            <option key={k} value={k}>{CLOSE_KIND_LABEL[k]} ({kindCounts.get(k) || 0})</option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
          Ordenar
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 normal-case text-slate-700"
          >
            <option value="PLAN">Horario planificado</option>
            <option value="REAL">Entrada real</option>
            <option value="TURNO">Turno</option>
            <option value="ACTIVOS">Activos primero</option>
            <option value="CIERRE">Tipo de cierre</option>
          </select>
        </label>
      </div>

      {error ? <div className="text-xs text-rose-600 px-2">Error: {error}</div> : null}
      {loading ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={18} /></div>
      ) : total === 0 ? (
        <div className="text-center py-10 text-slate-400 text-xs">
          {rows.length === 0 ? 'Nadie fichó en esta fecha.' : 'Ningún guardia coincide con los filtros.'}
        </div>
      ) : (
        grouped.map((c) => (
          <div key={c.client} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-black uppercase">{c.client}</div>
            {c.objectives.map((o) => (
              <div key={o.objective} className="border-t border-slate-100">
                <div className="px-3 py-1 bg-slate-50 text-[10px] font-black uppercase text-slate-600">
                  {o.objective} · {o.list.length}
                </div>
                <div className="divide-y divide-slate-100">
                  {o.list.map((r) => (
                    <div key={r.id} className="px-3 py-1.5 grid grid-cols-12 gap-1 items-center text-[10px]">
                      <div className="col-span-4 min-w-0">
                        <div className="font-black text-slate-800 truncate">{r.employeeName}</div>
                        <div className="text-slate-400 truncate">
                          {r.positionName} · {r.code}{r.coversName ? ` · cubre a ${r.coversName}` : ''}
                        </div>
                      </div>
                      <div className="col-span-2 font-mono text-slate-500">
                        {hm(r.plannedStart)}–{hm(r.plannedEnd)}
                      </div>
                      <div className="col-span-2 font-mono">
                        <span className="text-slate-800 font-bold">{hm(r.realStart)}</span>
                        {r.lateMinutes > 5 ? <span className="text-amber-600 font-bold"> +{r.lateMinutes}′</span> : null}
                        <div className="text-slate-400 font-sans">{r.checkInBy}</div>
                      </div>
                      <div className="col-span-1 font-mono font-bold text-slate-800">
                        {r.inProgress ? <span className="text-emerald-600">activo</span> : hm(r.realEnd)}
                      </div>
                      <div className="col-span-3 text-slate-500 truncate" title={r.closeLabel}>{r.closeLabel}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
