import React, { useMemo, useState } from 'react';
import { RefreshCw, Users, AlertTriangle, UserX, Radio, X, Search } from 'lucide-react';
import { useSupervisionTablero } from '@/hooks/useSupervisionTablero';
import { COVERAGE_STATUS_STYLES } from '@/lib/supervision/supervisionUtils';

type StatusFilter = 'ALL' | 'CRITICO' | 'ALERTA' | 'OK';

const CARD_STYLES: Record<'OK' | 'ALERTA' | 'CRITICO', string> = {
  CRITICO: 'bg-rose-50 border-rose-300 dark:bg-rose-900/20 dark:border-rose-800',
  ALERTA: 'bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-800',
  OK: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
};

export default function SupervisionTablero({
  objectiveIds,
  canViewAllObjectives,
}: {
  objectiveIds: string[];
  canViewAllObjectives: boolean;
}) {
  const { objectiveSummaries, totals, isReady, isStable, todayShifts } = useSupervisionTablero(
    objectiveIds,
    canViewAllObjectives,
  );
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const filtered = useMemo(() => {
    let list = objectiveSummaries;
    if (statusFilter !== 'ALL') list = list.filter(o => o.status === statusFilter);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        o => o.objectiveName.toLowerCase().includes(q) || o.clientName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [objectiveSummaries, filter, statusFilter]);

  const counts = useMemo(() => ({
    CRITICO: objectiveSummaries.filter(o => o.status === 'CRITICO').length,
    ALERTA: objectiveSummaries.filter(o => o.status === 'ALERTA').length,
    OK: objectiveSummaries.filter(o => o.status === 'OK').length,
  }), [objectiveSummaries]);

  const loading = !isReady || !isStable;
  const detalle = detalleId ? objectiveSummaries.find(o => o.objectiveId === detalleId) : null;
  const detalleShifts = detalleId
    ? todayShifts.filter((s: any) => s.objectiveId === detalleId && !s.isFranco)
    : [];

  return (
    <div className="space-y-4 pb-4">
      {/* KPIs globales */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Activos', value: totals.activos, icon: Users, cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Vacantes', value: totals.vacantes, icon: UserX, cls: 'text-rose-600 bg-rose-50 border-rose-100' },
          { label: 'Ausentes', value: totals.ausentes, icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 border-amber-100' },
          { label: 'Alertas', value: totals.alertas, icon: Radio, cls: 'text-violet-600 bg-violet-50 border-violet-100' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl border p-2.5 shadow-sm ${k.cls}`}>
            <div className="flex items-center gap-1 mb-0.5">
              <k.icon size={12} />
              <span className="text-[9px] font-black uppercase opacity-80 truncate">{k.label}</span>
            </div>
            <p className="text-xl font-black tabular-nums leading-none">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Buscador + filtros por estado */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar objetivo o cliente…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium shadow-sm focus:outline-none focus:border-teal-400"
          />
        </div>
        <div className="flex gap-1.5">
          {([
            ['ALL', `Todos (${objectiveSummaries.length})`, 'bg-slate-900 text-white border-slate-900'],
            ['CRITICO', `Críticos (${counts.CRITICO})`, 'bg-rose-600 text-white border-rose-600'],
            ['ALERTA', `Atención (${counts.ALERTA})`, 'bg-amber-500 text-white border-amber-500'],
            ['OK', `OK (${counts.OK})`, 'bg-emerald-600 text-white border-emerald-600'],
          ] as [StatusFilter, string, string][]).map(([id, label, activeCls]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`flex-1 py-1.5 px-1 rounded-xl text-[10px] font-black uppercase border transition-colors ${
                statusFilter === id ? activeCls : 'bg-white dark:bg-slate-800 border-slate-200 text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="animate-spin text-slate-400" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center shadow-sm">
          <p className="text-slate-500 text-sm font-medium">
            {!canViewAllObjectives && !objectiveIds.length
              ? 'No tenés objetivos asignados. Pedí a RRHH/Config que te asignen en tu usuario.'
              : objectiveSummaries.length === 0
                ? 'Sin turnos operativos hoy en tus objetivos'
                : 'Sin objetivos para este filtro'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {filtered.map(obj => {
            const st = COVERAGE_STATUS_STYLES[obj.status];
            return (
              <button
                key={obj.objectiveId}
                type="button"
                onClick={() => setDetalleId(obj.objectiveId)}
                className={`text-left rounded-2xl border shadow-sm p-3 active:scale-95 transition-transform ${CARD_STYLES[obj.status]}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                  <span className={`text-[9px] font-black uppercase ${st.text}`}>{st.label}</span>
                </div>
                <p className="font-black text-xs text-slate-900 dark:text-white leading-tight line-clamp-2 min-h-[2rem]">
                  {obj.objectiveName}
                </p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{obj.clientName}</p>
                <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold">
                  <span className="text-emerald-700">{obj.activos}<span className="opacity-60">act</span></span>
                  {obj.vacantes > 0 && <span className="text-rose-700">{obj.vacantes}<span className="opacity-60">vac</span></span>}
                  {obj.ausentes > 0 && <span className="text-amber-700">{obj.ausentes}<span className="opacity-60">aus</span></span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detalle del objetivo (bottom-sheet) */}
      {detalle && (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm" onClick={() => setDetalleId(null)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl max-h-[80dvh] flex flex-col lg:rounded-2xl lg:max-w-lg lg:mx-auto lg:my-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 lg:hidden"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
            <div className="px-5 py-3 flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-700">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${COVERAGE_STATUS_STYLES[detalle.status].dot}`} />
                  <span className={`text-[10px] font-black uppercase ${COVERAGE_STATUS_STYLES[detalle.status].text}`}>
                    {COVERAGE_STATUS_STYLES[detalle.status].label}
                  </span>
                </div>
                <h3 className="font-black text-slate-900 dark:text-white truncate">{detalle.objectiveName}</h3>
                <p className="text-xs text-slate-500 truncate">{detalle.clientName}</p>
              </div>
              <button type="button" onClick={() => setDetalleId(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-2 grid grid-cols-3 gap-2 border-b border-slate-100 dark:border-slate-700">
              <div className="text-center"><p className="text-lg font-black text-emerald-600">{detalle.activos}</p><p className="text-[9px] font-bold uppercase text-slate-400">Activos</p></div>
              <div className="text-center"><p className="text-lg font-black text-rose-600">{detalle.vacantes}</p><p className="text-[9px] font-bold uppercase text-slate-400">Vacantes</p></div>
              <div className="text-center"><p className="text-lg font-black text-amber-600">{detalle.ausentes}</p><p className="text-[9px] font-bold uppercase text-slate-400">Ausentes</p></div>
            </div>
            <div className="px-4 py-3 space-y-1.5 overflow-y-auto">
              {detalleShifts.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Sin detalle de turnos</p>
              ) : detalleShifts.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                  <span className="font-bold text-slate-800 dark:text-white truncate">{s.employeeName || 'VACANTE'}</span>
                  <span className="shrink-0 text-[10px] font-black uppercase text-slate-500">{s.code}</span>
                  <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    s.isPresent ? 'bg-emerald-100 text-emerald-700'
                      : s.isUnassigned ? 'bg-rose-100 text-rose-700'
                      : s.isAbsent ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {s.isPresent ? 'OK' : s.isUnassigned ? 'VAC' : s.isAbsent ? 'AUS' : 'PLAN'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
