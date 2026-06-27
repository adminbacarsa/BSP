import React, { useMemo, useState } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Users, AlertTriangle, UserX, Radio } from 'lucide-react';
import { useSupervisionTablero } from '@/hooks/useSupervisionTablero';
import { COVERAGE_STATUS_STYLES } from '@/lib/supervision/supervisionUtils';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return objectiveSummaries;
    const q = filter.toLowerCase();
    return objectiveSummaries.filter(
      o => o.objectiveName.toLowerCase().includes(q) || o.clientName.toLowerCase().includes(q),
    );
  }, [objectiveSummaries, filter]);

  const loading = !isReady || !isStable;

  const shiftsForObjective = (oid: string) =>
    todayShifts.filter((s: any) => s.objectiveId === oid && !s.isFranco);

  return (
    <div className="space-y-4 pb-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Activos', value: totals.activos, icon: Users, cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Vacantes', value: totals.vacantes, icon: UserX, cls: 'text-rose-600 bg-rose-50 border-rose-100' },
          { label: 'Ausentes', value: totals.ausentes, icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 border-amber-100' },
          { label: 'Alertas', value: totals.alertas, icon: Radio, cls: 'text-violet-600 bg-violet-50 border-violet-100' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl border p-3 shadow-sm ${k.cls}`}>
            <div className="flex items-center gap-2 mb-1">
              <k.icon size={14} />
              <span className="text-[10px] font-black uppercase opacity-80">{k.label}</span>
            </div>
            <p className="text-2xl font-black tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <input
        type="search"
        placeholder="Buscar objetivo o cliente…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium shadow-sm focus:outline-none focus:border-teal-400"
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="animate-spin text-slate-400" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center shadow-sm">
          <p className="text-slate-500 text-sm font-medium">
            {!canViewAllObjectives && !objectiveIds.length
              ? 'No tenés objetivos asignados. Pedí a RRHH/Config que te asignen en tu usuario.'
              : 'Sin turnos operativos hoy en tus objetivos'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(obj => {
            const st = COVERAGE_STATUS_STYLES[obj.status];
            const open = expandedId === obj.objectiveId;
            const detalle = shiftsForObjective(obj.objectiveId);
            return (
              <div
                key={obj.objectiveId}
                className={`rounded-2xl border shadow-sm overflow-hidden ${st.bg}`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : obj.objectiveId)}
                  className="w-full text-left p-4 flex items-start gap-3 active:opacity-80"
                >
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[10px] font-black uppercase ${st.text}`}>{st.label}</p>
                    <p className="font-black text-sm text-slate-900 dark:text-white truncate">{obj.objectiveName}</p>
                    <p className="text-xs text-slate-500 truncate">{obj.clientName}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-[10px] font-bold bg-white/70 px-2 py-0.5 rounded-lg">{obj.activos} activos</span>
                      {obj.vacantes > 0 && <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-lg">{obj.vacantes} vac.</span>}
                      {obj.ausentes > 0 && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg">{obj.ausentes} aus.</span>}
                      {obj.alertas > 0 && <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-lg">{obj.alertas} alerta</span>}
                    </div>
                  </div>
                  {open ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
                </button>
                {open && (
                  <div className="border-t border-white/50 bg-white/60 dark:bg-slate-900/40 px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto">
                    {detalle.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2 px-1">Sin detalle de turnos</p>
                    ) : detalle.slice(0, 12).map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded-xl bg-white/80 dark:bg-slate-800/80">
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
