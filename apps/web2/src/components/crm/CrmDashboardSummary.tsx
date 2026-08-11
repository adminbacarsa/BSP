import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Calendar, CheckCircle, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';
import type { CrmRangeMode } from '@/lib/crm/crmDashboardBuckets';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export type ClientListFilter = 'all' | 'activos' | 'con_sla' | 'burn_alerta';
export type ClientListSort = 'name' | 'burn_desc' | 'sla_desc' | 'plan_gap';

export type CrmTrendPoint = {
  label: string;
  sla: number;
  planificado: number;
  ejecutado: number;
};

type Props = {
  rangeLabel: string;
  trendTitle: string;
  rangeMode: CrmRangeMode;
  rangeMonth: number;
  rangeYear: number;
  onRangeModeChange: (mode: CrmRangeMode) => void;
  onRangeMonthChange: (month: number) => void;
  onRangeYearChange: (year: number) => void;
  totalSold: number;
  totalPlanned: number;
  totalExecuted: number;
  trendSeries: CrmTrendPoint[];
  calculatingMetrics: boolean;
  isStale?: boolean;
  metricsUpdatedAt: Date | null;
  clientsCount: number;
  conSlaCount: number;
  clientListFilter: ClientListFilter;
  clientListSort: ClientListSort;
  onClientListFilterChange: (v: ClientListFilter) => void;
  onClientListSortChange: (v: ClientListSort) => void;
};

function pct(num: number, den: number): number {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 100);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg text-xs dark:border-slate-600 dark:bg-slate-800">
      <p className="font-bold text-slate-800 dark:text-slate-100 mb-2">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-semibold tabular-nums" style={{ color: p.color }}>
          {p.name}: {Math.round(Number(p.value) || 0).toLocaleString('es-AR')} hs
        </p>
      ))}
    </div>
  );
}

