import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Building2, Calendar, CheckCircle, Loader2, MapPin, ShieldCheck, TrendingUp, Briefcase } from 'lucide-react';
import { crmCalendarQuarter, crmCalendarSemester, type CrmRangeMode } from '@/lib/crm/crmDashboardBuckets';
import type { CrmCommercialStats } from '@/lib/crm/crmCommercialStats';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export type ClientListFilter = 'all' | 'activos' | 'con_sla' | 'burn_alerta' | 'sla_sin_plan' | 'hueco_plan' | 'sin_fichadas';
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
  loadProgress?: { pct: number; label: string } | null;
  isStale?: boolean;
  metricsUpdatedAt: Date | null;
  clientsCount: number;
  conSlaCount: number;
  commercial: CrmCommercialStats;
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
  loadProgress,
  isStale,
  metricsUpdatedAt,
  clientsCount,
  conSlaCount,
  commercial,
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
  const chartData = useMemo(() => {
    if (trendSeries.length !== 1) return trendSeries;
    const p = trendSeries[0];
    const last = new Date(rangeYear, rangeMonth + 1, 0).getDate();
    const short = MONTHS_ES[rangeMonth].slice(0, 3);
    return [
      { ...p, label: `1 ${short}` },
      { ...p, label: `${last} ${short}` },
    ];
  }, [trendSeries, rangeMonth, rangeYear]);
  const showDots = chartData.length <= 6;
  const selectCls = 'text-[9px] font-bold uppercase border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 dark:border-slate-600 dark:bg-slate-900';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
      <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-800/80">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <BarChart3 size={12} className="text-indigo-600 shrink-0" aria-hidden />
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Centro de mando</span>
          <h2 className="text-sm font-black text-slate-900 dark:text-white leading-none">{rangeLabel}</h2>
          {calculatingMetrics && (
            <span className="inline-flex items-center gap-1 text-indigo-600 text-[9px] font-semibold">
              <Loader2 className="animate-spin" size={12} aria-hidden />
              <span className="normal-case tracking-normal text-slate-500 truncate">
                {loadProgress?.label || 'Cargando…'}
              </span>
              <span className="tabular-nums font-black">
                {Math.max(0, Math.min(100, Math.round(loadProgress?.pct ?? 0)))}%
              </span>
            </span>
          )}
          {metricsUpdatedAt && !calculatingMetrics && (
            <span className="text-[9px] font-medium text-slate-400">
              {metricsUpdatedAt.toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <select aria-label="Período del resumen" className={selectCls} value={rangeMode} onChange={(e) => onRangeModeChange(e.target.value as CrmRangeMode)}>
            <option value="month">Mes</option>
            <option value="quarter">Trimestre</option>
            <option value="semester">Semestre</option>
            <option value="year">Año</option>
            <option value="all">Histórico</option>
          </select>
          {rangeMode !== 'all' && (
            <select aria-label="Año del período" className={selectCls} value={rangeYear} onChange={(e) => onRangeYearChange(Number(e.target.value))}>
              {[rangeYear - 2, rangeYear - 1, rangeYear, rangeYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          {rangeMode === 'month' && (
            <select aria-label="Mes del período" className={selectCls} value={rangeMonth} onChange={(e) => onRangeMonthChange(Number(e.target.value))}>
              {MONTHS_ES.map((m, idx) => (
                <option key={m} value={idx}>{m}</option>
              ))}
            </select>
          )}
          {rangeMode === 'quarter' && (
            <select aria-label="Trimestre del período" className={selectCls} value={crmCalendarQuarter(rangeMonth)} onChange={(e) => onRangeMonthChange(Number(e.target.value) * 3)}>
              <option value={0}>T1 Ene–Mar</option>
              <option value={1}>T2 Abr–Jun</option>
              <option value={2}>T3 Jul–Sep</option>
              <option value={3}>T4 Oct–Dic</option>
            </select>
          )}
          {rangeMode === 'semester' && (
            <select aria-label="Semestre del período" className={selectCls} value={crmCalendarSemester(rangeMonth)} onChange={(e) => onRangeMonthChange(Number(e.target.value) * 6)}>
              <option value={0}>S1 Ene–Jun</option>
              <option value={1}>S2 Jul–Dic</option>
            </select>
          )}
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-1.5">
          <KpiCompact featured icon={ShieldCheck} label="SLA vendidas" value={totalSold} unit="hs" tone="text-indigo-600" />
          <KpiCompact featured icon={Calendar} label="Plan cobertura" value={totalPlanned} unit="hs" tone="text-slate-800 dark:text-white" />
          <KpiCompact featured icon={CheckCircle} label="Realizadas" value={totalExecuted} unit="hs" tone="text-emerald-600" />
          <KpiCompact icon={TrendingUp} label="Burn" value={burn} unit="%" tone={burnTone} />
          <KpiCompact label="Plan ÷ SLA" value={planVsSla} unit="%" tone="text-slate-700 dark:text-slate-200" />
          <KpiCompact label="Real. ÷ plan" value={execVsPlan} unit="%" tone="text-slate-700 dark:text-slate-200" />
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <MiniStat label="Δ plan − SLA" value={`${deltaPlanSla >= 0 ? '+' : ''}${deltaPlanSla.toLocaleString('es-AR')} hs`} />
          <MiniStat label="Δ real. − SLA" value={`${gapEjecSla >= 0 ? '+' : ''}${gapEjecSla.toLocaleString('es-AR')} hs`} />
          <MiniStat label="Hs SLA / cliente" value={commercial.avgSlaPerClient > 0 ? `${commercial.avgSlaPerClient.toLocaleString('es-AR')} hs` : '—'} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-1.5">
          <DetailStat
            icon={Building2}
            label="Activos"
            value={`${commercial.clientsActive}/${commercial.clientsTotal}`}
            hint="clientes"
            active={clientListFilter === 'activos'}
            onClick={() => onClientListFilterChange(clientListFilter === 'activos' ? 'all' : 'activos')}
          />
          <DetailStat
            icon={MapPin}
            label="Sedes"
            value={commercial.slaObjectives != null ? `${commercial.slaObjectives}/${commercial.catalogObjectives}` : String(commercial.catalogObjectives)}
            hint={commercial.slaObjectives != null ? 'SLA / padrón' : 'padrón'}
          />
          <DetailStat
            icon={ShieldCheck}
            label="Con SLA"
            value={`${commercial.clientsWithSla}/${commercial.clientsTotal}`}
            hint="contrato"
            active={clientListFilter === 'con_sla'}
            onClick={() => onClientListFilterChange(clientListFilter === 'con_sla' ? 'all' : 'con_sla')}
          />
          <DetailStat
            icon={Briefcase}
            label="Puestos"
            value={commercial.slaPositions != null ? String(commercial.slaPositions) : '—'}
            hint="pax vendidos"
          />
          <AlertChip
            count={commercial.clientsSlaNoPlan}
            label="Sin plan"
            hint="SLA sin malla"
            tone="amber"
            active={clientListFilter === 'sla_sin_plan'}
            onClick={() => onClientListFilterChange(clientListFilter === 'sla_sin_plan' ? 'all' : 'sla_sin_plan')}
          />
          <AlertChip
            count={commercial.clientsUnderplanned}
            label="Hueco"
            hint="plan < SLA"
            tone="rose"
            active={clientListFilter === 'hueco_plan'}
            onClick={() => onClientListFilterChange(clientListFilter === 'hueco_plan' ? 'all' : 'hueco_plan')}
          />
          <AlertChip
            count={commercial.clientsNoExecution}
            label="Sin fichadas"
            hint="con SLA o plan"
            tone="slate"
            active={clientListFilter === 'sin_fichadas'}
            onClick={() => onClientListFilterChange(clientListFilter === 'sin_fichadas' ? 'all' : 'sin_fichadas')}
          />
          <AlertChip
            count={commercial.clientsBurnAlert}
            label="Burn ≥ 90%"
            hint="consumo"
            tone="rose"
            active={clientListFilter === 'burn_alerta'}
            onClick={() => onClientListFilterChange(clientListFilter === 'burn_alerta' ? 'all' : 'burn_alerta')}
          />
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
            <TrendingUp size={11} className="text-indigo-500" />
            {trendTitle}
          </p>
          {!hasChartData ? (
            <div className="flex items-center justify-center h-[168px] text-xs font-semibold text-slate-400">
              Sin horas en el rango del gráfico
            </div>
          ) : (
            <div className="relative h-[168px] w-full">
              {isStale && (
                <div className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/90 px-2 py-0.5 shadow-sm dark:border-amber-700/50 dark:bg-amber-900/40">
                  <Loader2 size={9} className="animate-spin text-amber-600" />
                  <span className="text-[8px] font-bold uppercase text-amber-700 dark:text-amber-300">actualizando…</span>
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="crmAreaSla" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="crmAreaPlan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#64748b" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#64748b" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="crmAreaReal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity={0.42} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 9, fontWeight: 700, paddingTop: 0 }} iconType="circle" iconSize={7} />
                  <Area type="monotone" dataKey="sla" name="SLA vendidas" stroke="#4f46e5" fill="url(#crmAreaSla)" strokeWidth={2} dot={showDots ? { r: 3, fill: '#4f46e5', strokeWidth: 0 } : false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="planificado" name="Planificadas" stroke="#64748b" fill="url(#crmAreaPlan)" strokeWidth={1.8} strokeDasharray="5 3" dot={showDots ? { r: 3, fill: '#64748b', strokeWidth: 0 } : false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="ejecutado" name="Realizadas" stroke="#059669" fill="url(#crmAreaReal)" strokeWidth={2} dot={showDots ? { r: 3, fill: '#059669', strokeWidth: 0 } : false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {!calculatingMetrics && clientsCount > 0 && totalSold === 0 && totalPlanned === 0 && totalExecuted === 0 && (
        <p className="px-4 py-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border-t border-amber-100 dark:bg-amber-900/20 dark:border-amber-900/40 dark:text-amber-200">
          Sin horas en {rangeLabel}. Probá otro mes calendario (mismo criterio que pre-factura).
        </p>
      )}

      <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-2 bg-slate-50/50 dark:bg-slate-900/30">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Listado</span>
        <select
          aria-label="Filtrar clientes"
          className="text-[9px] font-bold uppercase border border-slate-200 rounded-lg px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
          value={clientListFilter}
          onChange={(e) => onClientListFilterChange(e.target.value as ClientListFilter)}
        >
          <option value="all">Todos ({clientsCount})</option>
          <option value="activos">Solo activos</option>
          <option value="con_sla">Con SLA en período ({conSlaCount})</option>
          <option value="sla_sin_plan">SLA sin plan ({commercial.clientsSlaNoPlan})</option>
          <option value="hueco_plan">Hueco de cobertura ({commercial.clientsUnderplanned})</option>
          <option value="sin_fichadas">Sin fichadas ({commercial.clientsNoExecution})</option>
          <option value="burn_alerta">Burn ≥ 90% ({commercial.clientsBurnAlert})</option>
        </select>
        <select
          aria-label="Ordenar clientes"
          className="text-[9px] font-bold uppercase border border-slate-200 rounded-lg px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
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
  featured,
}: {
  icon?: React.ElementType;
  label: string;
  value: number;
  unit: string;
  tone: string;
  featured?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-slate-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/80 ${featured ? 'px-2.5 py-2' : 'px-2 py-1.5'}`}>
      <div className={`flex items-center gap-1 font-bold uppercase tracking-wide text-slate-500 ${featured ? 'text-[9px]' : 'text-[8px]'}`}>
        {Icon ? <Icon size={featured ? 12 : 10} className="text-indigo-500 shrink-0" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <p className={`font-black tabular-nums leading-tight ${featured ? 'text-[17px]' : 'text-sm'} ${tone}`}>
        {value.toLocaleString('es-AR')}
        <span className={`${featured ? 'text-[10px]' : 'text-[9px]'} font-bold text-slate-400 ml-0.5`}>{unit}</span>
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800/50">
      <p className="text-[7px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-[11px] font-black text-slate-800 dark:text-white tabular-nums">{value}</p>
    </div>
  );
}

function DetailStat({
  icon: Icon,
  label,
  value,
  hint,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = `rounded-lg border px-2 py-1.5 text-left shadow-sm transition-colors ${
    active
      ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40'
      : 'border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800/80'
  } ${onClick ? 'hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer' : ''}`;
  const inner = (
    <>
      <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide text-slate-500">
        <Icon size={10} className="text-indigo-500 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className="text-sm font-black tabular-nums text-slate-900 dark:text-white leading-tight">{value}</p>
      <p className="text-[8px] font-medium text-slate-400">{hint}</p>
    </>
  );
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

function AlertChip({
  count,
  label,
  hint,
  tone,
  active,
  onClick,
}: {
  count: number;
  label: string;
  hint: string;
  tone: 'amber' | 'rose' | 'slate';
  active: boolean;
  onClick: () => void;
}) {
  const idle = count === 0;
  const tones = {
    amber: idle ? 'text-slate-400' : 'text-amber-700 dark:text-amber-300',
    rose: idle ? 'text-slate-400' : 'text-rose-700 dark:text-rose-300',
    slate: idle ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200',
  };
  const border = active
    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40'
    : 'border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800/80';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-1.5 text-left shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${border}`}
    >
      <p className={`text-sm font-black tabular-nums leading-tight ${tones[tone]}`}>{count}</p>
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</p>
      <p className="text-[8px] font-medium text-slate-400">{hint}</p>
    </button>
  );
}
