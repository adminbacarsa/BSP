import React, { useMemo, useState } from 'react';
import { RefreshCw, Users, AlertTriangle, UserX, Radio, X, Search, Phone, Clock } from 'lucide-react';
import { useSupervisionTablero } from '@/hooks/useSupervisionTablero';
import { COVERAGE_STATUS_STYLES } from '@/lib/supervision/supervisionUtils';

type StatusFilter = 'ALL' | 'CRITICO' | 'ALERTA' | 'OK';

const tsToDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
};

const fmtHora = (d: Date | null): string =>
  d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';

type ShiftStatusInfo = { label: string; cls: string; prio: number };

function shiftStatus(s: any): ShiftStatusInfo {
  if (s.isUnassigned) return { label: 'Vacante', cls: 'bg-rose-100 text-rose-700 border-rose-200', prio: 0 };
  if (s.isAbsent) return { label: 'Ausente', cls: 'bg-rose-100 text-rose-700 border-rose-200', prio: 1 };
  if (s.isPotentialAbsence) return { label: 'No llegó', cls: 'bg-amber-100 text-amber-700 border-amber-200', prio: 1 };
  if (s.isLateNotified || s.isLateUnnotified) return { label: 'Tarde', cls: 'bg-orange-100 text-orange-700 border-orange-200', prio: 2 };
  if (s.isAwaitingCoverageCheckIn || s.isConvocado) return { label: 'Convocado', cls: 'bg-indigo-100 text-indigo-700 border-indigo-200', prio: 3 };
  if (s.isImminent) return { label: 'Por iniciar', cls: 'bg-sky-100 text-sky-700 border-sky-200', prio: 3 };
  if (s.isRetention) return { label: 'Retención', cls: 'bg-violet-100 text-violet-700 border-violet-200', prio: 4 };
  if (s.isPresent) return { label: 'En puesto', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', prio: 5 };
  if (s.isFuture) return { label: 'Planificado', cls: 'bg-slate-100 text-slate-500 border-slate-200', prio: 6 };
  if (s.isCompleted) return { label: 'Finalizado', cls: 'bg-slate-100 text-slate-400 border-slate-200', prio: 7 };
  return { label: '—', cls: 'bg-slate-100 text-slate-500 border-slate-200', prio: 8 };
}

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

      {/* Detalle del objetivo */}
      {detalle && (() => {
        const sortedShifts = [...detalleShifts].sort((a: any, b: any) => {
          const pa = shiftStatus(a).prio;
          const pb = shiftStatus(b).prio;
          if (pa !== pb) return pa - pb;
          const ha = a.shiftDateObj?.getTime?.() ?? 0;
          const hb = b.shiftDateObj?.getTime?.() ?? 0;
          return ha - hb;
        });
        return (
        <div
          className="fixed inset-0 z-[80] flex flex-col justify-end lg:justify-center lg:items-center bg-slate-900/60 backdrop-blur-sm lg:p-6"
          onClick={() => setDetalleId(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-t-3xl lg:rounded-3xl shadow-2xl max-h-[85dvh] lg:max-h-[88vh] w-full lg:max-w-4xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 lg:hidden"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
            <div className="px-5 py-3.5 flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-700">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${COVERAGE_STATUS_STYLES[detalle.status].dot}`} />
                  <span className={`text-[10px] font-black uppercase ${COVERAGE_STATUS_STYLES[detalle.status].text}`}>
                    {COVERAGE_STATUS_STYLES[detalle.status].label}
                  </span>
                </div>
                <h3 className="font-black text-lg text-slate-900 dark:text-white truncate">{detalle.objectiveName}</h3>
                <p className="text-xs text-slate-500 truncate">{detalle.clientName}</p>
              </div>
              <button type="button" onClick={() => setDetalleId(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-3 grid grid-cols-4 gap-2 border-b border-slate-100 dark:border-slate-700">
              <div className="text-center"><p className="text-2xl font-black text-slate-700 dark:text-slate-200">{detalleShifts.length}</p><p className="text-[9px] font-bold uppercase text-slate-400">Puestos</p></div>
              <div className="text-center"><p className="text-2xl font-black text-emerald-600">{detalle.activos}</p><p className="text-[9px] font-bold uppercase text-slate-400">En puesto</p></div>
              <div className="text-center"><p className="text-2xl font-black text-rose-600">{detalle.vacantes}</p><p className="text-[9px] font-bold uppercase text-slate-400">Vacantes</p></div>
              <div className="text-center"><p className="text-2xl font-black text-amber-600">{detalle.ausentes}</p><p className="text-[9px] font-bold uppercase text-slate-400">Ausentes</p></div>
            </div>

            {detalleShifts.length === 0 ? (
              <p className="text-sm text-slate-500 py-12 text-center">Sin turnos operativos hoy en este objetivo</p>
            ) : (
              <>
                {/* ── DESKTOP: tabla completa ── */}
                <div className="hidden lg:block overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/80 backdrop-blur z-10">
                      <tr className="text-[10px] font-black uppercase text-slate-400 tracking-wide">
                        <th className="py-2.5 pl-6 pr-2 w-[28%]">Puesto</th>
                        <th className="py-2.5 px-2">Vigilador</th>
                        <th className="py-2.5 px-2 w-[14%]">Turno</th>
                        <th className="py-2.5 px-2 w-[14%]">Horario</th>
                        <th className="py-2.5 px-2 w-[10%] text-center">Ingreso</th>
                        <th className="py-2.5 pr-6 pl-2 w-[14%] text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedShifts.map((s: any) => {
                        const stt = shiftStatus(s);
                        const ingreso = tsToDate(s.realStartTime) || tsToDate(s.checkInTime);
                        const ingresoTarde = ingreso && s.shiftDateObj && (ingreso.getTime() - s.shiftDateObj.getTime()) / 60000 > 10;
                        return (
                          <tr key={s.id} className="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-900/30">
                            <td className="py-3 pl-6 pr-2 text-sm font-bold text-slate-600 dark:text-slate-300">{s.positionName || 'Sin puesto'}</td>
                            <td className="py-3 px-2">
                              {s.isUnassigned ? (
                                <span className="text-sm font-black text-rose-600">VACANTE</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-black text-slate-800 dark:text-white">{s.employeeName}</span>
                                  {s.phone && (
                                    <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()}
                                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold hover:bg-emerald-100"
                                      title={`Llamar a ${s.employeeName}`}>
                                      <Phone size={11} /> {s.phone}
                                    </a>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-xs font-black uppercase text-slate-600 dark:text-slate-300">{s.code || '—'}</td>
                            <td className="py-3 px-2 text-xs text-slate-500 tabular-nums whitespace-nowrap">{fmtHora(s.shiftDateObj)}–{fmtHora(s.endDateObj)}</td>
                            <td className="py-3 px-2 text-center">
                              {ingreso
                                ? <span className={`text-sm font-bold tabular-nums ${ingresoTarde ? 'text-orange-600' : 'text-emerald-600'}`}>{fmtHora(ingreso)}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="py-3 pr-6 pl-2 text-right">
                              <span className={`inline-block text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${stt.cls}`}>{stt.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── MOBILE: filas apiladas ── */}
                <div className="lg:hidden overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60">
                  {sortedShifts.map((s: any) => {
                    const stt = shiftStatus(s);
                    const ingreso = tsToDate(s.realStartTime) || tsToDate(s.checkInTime);
                    const ingresoTarde = ingreso && s.shiftDateObj && (ingreso.getTime() - s.shiftDateObj.getTime()) / 60000 > 10;
                    return (
                      <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400">
                            <span className="truncate">{s.positionName || 'Sin puesto'}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500">{s.code}</span>
                            <span className="tabular-nums whitespace-nowrap">{fmtHora(s.shiftDateObj)}–{fmtHora(s.endDateObj)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {s.isUnassigned ? (
                              <span className="text-sm font-black text-rose-600">VACANTE</span>
                            ) : (
                              <span className="text-sm font-black text-slate-800 dark:text-white truncate">{s.employeeName}</span>
                            )}
                            {s.phone && !s.isUnassigned && (
                              <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()}
                                className="shrink-0 p-1.5 rounded-lg bg-emerald-50 text-emerald-600 active:scale-90" title={`Llamar a ${s.employeeName}`}>
                                <Phone size={13} />
                              </a>
                            )}
                          </div>
                          {ingreso && (
                            <p className={`text-[10px] font-bold mt-0.5 ${ingresoTarde ? 'text-orange-600' : 'text-emerald-600'}`}>
                              Ingreso {fmtHora(ingreso)}{ingresoTarde ? ' (tarde)' : ''}
                            </p>
                          )}
                        </div>
                        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full border ${stt.cls}`}>{stt.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 flex items-center gap-1.5 text-[10px] text-slate-400">
              <Clock size={11} /> Horario planificado · ingreso real cuando el guardia ficha
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