export default function CrmDashboardSummary({
  rangeLabel,
  trendTitle,
  rangeMode,
  rangeMonth,
  rangeYear,
  onRangeModeChange,
  onRangeMonthChange,
  onRangeYearChange,
  totalSold,
  totalPlanned,
  totalExecuted,
  trendSeries,
  calculatingMetrics,
  isStale,
  metricsUpdatedAt,
  clientsCount,
  conSlaCount,
  clientListFilter,
  clientListSort,
  onClientListFilterChange,
  onClientListSortChange,
}: Props) {
  const burn = pct(totalExecuted, totalSold);
  const planVsSla = pct(totalPlanned, totalSold);
  const execVsPlan = pct(totalExecuted, totalPlanned);
  const deltaPlanSla = totalPlanned - totalSold;
  const gapEjecSla = totalExecuted - totalSold;

  const burnTone =
    burn >= 110 ? 'text-rose-600' : burn >= 90 ? 'text-amber-600' : 'text-emerald-600';

  const hasChartData = useMemo(
    () => trendSeries.some((p) => p.sla > 0 || p.planificado > 0 || p.ejecutado > 0),
    [trendSeries],
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <BarChart3 size={14} className="text-indigo-600" aria-hidden />
            Centro de mando comercial
            {calculatingMetrics && <Loader2 className="animate-spin text-indigo-500" size={14} />}
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{rangeLabel}</h2>
          {metricsUpdatedAt && (
            <p className="text-[10px] font-medium text-slate-400 mt-0.5">
              Actualizado{' '}
              {metricsUpdatedAt.toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <select
            aria-label="Período del resumen"
            className="text-[10px] font-bold uppercase border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 dark:border-slate-600 dark:bg-slate-900"
            value={rangeMode}
            onChange={(e) => onRangeModeChange(e.target.value as CrmRangeMode)}
          >
            <option value="month">Mes calendario</option>
            <option value="year">Año</option>
            <option value="all">Histórico</option>
          </select>
          {rangeMode !== 'all' && (
            <select
              aria-label="Año del período"
              className="text-[10px] font-bold uppercase border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 dark:border-slate-600 dark:bg-slate-900"
              value={rangeYear}
              onChange={(e) => onRangeYearChange(Number(e.target.value))}
            >
              {[rangeYear - 2, rangeYear - 1, rangeYear, rangeYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          {rangeMode === 'month' && (
            <select
              aria-label="Mes del período"
              className="text-[10px] font-bold uppercase border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 dark:border-slate-600 dark:bg-slate-900"
              value={rangeMonth}
              onChange={(e) => onRangeMonthChange(Number(e.target.value))}
            >
              {MONTHS_ES.map((m, idx) => (
                <option key={m} value={idx}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCompact icon={ShieldCheck} label="SLA vendidas" value={totalSold} unit="hs" tone="text-indigo-600" />
          <KpiCompact icon={Calendar} label="Planificadas" value={totalPlanned} unit="hs" tone="text-slate-800 dark:text-white" />
          <KpiCompact icon={CheckCircle} label="Realizadas" value={totalExecuted} unit="hs" tone="text-emerald-600" />
          <KpiCompact icon={TrendingUp} label="Burn" value={burn} unit="%" tone={burnTone} />
          <KpiCompact label="Plan ÷ SLA" value={planVsSla} unit="%" tone="text-slate-700 dark:text-slate-200" />
          <KpiCompact label="Real. ÷ plan" value={execVsPlan} unit="%" tone="text-slate-700 dark:text-slate-200" />
        </div>

        <div className="grid sm:grid-cols-3 gap-2 text-center">
          <MiniStat
            label="Δ plan − SLA"
            value={`${deltaPlanSla >= 0 ? '+' : ''}${deltaPlanSla.toLocaleString('es-AR')} hs`}
          />
          <MiniStat
            label="Δ real. − SLA"
            value={`${gapEjecSla >= 0 ? '+' : ''}${gapEjecSla.toLocaleString('es-AR')} hs`}
          />
          <MiniStat label="Clientes con SLA" value={`${conSlaCount} / ${clientsCount}`} />
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
            <TrendingUp size={12} className="text-indigo-500" />
            {trendTitle}
          </p>
          {!hasChartData ? (
            <div className="flex items-center justify-center h-[300px] text-sm font-semibold text-slate-400">
              Sin horas en el rango del gráfico
            </div>
          ) : (
            <div className="relative h-[300px] w-full">
              {isStale && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50/90 px-2.5 py-1 shadow-sm backdrop-blur-sm dark:border-amber-700/50 dark:bg-amber-900/40">
                  <Loader2 size={10} className="animate-spin text-amber-600 dark:text-amber-400" />
                  <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">actualizando…</span>
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendSeries} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="crmSlaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, fontWeight: 700, paddingTop: 8 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Area
                    type="monotone"
                    dataKey="sla"
                    name="SLA (vendidas)"
                    stroke="#4f46e5"
                    fill="url(#crmSlaGrad)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#4f46e5' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="planificado"
                    name="Planificadas"
                    stroke="#64748b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: '#64748b' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="ejecutado"
                    name="Realizadas"
                    stroke="#059669"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#059669' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {!calculatingMetrics && clientsCount > 0 && totalSold === 0 && totalPlanned === 0 && totalExecuted === 0 && (
        <p className="px-6 py-3 text-xs font-semibold text-amber-800 bg-amber-50 border-t border-amber-100 dark:bg-amber-900/20 dark:border-amber-900/40 dark:text-amber-200">
          Sin horas en {rangeLabel}. Probá otro mes calendario (mismo criterio que pre-factura).
        </p>
      )}

      <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3 bg-slate-50/50 dark:bg-slate-900/30">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Listado</span>
        <select
          aria-label="Filtrar clientes"
          className="text-[10px] font-bold uppercase border border-slate-200 rounded-xl px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
          value={clientListFilter}
          onChange={(e) => onClientListFilterChange(e.target.value as ClientListFilter)}
        >
          <option value="all">Todos ({clientsCount})</option>
          <option value="activos">Solo activos</option>
          <option value="con_sla">Con SLA en período ({conSlaCount})</option>
          <option value="burn_alerta">Burn ≥ 90%</option>
        </select>
        <select
          aria-label="Ordenar clientes"
          className="text-[10px] font-bold uppercase border border-slate-200 rounded-xl px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
          value={clientListSort}
          onChange={(e) => onClientListSortChange(e.target.value as ClientListSort)}
        >
          <option value="name">Nombre A–Z</option>
          <option value="burn_desc">Mayor burn</option>
          <option value="sla_desc">Mayor SLA</option>
          <option value="plan_gap">Mayor Δ plan − SLA</option>
        </select>
      </div>
    </div>
  );
}

function KpiCompact({
  icon: Icon,
  label,
  value,
  unit,
  tone,
}: {
  icon?: React.ElementType;
  label: string;
  value: number;
  unit: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
        {Icon ? <Icon size={12} className="text-indigo-500 shrink-0" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-xl font-black tabular-nums mt-1 ${tone}`}>
        {value.toLocaleString('es-AR')}
        <span className="text-[10px] font-bold text-slate-400 ml-0.5">{unit}</span>
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-800/50">
      <p className="text-[8px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-xs font-black text-slate-800 dark:text-white tabular-nums">{value}</p>
    </div>
  );
}
