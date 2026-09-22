import React, { useMemo, useState } from 'react';
import {
  Radio,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  User,
  Users,
  Zap,
  Bot,
  FlaskConical,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSupervisionCcBoard } from '@/hooks/useSupervisionCcBoard';
import { COVERAGE_STATUS_STYLES, todayStrAr, formatYmdDisplayAr } from '@/lib/supervision/supervisionUtils';
import { downloadSupervisionCcDayPdf } from '@/lib/supervision/ccDayReportPdf';
import type { OpsMode } from '@/lib/operaciones/opsMode';

function modeBadge(mode: OpsMode) {
  if (mode === 'DEMO') {
    return {
      label: 'Demo',
      icon: FlaskConical,
      cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
  }
  if (mode === 'MANUAL') {
    return {
      label: 'Manual',
      icon: User,
      cls: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    };
  }
  return {
    label: 'Auto',
    icon: Bot,
    cls: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

function shiftYmd(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
}

export default function SupervisionCentroControl({
  objectiveIds,
  canViewAllObjectives,
}: {
  objectiveIds: string[];
  canViewAllObjectives: boolean;
}) {
  const [dateYmd, setDateYmd] = useState(() => todayStrAr());
  const board = useSupervisionCcBoard(dateYmd, objectiveIds, canViewAllObjectives);
  const badge = modeBadge(board.opsMode);
  const ModeIcon = badge.icon;

  const criticoCount = useMemo(
    () => board.objectiveSummaries.filter((o) => o.status === 'CRITICO').length,
    [board.objectiveSummaries],
  );

  const handlePdf = () => {
    try {
      downloadSupervisionCcDayPdf({
        empresaName: board.empresaName,
        dateYmd: board.dateYmd,
        opsMode: board.opsMode,
        isToday: board.isToday,
        livePilotName: board.livePilot?.operatorName ?? null,
        sessions: board.daySessions,
        mandos: board.mandosDelDia,
        informes: board.informes,
        auditSummary: board.auditSummary,
        objectiveSummaries: board.objectiveSummaries,
        totals: board.totals,
      });
      toast.success('PDF del día descargado');
    } catch (e) {
      console.error(e);
      toast.error('No se pudo generar el PDF');
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
            <Radio size={20} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-slate-500 tracking-wide">Centro de control</p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {formatYmdDisplayAr(dateYmd)}
              {board.isToday && (
                <span className="ml-2 text-[10px] font-black uppercase text-emerald-600">En vivo</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDateYmd((d) => shiftYmd(d, -1))}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:scale-95"
            aria-label="Día anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={dateYmd}
            onChange={(e) => setDateYmd(e.target.value || todayStrAr())}
            className="text-xs font-bold rounded-xl border border-slate-200 px-2 py-2 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={() => setDateYmd((d) => shiftYmd(d, 1))}
            disabled={dateYmd >= todayStrAr()}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:scale-95 disabled:opacity-40"
            aria-label="Día siguiente"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => board.reloadDay()}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:scale-95"
            title="Actualizar"
          >
            <RefreshCw size={16} className={board.loadingDay ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={handlePdf}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95"
          >
            <Download size={14} />
            PDF día
          </button>
        </div>
      </div>

      {board.isToday && (
        <div className={`rounded-2xl border p-4 shadow-sm ${badge.cls}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase">
              <ModeIcon size={14} />
              Modo {badge.label}
            </span>
            {board.opsMode === 'MANUAL' && board.livePilot && (
              <span className="text-sm font-bold">
                A mando: <span className="text-indigo-900">{board.livePilot.operatorName}</span>
                <span className="text-[10px] font-normal text-slate-600 ml-2">
                  desde{' '}
                  {board.livePilot.startTime.toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
            )}
            {board.liveSupport.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700">
                <Users size={12} />
                Apoyo: {board.liveSupport.map((s) => s.operatorName).join(', ')}
              </span>
            )}
            {board.opsMode === 'AUTO' && !board.modoDemo && (
              <span className="text-xs text-slate-600">Sin operador manual en sala · pipeline automático</span>
            )}
            {board.opsMode === 'DEMO' && (
              <span className="text-xs font-bold text-emerald-800">Laboratorio · eventos simulados</span>
            )}
          </div>
        </div>
      )}

      {board.isToday && board.totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Activos', value: board.totals.activos, cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
            { label: 'Vacantes', value: board.totals.vacantes, cls: 'text-rose-600 bg-rose-50 border-rose-100' },
            { label: 'Ausentes', value: board.totals.ausentes, cls: 'text-amber-600 bg-amber-50 border-amber-100' },
            { label: 'Críticos', value: criticoCount, cls: 'text-violet-600 bg-violet-50 border-violet-100' },
          ].map((k) => (
            <div key={k.label} className={`rounded-2xl border p-3 shadow-sm ${k.cls}`}>
              <p className="text-[9px] font-black uppercase opacity-80">{k.label}</p>
              <p className="text-2xl font-black tabular-nums">
                {!board.isLiveReady ? '—' : k.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {board.isToday && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <Zap size={14} className="text-indigo-500" />
            <span className="text-[10px] font-black uppercase text-slate-600">Tablero por objetivo (vivo)</span>
            {!board.isLiveReady && <Loader2 size={12} className="animate-spin text-slate-400" />}
          </div>
          <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {board.objectiveSummaries.length === 0 && board.isLiveReady && (
              <p className="p-4 text-xs text-slate-500">Sin objetivos en scope para hoy.</p>
            )}
            {board.objectiveSummaries.map((o) => {
              const st = COVERAGE_STATUS_STYLES[o.status];
              return (
                <div key={o.objectiveId} className="px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{o.objectiveName}</p>
                    <p className="text-[10px] text-slate-500 truncate">{o.clientName}</p>
                  </div>
                  <div className="flex gap-2 text-[10px] font-black tabular-nums shrink-0">
                    <span className="text-emerald-600">{o.activos}a</span>
                    <span className="text-rose-600">{o.vacantes}v</span>
                    <span className="text-amber-600">{o.ausentes}aus</span>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${st.bg} ${st.text}`}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-violet-600" />
          <h3 className="text-sm font-black uppercase text-slate-700 dark:text-slate-200">
            Día · mandos e informes
          </h3>
        </div>

        {board.auditSummary && (
          <p className="text-xs text-slate-600">
            Actividad CC registrada: {board.auditSummary.total} eventos · {board.auditSummary.coberturas}{' '}
            coberturas · {board.auditSummary.ingresos} ingresos · {board.auditSummary.ausencias} ausencias
          </p>
        )}

        <div>
          <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Sesiones del día</p>
          {board.daySessions.length === 0 ? (
            <p className="text-xs text-slate-500">Sin sesiones en esta fecha (Manual inactivo → tramo Auto).</p>
          ) : (
            <ul className="space-y-2">
              {board.daySessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <span className="font-bold">{s.operatorName}</span>
                  <span
                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg ${
                      s.role === 'PILOTO' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {s.role === 'PILOTO' ? 'A mando' : 'Apoyo'}
                  </span>
                  <span className="text-slate-500">
                    {s.startTime.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {s.endTime
                      ? s.endTime.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                      : s.status === 'ACTIVO'
                        ? 'En curso'
                        : '—'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">{s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Informes de mando guardados</p>
          {board.informes.length === 0 ? (
            <p className="text-xs text-slate-500">
              No hay informes formales en CC para esta fecha (se generan al cierre en Operaciones).
            </p>
          ) : (
            <ul className="space-y-2">
              {board.informes.map((inf) => (
                <li
                  key={inf.id}
                  className="rounded-xl border border-violet-100 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2 text-xs"
                >
                  <p className="font-bold text-violet-900 dark:text-violet-200">{inf.operatorName}</p>
                  <p className="text-slate-600 mt-0.5">
                    {inf.guardiaStart.toLocaleString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' → '}
                    {inf.guardiaEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 mt-1">
                    Coberturas {inf.resumen?.coberturas ?? 0} · Ausencias {inf.resumen?.ausencias ?? 0} · Ingresos{' '}
                    {inf.resumen?.ingresos ?? 0}
                  </p>
                  {inf.observaciones && (
                    <p className="text-[10px] text-slate-600 mt-1 italic">{inf.observaciones}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
