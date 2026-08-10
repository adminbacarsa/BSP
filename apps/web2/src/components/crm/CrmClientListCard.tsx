import React from 'react';
import { Building2 } from 'lucide-react';

export type CrmCardMetric = {
  sla?: number;
  planned?: number;
  real?: number;
  burnRate?: number;
};

type Props = {
  name?: string;
  taxId?: string;
  empresaId?: string;
  statusLabel: string;
  statusActivo: boolean;
  showEmpresaId: boolean;
  metric: CrmCardMetric;
  ejecLabel: string;
  ejecMuted: boolean;
  burnPct: number;
  burnTextCls: string;
  planGap: number;
};

export default function CrmClientListCard({
  name,
  taxId,
  empresaId,
  statusLabel,
  statusActivo,
  showEmpresaId,
  metric,
  ejecLabel,
  ejecMuted,
  burnPct,
  burnTextCls,
  planGap,
}: Props) {
  const sla = Math.round(metric.sla || 0);
  const planned = Math.round(metric.planned || 0);

  const statusCls = statusActivo
    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
    : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-400';

  const burnBarColor =
    burnPct >= 110 ? '#ef4444' : burnPct >= 90 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
          <Building2 size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate leading-snug">{name}</h3>
          <p className="text-[10px] font-medium text-slate-500 mt-0.5">
            {taxId || 'Sin CUIT'}
            {showEmpresaId && empresaId ? (
              <span className="text-indigo-500 ml-1">· {empresaId}</span>
            ) : null}
          </p>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase shrink-0 ${statusCls}`}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-3 mt-auto">
        <MetricCell label="SLA" value={`${sla.toLocaleString('es-AR')}`} unit="hs" emphasize />
        <MetricCell
          label="Planificado"
          value={`${planned.toLocaleString('es-AR')}`}
          unit="hs"
          sub={
            planGap !== 0 && sla > 0
              ? `${planGap > 0 ? '+' : ''}${planGap} vs SLA`
              : undefined
          }
          subTone={planGap > 0 ? 'text-amber-600' : 'text-indigo-600'}
        />
        <MetricCell
          label="Ejecutado"
          value={ejecLabel}
          muted={ejecMuted}
        />
        <div>
          <p className="text-[9px] font-bold uppercase text-slate-400 tracking-wide">Burn</p>
          <p className={`text-sm font-black tabular-nums ${burnTextCls}`}>{burnPct}%</p>
          <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-600 mt-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, burnPct)}%`, backgroundColor: burnBarColor }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  unit,
  emphasize,
  muted,
  sub,
  subTone = 'text-slate-500',
}: {
  label: string;
  value: string;
  unit?: string;
  emphasize?: boolean;
  muted?: boolean;
  sub?: string;
  subTone?: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase text-slate-400 tracking-wide">{label}</p>
      <p
        className={`text-sm font-black tabular-nums leading-tight ${
          muted ? 'text-amber-600' : emphasize ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-white'
        }`}
      >
        {value}
        {unit && !value.includes('hs') && (
          <span className="text-[10px] font-semibold text-slate-400 ml-0.5">{unit}</span>
        )}
      </p>
      {sub && <p className={`text-[8px] font-semibold mt-0.5 ${subTone}`}>{sub}</p>}
    </div>
  );
}
