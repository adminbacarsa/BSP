import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Calendar, CheckCircle, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export type CrmRangeMode = 'month' | 'year' | 'all';
export type ClientListFilter = 'all' | 'activos' | 'con_sla' | 'burn_alerta';
export type ClientListSort = 'name' | 'burn_desc' | 'sla_desc' | 'plan_gap';

export type CrmClientMetric = {
  sla?: number;
  planned?: number;
  real?: number;
  burnRate?: number;
};

type Props = {
  rangeLabel: string;
  rangeMode: CrmRangeMode;
  rangeMonth: number;
  rangeYear: number;
  onRangeModeChange: (mode: CrmRangeMode) => void;
  onRangeMonthChange: (month: number) => void;
  onRangeYearChange: (year: number) => void;
  totalSold: number;
  totalPlanned: number;
  totalExecuted: number;
  calculatingMetrics: boolean;
  metricsUpdatedAt: Date | null;
  clientsCount: number;
  conSlaCount: number;
  clientListFilter: ClientListFilter;
  clientListSort: ClientListSort;
  onClientListFilterChange: (v: ClientListFilter) => void;
  onClientListSortChange: (v: ClientListSort) => void;
  clients: Array<{ id: string; name?: string }>;
  clientMetricsMap: Record<string, CrmClientMetric>;
};

function pct(num: number, den: number): number {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 100);
}

function truncateLabel(name: string, max = 16): string {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
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
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs dark:border-slate-600 dark:bg-slate-800">
      <p className="font-bold text-slate-700 dark:text-slate-200 mb-1.5 max-w-[200px] truncate">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-semibold text-slate-600 dark:text-slate-300" style={{ color: p.color }}>
          {p.name}: {Math.round(Number(p.value) || 0).toLocaleString('es-AR')} hs
        </p>
      ))}
    </div>
  );
}

export default function CrmDashboardSummary({
  rangeLabel,
  rangeMode,
  rangeMonth,
  rangeYear,
  onRangeModeChange,
  onRangeMonthChange,
  onRangeYearChange,
  totalSold,
  totalPlanned,
  totalExecuted,
  calculatingMetrics,
  metricsUpdatedAt,
  clientsCount,
  conSlaCount,
  clientListFilter,
  clientListSort,
  onClientListFilterChange,
  onClientListSortChange,
  clients,
  clientMetricsMap,
}: Props) {
  const burn = pct(totalExecuted, totalSold);
  const planVsSla = pct(totalPlanned, totalSold);
  const execVsPlan = pct(totalExecuted, totalPlanned);
  const deltaPlanSla = totalPlanned - totalSold;

  const portfolioChart = useMemo(
    () => [{ key: 'Cartera', sla: totalSold, planificado: totalPlanned, ejecutado: totalExecuted }],
    [totalSold, totalPlanned, totalExecuted],
  );

  const clientsChart = useMemo(() => {
    return clients
      .map((c) => {
        const m = clientMetricsMap[c.id] || {};
        const sla = Math.round(m.sla || 0);
        const planificado = Math.round(m.planned || 0);
        const ejecutado = Math.round(m.real || 0);
        return {
          name: truncateLabel(c.name || 'Sin nombre'),
          sla,
          planificado,
          ejecutado,
          weight: sla + planificado,
        };
      })
      .filter((d) => d.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [clients, clientMetricsMap]);

  const burnTone =
    burn >= 110 ? 'text-rose-600' : burn >= 90 ? 'text-amber-600' : 'text-emerald-600';

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

      <div className="grid lg:grid-cols-12 gap-0 lg:divide-x divide-slate-100 dark:divide-slate-700">
        <div className="lg:col-span-5 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              icon={ShieldCheck}
              label="SLA solicitado"
              value={totalSold}
              accent="text-indigo-600"
              iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40"
            />
            <KpiTile
              icon={Calendar}
              label="Planificado"
              value={totalPlanned}
              accent="text-slate-800 dark:text-white"
              iconBg="bg-slate-100 text-slate-600 dark:bg-slate-700"
              hint={
                totalSold > 0
                  ? `Δ ${deltaPlanSla >= 0 ? '+' : ''}${deltaPlanSla.toLocaleString('es-AR')} hs vs SLA`
                  : undefined
              }
            />
            <KpiTile
              icon={CheckCircle}
              label="Ejecutado (fichado)"
              value={totalExecuted}
              accent="text-emerald-700 dark:text-emerald-400"
              iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30"
            />
            <KpiTile
              icon={TrendingUp}
              label="Burn (ejec. ÷ SLA)"
              value={burn}
              suffix="%"
              accent={burnTone}
              iconBg="bg-slate-100 text-slate-600 dark:bg-slate-700"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <SecondaryKpi label="Plan ÷ SLA" value={`${planVsSla}%`} />
            <SecondaryKpi label="Ejec. ÷ plan" value={`${execVsPlan}%`} />
            <SecondaryKpi label="Con SLA" value={`${conSlaCount}/${clientsCount}`} />
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Totales del período (hs)
            </p>
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={portfolioChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="key" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="sla" name="SLA" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  <Bar dataKey="planificado" name="Planificado" fill="#64748b" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  <Bar dataKey="ejecutado" name="Ejecutado" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-6">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
            Principales clientes · SLA vs plan vs ejecutado (hs)
          </p>
          {clientsChart.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] rounded-xl border border-dashed border-slate-200 text-sm font-semibold text-slate-400 dark:border-slate-600">
              Sin horas en este período para graficar
            </div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clientsChart} margin={{ top: 8, right: 8, left: -12, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    angle={-32}
                    textAnchor="end"
                    height={56}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar dataKey="sla" name="SLA" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="planificado" name="Planificado" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="ejecutado" name="Ejecutado" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
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
        <span className="text-[10px] text-slate-400 ml-auto hidden sm:inline">
          Burn: <span className="text-emerald-600 font-bold">&lt;90%</span> ·{' '}
          <span className="text-amber-600 font-bold">90–109%</span> ·{' '}
          <span className="text-rose-600 font-bold">≥110%</span>
        </span>
      </div>
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  suffix = 'hs',
  accent,
  iconBg,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  suffix?: string;
  accent: string;
  iconBg: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex items-start gap-2.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={17} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
          <p className={`text-2xl font-black tabular-nums leading-tight ${accent}`}>
            {value.toLocaleString('es-AR')}
            {suffix && <span className="text-sm font-bold text-slate-300 ml-0.5">{suffix}</span>}
          </p>
          {hint && <p className="text-[9px] font-semibold text-slate-500 mt-0.5 truncate">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function SecondaryKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-2 text-center dark:border-slate-700 dark:bg-slate-800/60">
      <p className="text-[8px] font-bold uppercase text-slate-400 tracking-wide">{label}</p>
      <p className="text-sm font-black text-slate-800 dark:text-white tabular-nums">{value}</p>
    </div>
  );
}
