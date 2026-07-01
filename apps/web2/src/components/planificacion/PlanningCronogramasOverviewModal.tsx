import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Database, ExternalLink } from 'lucide-react';
import {
  CRONOGRAMA_ESTADO_LABEL,
  loadCronogramaOverview,
  type CronogramaEstado,
  type CronogramaOverviewRow,
} from '@/lib/planificacion/planningCronogramaOverview';

const ESTADO_STYLE: Record<CronogramaEstado, string> = {
  PUBLICADO: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BORRADOR: 'bg-amber-50 text-amber-800 border-amber-200',
  PUBLICADO_CON_CAMBIOS: 'bg-rose-50 text-rose-800 border-rose-200 animate-pulse',
  SIN_DATOS: 'bg-slate-50 text-slate-500 border-slate-200',
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  empresaId: string;
  migracionCompleta: boolean;
  scopeEmpresa: boolean;
  clients: { id: string; name?: string; razonSocial?: string; objetivos?: { id?: string; name?: string }[] }[];
  onNavigateToObjective: (clientId: string, objectiveId: string, year: number, month: number) => void;
};

export default function PlanningCronogramasOverviewModal({
  isOpen,
  onClose,
  year,
  month,
  onMonthChange,
  empresaId,
  migracionCompleta,
  scopeEmpresa,
  clients,
  onNavigateToObjective,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CronogramaOverviewRow[]>([]);
  const [filterEstado, setFilterEstado] = useState<CronogramaEstado | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    [year, month],
  );

  const refresh = useCallback(async () => {
    if (!isOpen || !empresaId) return;
    setLoading(true);
    try {
      const data = await loadCronogramaOverview({
        empresaId,
        migracionCompleta,
        scopeEmpresa,
        year,
        month,
        clients,
      });
      setRows(data);
    } catch (e) {
      console.error('[plan] cronograma overview', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, empresaId, migracionCompleta, scopeEmpresa, year, month, clients]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const s: Record<CronogramaEstado, number> = {
      PUBLICADO: 0,
      BORRADOR: 0,
      PUBLICADO_CON_CAMBIOS: 0,
      SIN_DATOS: 0,
    };
    rows.forEach((r) => { s[r.estado] += 1; });
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterEstado !== 'ALL' && r.estado !== filterEstado) return false;
      if (!q) return true;
      return (
        r.clientName.toLowerCase().includes(q)
        || r.objectiveName.toLowerCase().includes(q)
        || r.objectiveId.toLowerCase().includes(q)
      );
    });
  }, [rows, filterEstado, search]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth() + 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9300] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <Database size={16} className="text-indigo-600" />
              Estado de cronogramas
              <span className="text-[9px] font-black bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full normal-case">SuperAdmin</span>
            </h3>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5 capitalize">{monthLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <ChevronRight size={16} />
          </button>
          <div className="flex flex-wrap gap-1.5 ml-1">
            {(Object.keys(CRONOGRAMA_ESTADO_LABEL) as CronogramaEstado[]).map((est) => (
              <button
                key={est}
                type="button"
                onClick={() => setFilterEstado(filterEstado === est ? 'ALL' : est)}
                className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${filterEstado === est ? ESTADO_STYLE[est] : 'bg-white border-slate-200 text-slate-500'}`}
              >
                {CRONOGRAMA_ESTADO_LABEL[est]} ({stats[est]})
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente u objetivo…"
            className="ml-auto text-xs font-bold border border-slate-200 rounded-lg px-3 py-1.5 w-48"
          />
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-xs font-bold">Consultando Firestore…</span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-12">Sin objetivos para este filtro.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-left text-[9px] font-black uppercase text-slate-400 border-b border-slate-100">
                  <th className="pb-2 pr-2">Cliente</th>
                  <th className="pb-2 pr-2">Objetivo</th>
                  <th className="pb-2 pr-2">Estado</th>
                  <th className="pb-2 pr-2 text-right">Turnos</th>
                  <th className="pb-2 pr-2">Publicado por</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.lookupKey} className="border-b border-slate-50 hover:bg-slate-50/80">
                    <td className="py-2 pr-2 font-bold text-slate-600 truncate max-w-[120px]" title={r.clientName}>
                      {r.clientName}
                    </td>
                    <td className="py-2 pr-2 font-black text-slate-800 truncate max-w-[160px]" title={r.objectiveName}>
                      {r.objectiveName}
                    </td>
                    <td className="py-2 pr-2">
                      <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-lg border ${ESTADO_STYLE[r.estado]}`}>
                        {CRONOGRAMA_ESTADO_LABEL[r.estado]}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-slate-600">
                      {r.totalShifts === 0 ? (
                        '—'
                      ) : (
                        <>
                          {r.publishedShifts > 0 && <span className="text-emerald-600">{r.publishedShifts} pub</span>}
                          {r.publishedShifts > 0 && r.draftShifts > 0 && ' · '}
                          {r.draftShifts > 0 && <span className="text-amber-600">{r.draftShifts} borr</span>}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-slate-500 truncate max-w-[100px]" title={r.publishedBy}>
                      {r.publishedBy || (r.publishedAt
                        ? r.publishedAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : '—')}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        title="Abrir en planificador"
                        onClick={() => {
                          onNavigateToObjective(r.clientId, r.objectiveId, r.year, r.month);
                          onClose();
                        }}
                        className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 text-[10px] text-slate-500 font-medium shrink-0">
          {rows.length} objetivo(s) · Publicado = doc en planificacion_estados y sin turnos draft · Borrador = turnos guardados sin publicar
        </div>
      </div>
    </div>
  );
}
