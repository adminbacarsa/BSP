/* COSP_ANALISIS_V2 swc-jsx-fix */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, TabBar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useAnalisisSnapshot } from '@/hooks/useAnalisisSnapshot';
import { shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import {
  parseAbsenceInstant,
  ausenciaSolapaPeriodo,
  ausenciaCuentaNoDisponible,
  filterTurnosInRange,
  buildAusenciasStats,
  topNPlusResto,
  isVacantShift,
  shiftStartMs,
} from '@/lib/analisis/analisisQueries';
import { buildDemandaByObjective } from '@/lib/analisis/analisisDemanda';
import { demandaFromHoursBalances, financieraFromHoursBalances } from '@/lib/analisis/analisisFromHoursBalance';
import {
  buildAnalisisFinanciera,
  FIN_NOV_BREAKDOWN_CODES,
  FIN_NOV_HEAD_COLS,
  finGuardConsumo,
  finGuardNovCode,
  finGuardNovOtros,
  finIdleHours,
  finNovCode,
  finNovOtros,
  finPlanHours,
  finSumadasHours,
  rollAnalisisFinanciera,
  type FinHoursMode,
} from '@/lib/analisis/analisisFinanciera';
import {
  buildInformeAnalitico,
  buildInformeSeries,
  chooseInformeSeriesBucket,
  estimarCostoInforme,
  formatArs,
  iterateInformeBuckets,
} from '@/lib/analisis/analisisInforme';
import {
  CCT_HS_MENSUAL,
  buildAnalisisUniverso,
  cctBolsaHsPerGuard,
} from '@/lib/analisis/analisisUniverso';
import { buildBolsaRealista, threeMonthLookback } from '@/lib/analisis/analisisBolsa';
import {
  TrendingUp, Users, Clock, Activity, AlertTriangle, CheckCircle,
  Loader2, BarChart3, Target, ChevronLeft, ChevronRight,
  Shield, AlertCircle, ArrowUp, ArrowDown, Minus, Calendar, ChevronDown,
  Filter, PieChart as PieIcon, BarChart2, Download, RefreshCw, Scale,
  MapPin, Wallet, FileText, FileSpreadsheet, Building2, Layers, Briefcase,
} from 'lucide-react';
import { buildViabilityRangeReport } from '@/utils/viabilityAnalysis';
import {
  calculateSlaHoursForDateRange,
  countSlaDemandDaysInRange,
} from '@/lib/servicios/slaHoursCalculator';
import {
  calcPlanificadorShiftHours,
  calcPlanningScheduledShiftHours,
  isOperationalOriginShift,
  isPlanificadorPlannedHoursShift,
  isPlanningScheduledCoverageShift,
  shiftCoverageExtensionExtraHours,
} from '@/lib/planificacion/planningScheduledHours';
import { isDeploymentOrPoolShift, resolveDeploymentStatHours, deploymentStatKind, shiftCountsForEmployeeCronoHours, isRegularLiquidationWorkShift } from '@/lib/planificacion/deploymentRoles';
import { getDateKeyInTimezone, isProformaVacancyShift } from '@/lib/crm/proformaGrid';
import { resolveCanonicalObjectiveId } from '@/lib/crm/objectiveIdentity';
import { pickVigenteSlasForPeriod, slaHoursForServiceInRange } from '@/lib/crm/slaObjectiveHours';
import { buildSlaExclusionContext, isTurnoOnSlaExcludedSlot } from '@/lib/crm/slaExclusionForPlanned';
import { persistHoursBalancesFromTurnos } from '@/lib/hoursBalance';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Line,
  PieChart, Pie, RadialBarChart, RadialBar, AreaChart, Area, Treemap,
} from 'recharts';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const JS_DAY_MAP   = ['D','L','M','X','J','V','S'];
/** Códigos típicos operativos (referencia rápida para informes específicos como ART.12). */
const OPERATIVE_CODES = new Set(['M','T','N','D12','N12','PU','GU','FT']);
const FRANCO_SHIFT_CODES = new Set(['F', 'FF', 'FP']);
/** Turnos no operativos desde planificación/RRHH (vacaciones, licencias, enfermedad, ART, PG…). */
const LICENCIA_SHIFT_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);
const isCoverageShift = isPlanningScheduledCoverageShift;

/** Umbral referencia ART (convivencia / traslado): domicilio del personal vs ubicación del puesto. */
const ART12_MAX_KM_VIVIENDA = 25;
/** Por encima de esto se considera error de carga (coords invertidas, geocodificación fuera de país, etc.), no desplazamiento real. */
const ART12_MAX_PLAUSIBLE_COMMUTE_KM = 500;

/** Caja amplia Argentina para detectar domicilios claramente fuera de lugar o lat/lng invertidos. */
function isRoughArgentinaLatLng(lat: number, lng: number): boolean {
  return lat >= -56 && lat <= -20 && lng >= -74 && lng <= -52;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Si la distancia es absurda, prueba lat/lng del legajo invertidos (error frecuente al guardar). */
function art12EmployeeCoordsForDistance(
  rawLat: number,
  rawLng: number,
  objLat: number,
  objLng: number
): { lat: number; lng: number; usedLatLngSwap: boolean } {
  const km = haversineDistanceKm(rawLat, rawLng, objLat, objLng);
  if (km <= ART12_MAX_PLAUSIBLE_COMMUTE_KM) return { lat: rawLat, lng: rawLng, usedLatLngSwap: false };
  const kmSwap = haversineDistanceKm(rawLng, rawLat, objLat, objLng);
  const swapLooksValid =
    kmSwap < km &&
    kmSwap <= ART12_MAX_PLAUSIBLE_COMMUTE_KM &&
    isRoughArgentinaLatLng(rawLng, rawLat) &&
    isRoughArgentinaLatLng(objLat, objLng);
  if (swapLooksValid) return { lat: rawLng, lng: rawLat, usedLatLngSwap: true };
  return { lat: rawLat, lng: rawLng, usedLatLngSwap: false };
}

type ObjectiveGeoEntry = { lat: number; lng: number; name: string; clientName: string };

// ─── HELPERS ──────────────────────────────────────────────────────────────────
type PeriodMode = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';

const clampDayInMonth = (y: number, m: number, d: number) => {
  const last = new Date(y, m + 1, 0).getDate();
  return Math.min(Math.max(1, d), last);
};

const startOfWeekMonday = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay();
  const offset = wd === 0 ? -6 : 1 - wd;
  x.setDate(x.getDate() + offset);
  x.setHours(0, 0, 0, 0);
  return x;
};

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const getPeriodRange = (mode: PeriodMode, y: number, m: number, dayInMonth: number) => {
  const dClamped = clampDayInMonth(y, m, dayInMonth);
  if (mode === 'day') {
    const start = new Date(y, m, dClamped, 0, 0, 0, 0);
    const end = new Date(y, m, dClamped, 23, 59, 59, 999);
    return {
      start,
      end,
      labelShort: `${String(dClamped).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`,
      daysCount: 1,
    };
  }
  if (mode === 'week') {
    const anchor = new Date(y, m, dClamped, 12, 0, 0, 0);
    const mon = startOfWeekMonday(anchor);
    const end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59, 999);
    return {
      start: mon,
      end,
      labelShort: `Sem. ${String(mon.getDate()).padStart(2, '0')}/${String(mon.getMonth() + 1).padStart(2, '0')} – ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}/${end.getFullYear()}`,
      daysCount: 7,
    };
  }
  if (mode === 'month') {
    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return { start, end, labelShort: `${MONTHS_SHORT[m]} ${y}`, daysCount: end.getDate() };
  }
  if (mode === 'quarter') {
    const q = Math.floor(m / 3);
    const start = new Date(y, q * 3, 1, 0, 0, 0, 0);
    const end = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999);
    return { start, end, labelShort: `T${q + 1} ${y}`, daysCount: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 };
  }
  if (mode === 'semester') {
    const s = m < 6 ? 0 : 1;
    const start = new Date(y, s * 6, 1, 0, 0, 0, 0);
    const end = new Date(y, s * 6 + 6, 0, 23, 59, 59, 999);
    return { start, end, labelShort: `S${s + 1} ${y}`, daysCount: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 };
  }
  const start = new Date(y, 0, 1, 0, 0, 0, 0);
  const end = new Date(y, 11, 31, 23, 59, 59, 999);
  return { start, end, labelShort: `Año ${y}`, daysCount: isLeapYear(y) ? 366 : 365 };
};

/** Jornada de referencia 192 hs/mes (viabilidad). El techo de liquidación es 200 (`analisisBolsa`). */

/** Horas SLA del servicio en un rango (motor compartido con Servicios/CRM). */
const calcSrvDateRange = (srv: any, rangeStart: Date, rangeEnd: Date, quotaHsPerGuard = 192) => {
  const hours = calculateSlaHoursForDateRange(
    srv.positions || [],
    srv.startDate,
    srv.endDate,
    srv.excludedDates,
    rangeStart,
    rangeEnd,
  );
  const guards = hours > 0 ? Math.ceil(hours / quotaHsPerGuard) : 0;
  const surplus = guards * quotaHsPerGuard - hours;
  return { hours, guards, surplus: Math.round(surplus) };
};

const calcSrvMonth = (srv: any, y: number, m: number, efectiveHs = 192) => {
  const start = new Date(y, m, 1, 12, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 12, 0, 0, 0);
  return calcSrvDateRange(srv, start, end, efectiveHs);
};

/** Horas programadas de cobertura — mismo criterio que pie «Hs. Plan.» del planificador. */
const shiftDur = (t: any): number => {
  if (!isPlanificadorPlannedHoursShift(t)) return 0;
  if (isProformaVacancyShift(t)) return 0;
  return calcPlanificadorShiftHours(t);
};

const DURATION_WIDGET_EXCLUDED_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

const isDurationWidgetShift = (t: any): boolean => {
  if (String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
  const status = String(t.status || '').toLowerCase();
  if (status.includes('cancel') || status.includes('delet')) return false;
  if (t.isFranco === true) return false;
  const origin = String(t.origin || '').trim().toUpperCase();
  if (origin === 'SLA_VIRTUAL' || origin === 'INTERRUPTION') return false;
  if (isOperationalOriginShift(t)) return false;
  if (isDeploymentOrPoolShift(t)) return true;
  const code = String(t.code || '').trim().toUpperCase();
  if (DURATION_WIDGET_EXCLUDED_CODES.has(code)) return false;
  return true;
};

const resolveDurationWidgetHours = (t: any): number => {
  if (!isDurationWidgetShift(t)) return 0;
  if (isDeploymentOrPoolShift(t)) return resolveDeploymentStatHours(t);
  const planned = calcPlanningScheduledShiftHours(t);
  if (planned > 0) return planned;
  if (t?.startTime?.seconds && t?.endTime?.seconds) {
    return Math.max(0, Math.min((t.endTime.seconds - t.startTime.seconds) / 3600, 24));
  }
  return 0;
};

const codeBadgeClass = (code: string) => {
  if (code === 'M') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
  if (code === 'T') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400';
  if (code === 'N') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400';
  if (code === 'D12') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
  if (code === 'N12') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400';
  if (code === 'REF') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400';
  if (code === 'ESC') return 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400';
  if (code === 'RET') return 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
};

const shortName = (s: string, len = 14) => (s || '').length > len ? (s || '').substring(0, len) + '…' : (s || '');

const formatYmdLocal = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ─── CUSTOM TOOLTIP ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-3 text-xs min-w-[140px]">
      {label && <p className="font-black text-slate-700 dark:text-white mb-2 uppercase">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }}/>
          <span className="text-slate-500 capitalize">{p.name}:</span>
          <span className="font-black text-slate-700 dark:text-white ml-auto pl-3">
            {typeof p.value === 'number' ? p.value.toLocaleString('es-AR') : p.value}{p.unit || ''}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── TREEMAP TILE ─────────────────────────────────────────────────────────────
const TreemapTile = (props: any) => {
  const { x, y, width, height, name, vacPct, size } = props;
  if (!width || !height || width < 4 || height < 4) return null;
  const color = vacPct === 0 ? '#059669' : vacPct <= 10 ? '#10b981' : vacPct <= 25 ? '#d97706' : '#dc2626';
  const showText = width > 55 && height > 36;
  return (
    <g>
      <rect x={x+1} y={y+1} width={width-2} height={height-2} rx={6} ry={6}
        fill={color} fillOpacity={0.85} stroke="white" strokeWidth={2}/>
      {showText && (
        <>
          <text x={x+width/2} y={y+height/2-(height>60?10:4)} textAnchor="middle"
            fill="white" fontSize={Math.min(11, width/8)} fontWeight={700}>
            {shortName(name, Math.max(6, Math.floor(width/8)))}
          </text>
          {height > 55 && (
            <text x={x+width/2} y={y+height/2+10} textAnchor="middle"
              fill="rgba(255,255,255,0.85)" fontSize={9} fontWeight={600}>
              {Math.round(size).toLocaleString('es-AR')} hs · {vacPct}% vac
            </text>
          )}
        </>
      )}
    </g>
  );
};

// ─── DONUT CENTER LABEL ───────────────────────────────────────────────────────
function DonutCenter({ cx, cy, value, label, color = '#4f46e5' }: {
  cx: number; cy: number; value: React.ReactNode; label: string; color?: string;
}) {
  return (
    <>
      <text x={cx} y={cy - 9} textAnchor="middle" fill={color} fontSize={26} fontWeight={900}>{value}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize={9} fontWeight={700}>{label.toUpperCase()}</text>
    </>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, color, label, value, unit, subtext, alert }: {
  icon: React.ElementType; color: string; label: string; value: React.ReactNode;
  unit?: string; subtext?: string; alert?: boolean;
}) {
  return (
    <div className="rounded-xl border px-4 py-3.5 flex items-center gap-3
      ${alert ? 'border-rose-300 dark:border-rose-800 ring-1 ring-rose-200 dark:ring-rose-900' : 'border-slate-100 dark:border-slate-700'}" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
      <div className="p-2 rounded-lg shrink-0" style={{ background: color + '1a' }}>
        <Icon size={14} color={color} strokeWidth={2.5}/>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider leading-tight truncate">{label}</p>
        <p className="text-xl font-black text-slate-800 dark:text-white leading-tight">
          {value}{unit && <span className="text-xs font-bold text-slate-400 ml-0.5">{unit}</span>}
        </p>
        {subtext && <p className="text-[9px] text-slate-400 font-medium leading-tight">{subtext}</p>}
      </div>
    </div>
  );
}

// ─── SECTION CARD ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, loading, children, className = '' }: {
  title: string; icon: React.ElementType; loading?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-700/40 flex items-center justify-between">
        <h3 className="font-black text-xs uppercase text-slate-700 dark:text-white flex gap-2 items-center tracking-wide">
          <Icon size={14}/> {title}
        </h3>
        {loading && <span className="text-[9px] font-bold text-indigo-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin"/> actualizando</span>}
      </div>
      {children}
    </div>
  );
}

// ─── LEGEND ROW ───────────────────────────────────────────────────────────────
function LegendRow({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 px-5 pt-4 pb-1">
      {items.map(l => (
        <div key={l.label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.color }}/>
          <span className="text-[10px] font-bold text-slate-500">{l.label}</span>
        </div>
      ))}
    </div>
  );
}

type AnalisisTab =
  | 'informe'
  | 'capacidad'
  | 'guardias'
  | 'cobertura'
  | 'demanda'
  | 'financiera'
  | 'proyeccion'
  | 'viabilidad'
  | 'art12'
  | 'analitica';
type InformeChartKind = 'area' | 'line';
type AnalDimension = 'employee' | 'objective' | 'client' | 'code' | 'status' | 'date';
type AnalMetric = 'hours' | 'shifts' | 'presence' | 'absence' | 'night';
type AnalChartKind = 'bar' | 'pie' | 'area';
type DeploymentKind = 'RET' | 'REF' | 'ESC';
type ExpandedDuration = number | 'all' | null;
type FinMode = FinHoursMode;

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function AnalisisPage() {
  useAuth();
  const { empresaId, empresa, loadingEmpresa } = useEmpresa();
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const now = new Date();
  const [periodMode, setPeriodMode] = useState('month' as PeriodMode);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth());
  const [periodDay, setPeriodDay] = useState(now.getDate());
  const [activeTab,      setActiveTab]      = usePersistedState('cosp:analisis:tab', 'informe' as AnalisisTab);
  const [valorHoraBasica, setValorHoraBasica] = usePersistedState('cosp:analisis:valorHora', 0);
  const [vialSrvId,      setVialSrvId]      = useState('');
  const efectiveHours = CCT_HS_MENSUAL;
  const [expandedObjId,    setExpandedObjId]    = useState(null as string | null);
  const [expandedDemandaId, setExpandedDemandaId] = useState(null as string | null);
  const [informeChartType, setInformeChartType] = useState('area' as InformeChartKind);
  const [expandedDuration, setExpandedDuration] = useState(null as ExpandedDuration);
  const [expandedDurationCode, setExpandedDurationCode] = useState(null as string | null);
  const [finHoursMode, setFinHoursMode] = usePersistedState('cosp:analisis:finMode', 'planned' as FinMode);
  const [expandedFinClientId, setExpandedFinClientId] = useState(null as string | null);
  const [expandedFinObjId, setExpandedFinObjId] = useState(null as string | null);
  const [showAusentismo,   setShowAusentismo]   = useState(false);

  const [analDateFrom,   setAnalDateFrom]   = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); });
  const [analDateTo,     setAnalDateTo]     = useState(() => new Date().toISOString().slice(0,10));
  const [analClientId,   setAnalClientId]   = useState('');
  const [analObjectiveId,setAnalObjectiveId]= useState('');
  const [analEmployeeId, setAnalEmployeeId] = useState('');
  const [analStatus,     setAnalStatus]     = useState('');
  const [analDimension,  setAnalDimension]  = useState('employee' as AnalDimension);
  const [analMetric,     setAnalMetric]     = useState('hours' as AnalMetric);
  const [analChartType,  setAnalChartType]  = useState('bar' as AnalChartKind);

  const periodRange = useMemo(
    () => getPeriodRange(periodMode, periodYear, periodMonth, periodDay),
    [periodMode, periodYear, periodMonth, periodDay]
  );

  const {
    services,
    employees,
    employeeNameById,
    turnos,
    ausencias,
    allTurnos,
    allAusencias,
    tiposNovedad,
    objectivesGeoById,
    extractRows,
    extractReady,
    mallaReady,
    loadInit,
    loadFacts,
    loadError,
    loadProgress,
    factsAt,
    ensureRange,
    reloadAll,
    isRangeCovered,
  } = useAnalisisSnapshot({
    empresaId,
    loadingEmpresa,
    scopeEmpresa,
    migracionCompleta,
    periodStart: periodRange.start,
    periodEnd: periodRange.end,
  });
  const loadTurnos = loadFacts;
  const loadAus = loadFacts;

  const periodKey = `${periodMode}:${periodRange.start.getTime()}:${periodRange.end.getTime()}`;

  const slaDemandDaysInPeriod = useMemo(
    () => countSlaDemandDaysInRange(services, periodRange.start, periodRange.end),
    [services, periodKey]
  );

  const capHsPerGuardPeriod = useMemo(
    () => cctBolsaHsPerGuard(periodMode, periodRange.daysCount),
    [periodMode, periodRange.daysCount],
  );

  const guardQuotaHs = capHsPerGuardPeriod;

  const shiftPeriod = (dir: -1 | 1) => {
    if (periodMode === 'day') {
      const cur = new Date(periodYear, periodMonth, periodDay);
      cur.setDate(cur.getDate() + dir);
      setPeriodYear(cur.getFullYear());
      setPeriodMonth(cur.getMonth());
      setPeriodDay(cur.getDate());
    } else if (periodMode === 'week') {
      const cur = new Date(periodYear, periodMonth, periodDay);
      cur.setDate(cur.getDate() + 7 * dir);
      setPeriodYear(cur.getFullYear());
      setPeriodMonth(cur.getMonth());
      setPeriodDay(cur.getDate());
    } else if (periodMode === 'month') {
      const nm = periodMonth + dir;
      const ny = periodYear + Math.floor(nm / 12);
      const mm = ((nm % 12) + 12) % 12;
      const lastD = new Date(ny, mm + 1, 0).getDate();
      setPeriodYear(ny);
      setPeriodMonth(mm);
      setPeriodDay((d) => Math.min(d, lastD));
    } else if (periodMode === 'quarter') {
      const nm = periodMonth + dir * 3;
      const ny = periodYear + Math.floor(nm / 12);
      const mm = ((nm % 12) + 12) % 12;
      const lastD = new Date(ny, mm + 1, 0).getDate();
      setPeriodYear(ny);
      setPeriodMonth(mm);
      setPeriodDay((d) => Math.min(d, lastD));
    } else if (periodMode === 'semester') {
      const nm = periodMonth + dir * 6;
      const ny = periodYear + Math.floor(nm / 12);
      const mm = ((nm % 12) + 12) % 12;
      const lastD = new Date(ny, mm + 1, 0).getDate();
      setPeriodYear(ny);
      setPeriodMonth(mm);
      setPeriodDay((d) => Math.min(d, lastD));
    } else {
      setPeriodYear((y) => y + dir);
    }
  };

  const setPeriodModeSafe = (mode: PeriodMode) => {
    setPeriodMode(mode);
    if (mode === 'year') {
      setPeriodMonth(0);
      setPeriodDay(1);
    }
  };

  // ── Ausentismo configurable ───────────────────────────────────────────────────
  const [ausVac,   setAusVac]   = useState(5);   // vacaciones anuales prorrateadas
  const [ausEnf,   setAusEnf]   = useState(5);   // enfermedad / certificados
  const [ausArt,   setAusArt]   = useState(2);   // accidentes ART
  const [ausAus,   setAusAus]   = useState(3);   // ausencias injustificadas
  const [ausOtros, setAusOtros] = useState(1);   // licencias especiales / otros
  const [aplicarAusentismo, setAplicarAusentismo] = useState(false);
  const ausentismoTotal = Math.round((ausVac + ausEnf + ausArt + ausAus + ausOtros) * 10) / 10;
  const hsRealesGuardia = Math.round(capHsPerGuardPeriod * (1 - ausentismoTotal / 100));

  const analRangeStart = useMemo(() => new Date(analDateFrom + 'T00:00:00'), [analDateFrom]);
  const analRangeEnd = useMemo(() => new Date(analDateTo + 'T23:59:59'), [analDateTo]);
  const analLoaded = isRangeCovered(analRangeStart, analRangeEnd);
  const loadAnal = loadFacts && !analLoaded;
  const analRawTurnos = useMemo(
    () => (analLoaded ? filterTurnosInRange(allTurnos, analRangeStart, analRangeEnd) : []),
    [analLoaded, allTurnos, analRangeStart, analRangeEnd],
  );

  const loadAnalytics = async (dateFromOverride?: string, dateToOverride?: string) => {
    const dFrom = dateFromOverride ?? analDateFrom;
    const dTo = dateToOverride ?? analDateTo;
    const start = new Date(dFrom + 'T00:00:00');
    const end = new Date(dTo + 'T23:59:59');
    await ensureRange(start, end);
  };

  // ── Mapas globales ID → nombre (empleados, objetivos, clientes) ────────────────
  const empNameById = useMemo(() => {
    const m: Record<string, string> = { ...employeeNameById };
    employees.forEach((e: any) => {
      const name = e.lastName ? `${e.lastName}, ${e.firstName || ''}`.trim() : (e.name || '');
      if (!name) return;
      if (e.id) m[e.id] = m[e.id] || name;
    });
    return m;
  }, [employees, employeeNameById]);

  const objectiveNameById = useMemo(() => {
    const m: Record<string, string> = {};
    services.forEach((s: any) => {
      if (s.objectiveId) m[String(s.objectiveId)] = s.objectiveName || String(s.objectiveId);
    });
    Object.entries(objectivesGeoById).forEach(([k, v]) => {
      if (v?.name) m[k] = m[k] || v.name;
    });
    return m;
  }, [services, objectivesGeoById]);

  const clientNameById = useMemo(() => {
    const m: Record<string, string> = {};
    services.forEach((s: any) => {
      if (s.clientId) m[String(s.clientId)] = s.clientName || String(s.clientId);
    });
    return m;
  }, [services]);

  // ── Analítica: computar datos agregados según filtros y dimensión ─────────────
  const analData = useMemo(() => {
    if (!analRawTurnos.length) return { data: [] as { name: string; value: number }[], totalValue: 0, totalGroups: 0 };

    const filtered = analRawTurnos.filter((t: any) => {
      // Excluir vacantes virtuales generadas por operaciones (no son planificación real).
      const origin = String(t.origin || '').trim().toUpperCase();
      if (origin === 'SLA_VIRTUAL' || origin === 'INTERRUPTION') return false;
      // Para métricas de turnos/horas solo cuentan turnos de COBERTURA real (no franco, licencia, retén).
      // Para 'absence' se permite contar ausencias formales.
      if (analMetric !== 'absence' && !isCoverageShift(t)) return false;
      if (analClientId   && t.clientId    !== analClientId)   return false;
      if (analObjectiveId&& t.objectiveId !== analObjectiveId) return false;
      if (analEmployeeId && t.employeeId  !== analEmployeeId)  return false;
      if (analStatus) {
        const st = (t.status || '').toUpperCase();
        if (analStatus === 'PRESENT'   && st !== 'PRESENT'   && !t.isPresent)  return false;
        if (analStatus === 'COMPLETED' && st !== 'COMPLETED' && !t.isCompleted) return false;
        if (analStatus === 'ABSENT'    && st !== 'ABSENT'    && !t.isAbsent)   return false;
        if (analStatus === 'PENDING'   && st !== 'PENDING'   && st !== '')      return false;
      }
      return true;
    });

    const getDimKey = (t: any): string => {
      if (analDimension === 'employee') {
        const eid = String(t.employeeId || '').trim();
        if (!eid || eid === 'VACANTE') return 'VACANTE';
        return empNameById[eid] || t.employeeName || eid || 'Sin nombre';
      }
      if (analDimension === 'objective') {
        const oid = String(t.objectiveId || '').trim();
        return objectiveNameById[oid] || t.objectiveName || 'Sin objetivo';
      }
      if (analDimension === 'client') {
        const cid = String(t.clientId || '').trim();
        return clientNameById[cid] || t.clientName || cid || 'Sin cliente';
      }
      if (analDimension === 'code')      return t.shiftCode     || t.code        || 'Sin código';
      if (analDimension === 'status') {
        const st = (t.status || '').toUpperCase();
        if (t.isPresent  || st === 'PRESENT')   return 'Presente';
        if (t.isCompleted|| st === 'COMPLETED') return 'Completado';
        if (t.isAbsent   || st === 'ABSENT')    return 'Ausente';
        return 'Pendiente';
      }
      if (analDimension === 'date') {
        if (!t.startTime?.seconds) return 'Sin fecha';
        const d = new Date(t.startTime.seconds * 1000);
        return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
      }
      return 'Otro';
    };

    const getMetric = (t: any): number => {
      if (analMetric === 'shifts') return 1;
      if (analMetric === 'hours') return shiftDur(t);
      if (analMetric === 'presence') {
        const st = (t.status || '').toUpperCase();
        return (t.isPresent || st === 'PRESENT' || t.isCompleted || st === 'COMPLETED') ? 1 : 0;
      }
      if (analMetric === 'absence') {
        const st = (t.status || '').toUpperCase();
        return (t.isAbsent || st === 'ABSENT') ? 1 : 0;
      }
      if (analMetric === 'night') {
        if (!t.startTime?.seconds) return 0;
        const h = new Date(t.startTime.seconds * 1000).getHours();
        const dur = shiftDur(t);
        return (h >= 21 || h < 6) ? dur : 0;
      }
      return 0;
    };

    const agg: Record<string, number> = {};
    filtered.forEach(t => {
      const key = getDimKey(t);
      agg[key] = (agg[key] || 0) + getMetric(t);
    });

    const sorted = Object.entries(agg)
      .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
      .sort((a, b) => b.value - a.value);

    const totalValue = sorted.reduce((s, d) => s + d.value, 0);
    const totalGroups = sorted.length;
    const data = sorted.slice(0, 30);

    return { data, totalValue: Math.round(totalValue * 10) / 10, totalGroups };
  }, [analRawTurnos, analClientId, analObjectiveId, analEmployeeId, analStatus, analDimension, analMetric, empNameById, objectiveNameById, clientNameById]);

  // ── Analítica: clientes/objetivos únicos del rango cargado ───────────────────
  const analClientOptions = useMemo(() => {
    const map: Record<string, string> = {};
    analRawTurnos.forEach((t: any) => {
      if (!t.clientId) return;
      const cid = String(t.clientId);
      map[cid] = clientNameById[cid] || t.clientName || cid;
    });
    return Object.entries(map).sort((a,b) => a[1].localeCompare(b[1]));
  }, [analRawTurnos, clientNameById]);

  const analObjectiveOptions = useMemo(() => {
    const map: Record<string, string> = {};
    analRawTurnos.forEach((t: any) => {
      if (!t.objectiveId) return;
      if (analClientId && t.clientId !== analClientId) return;
      const oid = String(t.objectiveId);
      map[oid] = objectiveNameById[oid] || t.objectiveName || 'Sin objetivo';
    });
    return Object.entries(map).sort((a,b) => a[1].localeCompare(b[1]));
  }, [analRawTurnos, analClientId, objectiveNameById]);

  // ── Tasas reales de ausentismo desde colección ausencias ─────────────────────
  const ausenciasStats = useMemo(
    () =>
      buildAusenciasStats({
        ausencias,
        turnos,
        employees,
        periodStart: new Date(periodRange.start),
        periodEnd: new Date(periodRange.end),
        capHsPerGuardPeriod,
        tiposNovedad,
      }),
    [ausencias, turnos, employees, capHsPerGuardPeriod, tiposNovedad, periodKey],
  );

  const seededAbsRatesForPeriod = useRef(null as string | null);
  useEffect(() => {
    if (!ausenciasStats || loadFacts) return;
    if (seededAbsRatesForPeriod.current === periodKey) return;
    seededAbsRatesForPeriod.current = periodKey;
    setAusVac(ausenciasStats.vacPct);
    setAusEnf(ausenciasStats.enfPct);
    setAusArt(ausenciasStats.artPct);
    setAusAus(ausenciasStats.injPct);
    setAusOtros(ausenciasStats.otrosPct);
  }, [ausenciasStats, loadFacts, periodKey]);

  const objectiveAliasesFromServices = useMemo(() => {
    const aliases: Record<string, { canonicalId: string; name: string; clientId?: string }> = {};
    const register = (
      meta: { canonicalId: string; name: string; clientId?: string },
      key: string,
    ) => {
      const k = String(key || '').trim();
      if (k) aliases[k] = meta;
    };
    for (const srv of services) {
      const cid = String(srv.clientId ?? '').trim();
      const oid = String(srv.objectiveId ?? '').trim();
      const name = String(srv.objectiveName ?? oid).trim();
      const canonicalId = oid || name;
      if (!canonicalId) continue;
      const meta = { canonicalId, name, clientId: cid };
      register(meta, canonicalId);
      if (oid) register(meta, oid);
      if (name) register(meta, name);
      if (cid && name) register(meta, `${cid}_${name}`);
    }
    return aliases;
  }, [services]);

  const vigenteServices = useMemo(
    () => pickVigenteSlasForPeriod(services, new Date(periodRange.start), new Date(periodRange.end)),
    [services, periodKey],
  );

  const universo = useMemo(
    () =>
      buildAnalisisUniverso({
        vigenteServices,
        employees,
        periodStart: new Date(periodRange.start),
        periodEnd: new Date(periodRange.end),
      }),
    [vigenteServices, employees, periodKey],
  );

  const slaExclusionCtx = useMemo(
    () => buildSlaExclusionContext(services, new Date(periodRange.start), new Date(periodRange.end)),
    [services, periodKey],
  );

  // ── Theoretical ──────────────────────────────────────────────────────────────
  /**
   * Día/semana: TURNOS = ⌈hs / hsTurno⌉ y GUARDIAS = ⌈hs/día / hsTurno⌉ ≈ guardias en simultáneo en el día pico operativo.
   * Mes/año: GUARDIAS = ⌈hs / hsMensualesGuardia (FTE CCT)⌉.
   */
  const theoretical = useMemo(() => {
    const rs = new Date(periodRange.start);
    const re = new Date(periodRange.end);
    let totalHours = 0;
    const active: any[] = [];
    vigenteServices.forEach(srv => {
      if (!srv.startDate || !srv.endDate) return;
      const hours = slaHoursForServiceInRange(srv, rs, re);
      if (hours === 0) return;
      totalHours += hours;
      active.push({ ...srv, monthHours: hours, guardsNeeded: universo.picoSimultaneo, surplusHs: 0 });
    });

    const demandDays = Math.max(1, universo.demandDays || slaDemandDaysInPeriod || periodRange.daysCount || 1);
    return {
      totalHours,
      totalGuards: universo.picoSimultaneo,
      totalSurplus: Math.max(0, Math.round(employees.length * capHsPerGuardPeriod - totalHours)),
      totalShifts: universo.slotsPeriodo,
      shiftsPerDay: demandDays > 0 ? Math.round(universo.slotsPeriodo / demandDays) : 0,
      demandDays,
      active,
    };
  }, [vigenteServices, universo, employees.length, capHsPerGuardPeriod, slaDemandDaysInPeriod, periodRange.daysCount, periodKey]);

  useEffect(() => {
    const rs = new Date(periodRange.start);
    const re = new Date(periodRange.end);
    const activeIds: string[] = [];
    services.forEach((srv: any) => {
      if (!srv.startDate || !srv.endDate) return;
      const hours = slaHoursForServiceInRange(srv, rs, re);
      if (hours > 0) activeIds.push(srv.id);
    });
    if (activeIds.length === 0) {
      if (vialSrvId) setVialSrvId('');
      return;
    }
    if (!vialSrvId || !activeIds.includes(vialSrvId)) setVialSrvId(activeIds[0]);
  }, [services, guardQuotaHs, periodKey, vialSrvId]);

  // ── Actual ───────────────────────────────────────────────────────────────────
  const actual = useMemo(() => {
    const empNameMap = new Map(Object.entries(empNameById));
    const objInfoMap = new Map<string, { name: string; client: string }>();
    vigenteServices.forEach((s: any) => {
      const canonicalId = resolveCanonicalObjectiveId(s, objectiveAliasesFromServices) || String(s.objectiveId ?? '').trim();
      if (!canonicalId) return;
      const info = { name: s.objectiveName || canonicalId, client: s.clientName || 'Sin Cliente' };
      objInfoMap.set(canonicalId, info);
      if (s.objectiveId) objInfoMap.set(String(s.objectiveId), info);
      if (s.objectiveName) objInfoMap.set(String(s.objectiveName), info);
    });
    const byGuard = new Map<string,{name:string;hours:number;shifts:number}>();
    const byObj   = new Map<string,{name:string;client:string;scheduled:number;vacant:number}>();
    type ShiftBd = { schCount:number; vacCount:number; schHours:number; vacHours:number };
    type ObjDet  = { byCode:Map<string,ShiftBd>; guards:Map<string,{name:string;hours:number;shifts:number}> };
    const byObjDetail = new Map<string, ObjDet>();
    type ObjCell = { dur: number; isVacant: boolean; code: string; employeeId: string; empName: string };
    const objCells = new Map<string, Map<string, ObjCell>>();
    const guardCells = new Map<string, ObjCell>();
    let scheduledHours = 0, vacantHours = 0;

    turnos.forEach((t: any) => {
      if (!isPlanificadorPlannedHoursShift(t)) return;
      if (isProformaVacancyShift(t)) return;
      const plannedStart = t.startTime?.seconds ? new Date(t.startTime.seconds * 1000) : null;
      if (!plannedStart) return;
      const scheduleDateKey = getDateKeyInTimezone(plannedStart);
      if (
        isTurnoOnSlaExcludedSlot(t, slaExclusionCtx, {
          scheduleDateKey,
          positionName: String(t.positionName ?? ''),
        })
      ) {
        return;
      }
      const dur = calcPlanificadorShiftHours(t);
      if (dur <= 0) return;
      const code = String(t.code || '').trim().toUpperCase() || '—';
      const empNameU = String(t.employeeName || '').trim().toUpperCase();
      const isVacant =
        !t.employeeId ||
        t.employeeId === 'VACANTE' ||
        empNameU === 'VACANTE' ||
        empNameU.startsWith('VACANTE:') ||
        !!t.isUnassigned;
      const empId = String(t.employeeId || 'unknown');
      const empName = empNameMap.get(t.employeeId) || t.employeeName || empId;
      const dateKey = getDateKeyInTimezone(plannedStart);
      const cellKey = `${empId}_${dateKey}`;
      const ok = resolveCanonicalObjectiveId(t, objectiveAliasesFromServices)
        || String(t.objectiveId ?? '').trim()
        || 'SIN_OBJETIVO';
      const cell: ObjCell = { dur, isVacant, code, employeeId: empId, empName };
      const perObj = objCells.get(ok) || new Map<string, ObjCell>();
      perObj.set(cellKey, cell);
      objCells.set(ok, perObj);
      guardCells.set(cellKey, cell);
    });

    objCells.forEach((cells, ok) => {
      const objInfo = objInfoMap.get(ok) || { name: ok, client: 'Sin Cliente' };
      const det = byObjDetail.get(ok) || { byCode: new Map<string, ShiftBd>(), guards: new Map<string,{name:string;hours:number;shifts:number}>() };
      cells.forEach(({ dur, isVacant, code, employeeId, empName }) => {
        if (!isVacant) scheduledHours += dur;
        else vacantHours += dur;
        const o = byObj.get(ok) || { name: objInfo.name, client: objInfo.client, scheduled: 0, vacant: 0 };
        byObj.set(ok, { ...o, scheduled: o.scheduled + (isVacant ? 0 : dur), vacant: o.vacant + (isVacant ? dur : 0) });
        const bd = det.byCode.get(code) || { schCount: 0, vacCount: 0, schHours: 0, vacHours: 0 };
        if (isVacant) { bd.vacCount++; bd.vacHours += dur; }
        else { bd.schCount++; bd.schHours += dur; }
        det.byCode.set(code, bd);
        if (!isVacant && employeeId && employeeId !== 'unknown') {
          const gd = det.guards.get(employeeId) || { name: empName, hours: 0, shifts: 0 };
          det.guards.set(employeeId, { name: gd.name, hours: gd.hours + dur, shifts: gd.shifts + 1 });
        }
      });
      byObjDetail.set(ok, det);
    });

    guardCells.forEach(({ dur, isVacant, employeeId, empName }) => {
      if (isVacant || !employeeId || employeeId === 'unknown') return;
      const g = byGuard.get(employeeId) || { name: empName, hours: 0, shifts: 0 };
      byGuard.set(employeeId, { ...g, hours: g.hours + dur, shifts: g.shifts + 1 });
    });

    const workedDays = new Set<string>();
    turnos.forEach((t: any) => {
      if (isVacantShift(t) || !isRegularLiquidationWorkShift(t)) return;
      const eid = String(t.employeeId || '').trim();
      const ms = shiftStartMs(t);
      if (!eid || eid === 'VACANTE' || ms == null) return;
      workedDays.add(`${eid}_${getDateKeyInTimezone(new Date(ms))}`);
    });
    turnos.forEach((t: any) => {
      if (!isDeploymentOrPoolShift(t) || isVacantShift(t)) return;
      const eid = String(t.employeeId || '').trim();
      const ms = shiftStartMs(t);
      if (!eid || eid === 'VACANTE' || ms == null) return;
      const kind = deploymentStatKind(t);
      if (kind === 'RET' && workedDays.has(`${eid}_${getDateKeyInTimezone(new Date(ms))}`)) return;
      const hs = resolveDeploymentStatHours(t);
      if (hs <= 0) return;
      const empName = empNameMap.get(eid) || t.employeeName || eid;
      const g = byGuard.get(eid) || { name: empName, hours: 0, shifts: 0 };
      byGuard.set(eid, { name: g.name, hours: g.hours + hs, shifts: g.shifts + 1 });
    });

    return {
      byGuard: [...byGuard.entries()].map(([id,d]) => ({ id,...d })).sort((a,b) => b.hours-a.hours),
      byObjective: [...byObj.entries()].map(([id,d]) => ({ id,...d })).sort((a,b) => (b.scheduled+b.vacant)-(a.scheduled+a.vacant)),
      byObjDetail,
      scheduledHours: Math.round(scheduledHours),
      vacantHours: Math.round(vacantHours),
    };
  }, [turnos, employees, empNameById, vigenteServices, objectiveAliasesFromServices, slaExclusionCtx]);

  const demanda = useMemo(
    () => {
      if (mallaReady) {
        return buildDemandaByObjective({
          turnos,
          ausenciasStats,
          vigenteServices,
          periodStart: new Date(periodRange.start),
          periodEnd: new Date(periodRange.end),
          objectiveAliases: objectiveAliasesFromServices,
          slaExclusionCtx,
        });
      }
      if (extractReady) return demandaFromHoursBalances(extractRows);
      return buildDemandaByObjective({
        turnos,
        ausenciasStats,
        vigenteServices,
        periodStart: new Date(periodRange.start),
        periodEnd: new Date(periodRange.end),
        objectiveAliases: objectiveAliasesFromServices,
        slaExclusionCtx,
      });
    },
    [mallaReady, extractReady, extractRows, turnos, ausenciasStats, vigenteServices, objectiveAliasesFromServices, slaExclusionCtx, periodKey],
  );

  const finBases = useMemo(
    () => {
      if (mallaReady) {
        return buildAnalisisFinanciera({
          turnos,
          ausenciasStats,
          vigenteServices,
          periodStart: new Date(periodRange.start),
          periodEnd: new Date(periodRange.end),
          objectiveAliases: objectiveAliasesFromServices,
          slaExclusionCtx,
          turnosHistorial: allTurnos,
          employees,
          employeeNameById: empNameById,
        });
      }
      if (extractReady) return financieraFromHoursBalances(extractRows, ausenciasStats);
      return buildAnalisisFinanciera({
        turnos,
        ausenciasStats,
        vigenteServices,
        periodStart: new Date(periodRange.start),
        periodEnd: new Date(periodRange.end),
        objectiveAliases: objectiveAliasesFromServices,
        slaExclusionCtx,
        turnosHistorial: allTurnos,
        employees,
        employeeNameById: empNameById,
      });
    },
    [mallaReady, extractReady, extractRows, turnos, ausenciasStats, vigenteServices, objectiveAliasesFromServices, slaExclusionCtx, periodKey, allTurnos, employees, empNameById],
  );
  const fin = useMemo(() => rollAnalisisFinanciera(finBases, finHoursMode), [finBases, finHoursMode]);
  const extractPersistKey = useRef('');
  useEffect(() => {
    if (!mallaReady || !empresaId || !vigenteServices.length || !allTurnos.length) return;
    if (extractPersistKey.current === periodKey) return;
    extractPersistKey.current = periodKey;
    const months: Array<{ year: number; month: number }> = [];
    const start = new Date(periodRange.start);
    const end = new Date(periodRange.end);
    let y = start.getFullYear();
    let m = start.getMonth();
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
      months.push({ year: y, month: m + 1 });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    void persistHoursBalancesFromTurnos({
      empresaId,
      services: vigenteServices,
      turnos: allTurnos,
      months,
      rebuiltFrom: 'crm-bootstrap',
    }).catch((err) => console.warn('[analisis] hours_balances', err));
  }, [mallaReady, empresaId, vigenteServices, allTurnos, periodKey, periodRange.start, periodRange.end]);
  const finClientBars = useMemo(
    () =>
      topNPlusResto(
        fin.clients.map((c) => ({
          name: c.name.length > 14 ? `${c.name.slice(0, 14)}…` : c.name,
          SLA: Math.round(c.slaHours),
          Consumo: Math.round(c.hsConsumo),
          Novedades: Math.round(c.novedades.total),
          FT: Math.round(c.hsFt),
          'F/RET': Math.round(finIdleHours(c)),
        })),
        ['SLA', 'Consumo', 'Novedades', 'FT', 'F/RET'],
        10,
        'name',
      ),
    [fin.clients],
  );

  const demandaStackBars = useMemo(
    () =>
      demanda.rows.slice(0, 16).map((r) => ({
        name: r.name.length > 13 ? `${r.name.slice(0, 13)}…` : r.name,
        Plan: Math.round(r.planHours),
        'Ext+Adel': Math.round(r.extHours + r.adelHours),
        FT: Math.round(r.ftHours),
        Vacante: Math.round(r.vacantHours),
        Ausencia: Math.round(r.absenceHours),
      })),
    [demanda.rows],
  );

  const demandaCompareBars = useMemo(
    () =>
      topNPlusResto(
        demanda.rows.map((r) => ({
          name: r.name.length > 13 ? `${r.name.slice(0, 13)}…` : r.name,
          SLA: Math.round(r.slaHours),
          Plan: Math.round(r.planHours),
          Resultante: Math.round(r.resultante),
        })),
        ['SLA', 'Plan', 'Resultante'],
        12,
        'name',
      ),
    [demanda.rows],
  );

  const demandaExtrasDonut = useMemo(() => {
    const t = demanda.totals;
    return [
      { name: 'Franco trabajado', value: Math.round(t.ftHours * 10) / 10, color: '#ea580c' },
      { name: 'Extensiones', value: Math.round(t.extHours * 10) / 10, color: '#7c3aed' },
      { name: 'Adelantos', value: Math.round(t.adelHours * 10) / 10, color: '#0891b2' },
      { name: 'Cobertura ops', value: Math.round(t.opsHours * 10) / 10, color: '#059669' },
    ].filter((d) => d.value > 0);
  }, [demanda.totals]);

  const lookback3m = useMemo(() => threeMonthLookback(periodRange.start), [periodKey]);
  const turnosLookback = useMemo(
    () => filterTurnosInRange(allTurnos, lookback3m.start, lookback3m.end),
    [allTurnos, lookback3m.start, lookback3m.end],
  );
  const bolsaRealista = useMemo(
    () =>
      buildBolsaRealista({
        employees,
        ausencias: allAusencias,
        turnosLookback,
        periodMode,
        periodDays: periodRange.daysCount,
        periodStart: periodRange.start,
        tiposNovedad,
      }),
    [employees, allAusencias, turnosLookback, periodMode, periodRange.daysCount, periodKey, tiposNovedad],
  );

  const informe = useMemo(
    () =>
      buildInformeAnalitico({
        plantel: employees.length,
        capHsPerGuardPeriod,
        demandaTotals: demanda.totals,
        ausenciasStats,
        turnos,
        bolsa: {
          inicial: bolsaRealista.bolsaInicial,
          techo: bolsaRealista.techoBruto,
          indicePct: bolsaRealista.indicePct,
          hsEfectivasGuardia: bolsaRealista.hsEfectivasGuardia,
          lookbackLabel: bolsaRealista.lookback.label,
          tieneHistorial: bolsaRealista.tieneHistorial,
          modo: bolsaRealista.modo,
        },
      }),
    [employees.length, capHsPerGuardPeriod, demanda.totals, ausenciasStats, turnos, bolsaRealista],
  );
  const costoEstimado = useMemo(
    () => estimarCostoInforme(informe, Number(valorHoraBasica) || 0),
    [informe, valorHoraBasica],
  );

  const informeSeriesMeta = useMemo(() => {
    const bucket = chooseInformeSeriesBucket(periodRange.daysCount);
    const buckets = iterateInformeBuckets(periodRange.start, periodRange.end, bucket);
    return { bucket, buckets };
  }, [periodKey, periodRange.daysCount, periodRange.start, periodRange.end]);

  const informeSeries = useMemo(() => {
    const slaByKey: Record<string, number> = {};
    if (informeSeriesMeta.bucket !== 'hour') {
      informeSeriesMeta.buckets.forEach((b) => {
        slaByKey[b.key] = vigenteServices.reduce(
          (sum, srv) => sum + slaHoursForServiceInRange(srv, b.start, b.end),
          0,
        );
      });
    }
    return buildInformeSeries({
      turnos,
      buckets: informeSeriesMeta.buckets,
      bucket: informeSeriesMeta.bucket,
      slaByKey,
      hoursOf: (t) => calcPlanificadorShiftHours(t),
      extraHoursOf: (t) => shiftCoverageExtensionExtraHours(t),
      isPlannedCoverage: (t) => isPlanificadorPlannedHoursShift(t) && !isProformaVacancyShift(t),
    });
  }, [turnos, vigenteServices, informeSeriesMeta]);

  const shiftDurationBreakdown = useMemo(() => {
    type CodeAcc = { count: number; vacant: number; hours: number; coverageCount: number; coverageHours: number };
    type ObjAcc = { id: string; name: string; client: string; byCode: Map<string, CodeAcc> };
    type DurAcc = {
      count: number;
      vacant: number;
      hours: number;
      coverageHours: number;
      codes: Set<string>;
      byCode: Map<string, CodeAcc>;
      byObjective: Map<string, ObjAcc>;
    };

    const objInfoMap = new Map(services.map((s: any) => [
      s.objectiveId,
      { name: s.objectiveName || 'Sin objetivo', client: s.clientName || 'Sin Cliente' },
    ]));
    const byDur = new Map<number, DurAcc>();

    const touchCode = (map: Map<string, CodeAcc>, code: string, isVacant: boolean, hrs: number, isCoverage: boolean) => {
      const row = map.get(code) || { count: 0, vacant: 0, hours: 0, coverageCount: 0, coverageHours: 0 };
      row.count += 1;
      if (isVacant) row.vacant += 1;
      row.hours += hrs;
      if (isCoverage) {
        row.coverageCount += 1;
        row.coverageHours += hrs;
      }
      map.set(code, row);
    };

    turnos.forEach((t: any) => {
      if (!isDurationWidgetShift(t)) return;
      const code = String(t.code || '').trim().toUpperCase() || '—';
      const dur = resolveDurationWidgetHours(t);
      let bucketDur = dur;
      if (bucketDur <= 0 && code === 'RET') bucketDur = 8;
      if (bucketDur <= 0) return;
      const isCoverage =
        isPlanningScheduledCoverageShift(t) &&
        shiftCountsForEmployeeCronoHours(t) &&
        dur > 0;
      const empNameU = String(t.employeeName || '').trim().toUpperCase();
      const isVacant =
        !t.employeeId ||
        t.employeeId === 'VACANTE' ||
        empNameU === 'VACANTE' ||
        empNameU.startsWith('VACANTE:') ||
        !!t.isUnassigned;
      const dk = Math.round(bucketDur * 2) / 2;

      const bucket = byDur.get(dk) || {
        count: 0,
        vacant: 0,
        hours: 0,
        coverageHours: 0,
        codes: new Set<string>(),
        byCode: new Map<string, CodeAcc>(),
        byObjective: new Map<string, ObjAcc>(),
      };
      bucket.count += 1;
      if (isVacant) bucket.vacant += 1;
      bucket.hours += dur;
      if (isCoverage) bucket.coverageHours += dur;
      bucket.codes.add(code);
      touchCode(bucket.byCode, code, isVacant, dur, isCoverage);

      const oid = String(t.objectiveId || 'SIN_OBJETIVO');
      const objInfo = objInfoMap.get(t.objectiveId) || {
        name: t.objectiveName || 'Sin objetivo',
        client: t.clientName || 'Sin Cliente',
      };
      const objRow = bucket.byObjective.get(oid) || {
        id: oid,
        name: objInfo.name,
        client: objInfo.client,
        byCode: new Map<string, CodeAcc>(),
      };
      touchCode(objRow.byCode, code, isVacant, dur, isCoverage);
      bucket.byObjective.set(oid, objRow);
      byDur.set(dk, bucket);
    });

    const serializeCodeRows = (map: Map<string, CodeAcc>) =>
      [...map.entries()]
        .map(([code, row]) => ({
          code,
          count: row.count,
          vacant: row.vacant,
          hours: Math.round(row.hours),
          coverageCount: row.coverageCount,
          coverageHours: Math.round(row.coverageHours),
          countsAsCoverage: row.coverageHours > 0,
        }))
        .sort((a, b) => b.hours - a.hours || b.count - a.count);

    return [...byDur.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dur, d]) => ({
        dur,
        count: d.count,
        vacant: d.vacant,
        hours: Math.round(d.hours),
        coverageHours: Math.round(d.coverageHours),
        codes: [...d.codes].sort(),
        codeRows: serializeCodeRows(d.byCode),
        byObjective: [...d.byObjective.values()]
          .map((o) => ({
            ...o,
            codeRows: serializeCodeRows(o.byCode),
            totalHours: Math.round([...o.byCode.values()].reduce((s, r) => s + r.hours, 0)),
          }))
          .sort((a, b) => b.totalHours - a.totalHours),
      }));
  }, [turnos, services]);

  /** RET / REF / ESC — estadística operativa (no suman cobertura SLA ni hs planificadas del objetivo). */
  const deploymentStats = useMemo(() => {
    type Row = { count: number; vacant: number; hours: number };
    const acc: Record<DeploymentKind, Row> = {
      RET: { count: 0, vacant: 0, hours: 0 },
      REF: { count: 0, vacant: 0, hours: 0 },
      ESC: { count: 0, vacant: 0, hours: 0 },
    };
    turnos.forEach((t: any) => {
      if (!isDurationWidgetShift(t)) return;
      const kind = deploymentStatKind(t);
      if (!kind) return;
      const empNameU = String(t.employeeName || '').trim().toUpperCase();
      const isVacant =
        !t.employeeId ||
        t.employeeId === 'VACANTE' ||
        empNameU === 'VACANTE' ||
        empNameU.startsWith('VACANTE:') ||
        !!t.isUnassigned;
      acc[kind].count += 1;
      if (isVacant) acc[kind].vacant += 1;
      acc[kind].hours += resolveDeploymentStatHours(t);
    });
    return acc;
  }, [turnos]);

  const deploymentStatsTotal = deploymentStats.RET.count + deploymentStats.REF.count + deploymentStats.ESC.count;

  const durationDetail = useMemo(() => {
    if (expandedDuration === null) return null;
    if (expandedDuration === 'all') {
      type CodeAcc = { count: number; vacant: number; hours: number; coverageHours: number };
      const merged = new Map<string, CodeAcc>();
      shiftDurationBreakdown.forEach((bucket) => {
        bucket.codeRows.forEach((row) => {
          const prev = merged.get(row.code) || { count: 0, vacant: 0, hours: 0, coverageHours: 0 };
          merged.set(row.code, {
            count: prev.count + row.count,
            vacant: prev.vacant + row.vacant,
            hours: prev.hours + row.hours,
            coverageHours: prev.coverageHours + row.coverageHours,
          });
        });
      });
      const codeRows = [...merged.entries()]
        .map(([code, row]) => ({
          code,
          count: row.count,
          vacant: row.vacant,
          hours: row.hours,
          coverageCount: row.coverageHours > 0 ? row.count - row.vacant : 0,
          coverageHours: row.coverageHours,
          countsAsCoverage: row.coverageHours > 0,
        }))
        .sort((a, b) => b.hours - a.hours || b.count - a.count);
      return {
        label: 'Todos los turnos',
        dur: null as number | null,
        count: shiftDurationBreakdown.reduce((s, d) => s + d.count, 0),
        hours: shiftDurationBreakdown.reduce((s, d) => s + d.hours, 0),
        coverageHours: shiftDurationBreakdown.reduce((s, d) => s + d.coverageHours, 0),
        codeRows,
        byObjective: [] as typeof shiftDurationBreakdown[0]['byObjective'],
      };
    }
    const bucket = shiftDurationBreakdown.find((d) => d.dur === expandedDuration);
    if (!bucket) return null;
    return {
      label: `Turnos de ${bucket.dur}h`,
      dur: bucket.dur,
      count: bucket.count,
      hours: bucket.hours,
      coverageHours: bucket.coverageHours,
      codeRows: bucket.codeRows,
      byObjective: bucket.byObjective,
    };
  }, [expandedDuration, shiftDurationBreakdown]);

  const durationObjectiveRows = useMemo(() => {
    if (!expandedDurationCode) return [];

    if (expandedDuration === 'all') {
      type Merged = { id: string; name: string; client: string; count: number; vacant: number; hours: number };
      const map = new Map<string, Merged>();
      shiftDurationBreakdown.forEach((bucket) => {
        bucket.byObjective.forEach((obj) => {
          const codeRow = obj.codeRows.find((r) => r.code === expandedDurationCode);
          if (!codeRow) return;
          const prev = map.get(obj.id) || {
            id: obj.id,
            name: obj.name,
            client: obj.client,
            count: 0,
            vacant: 0,
            hours: 0,
          };
          map.set(obj.id, {
            ...prev,
            count: prev.count + codeRow.count,
            vacant: prev.vacant + codeRow.vacant,
            hours: prev.hours + codeRow.hours,
          });
        });
      });
      return [...map.values()]
        .filter((o) => o.count > 0)
        .sort((a, b) => b.hours - a.hours)
        .map((o) => ({
          id: o.id,
          name: o.name,
          client: o.client,
          row: {
            code: expandedDurationCode,
            count: o.count,
            vacant: o.vacant,
            hours: o.hours,
            coverageCount: 0,
            coverageHours: 0,
            countsAsCoverage: false,
          },
        }));
    }

    if (!durationDetail) return [];
    return durationDetail.byObjective
      .map((obj) => {
        const row = obj.codeRows.find((r) => r.code === expandedDurationCode);
        if (!row || row.count === 0) return null;
        return { ...obj, row };
      })
      .filter(Boolean) as Array<{
        id: string;
        name: string;
        client: string;
        row: (typeof durationDetail.codeRows)[0];
      }>;
  }, [durationDetail, expandedDuration, expandedDurationCode, shiftDurationBreakdown]);

  const art12Report = useMemo(() => {
    const empById = new Map(employees.map((e: any) => [e.id, e]));
    const resolveObj = (oid: string): ObjectiveGeoEntry | null => {
      const k = String(oid || '').trim();
      if (!k) return null;
      return objectivesGeoById[k] ?? null;
    };

    const pairBest = new Map<
      string,
      {
        empId: string;
        empName: string;
        objectiveId: string;
        objectiveName: string;
        clientName: string;
        km: number;
        usedLatLngSwap: boolean;
      }
    >();

    const assignedEmpIds = new Set<string>();
    const empMissingHomeGeo = new Set<string>();
    const objectiveIdsMissingGeo = new Set<string>();

    turnos.forEach((t: any) => {
      const eid = t.employeeId;
      if (!eid || !t.objectiveId) return;
      const code = String(t.code || '').trim().toUpperCase();
      if (!OPERATIVE_CODES.has(code)) return;
      assignedEmpIds.add(eid);

      const emp = empById.get(eid);
      if (!emp) return;

      const elat = Number(emp.lat);
      const elng = Number(emp.lng);
      if (!Number.isFinite(elat) || !Number.isFinite(elng)) {
        empMissingHomeGeo.add(eid);
        return;
      }

      const oid = String(t.objectiveId).trim();
      const obj = resolveObj(oid);
      if (!obj) {
        objectiveIdsMissingGeo.add(oid);
        return;
      }

      const { lat: elatU, lng: elngU, usedLatLngSwap } = art12EmployeeCoordsForDistance(
        elat,
        elng,
        obj.lat,
        obj.lng
      );
      const km = haversineDistanceKm(elatU, elngU, obj.lat, obj.lng);
      const empName = emp.lastName
        ? `${emp.lastName}, ${emp.firstName || ''}`.trim()
        : String(emp.name || eid);
      const key = `${eid}__${oid}`;
      const prev = pairBest.get(key);
      if (!prev || km > prev.km) {
        pairBest.set(key, {
          empId: eid,
          empName,
          objectiveId: oid,
          objectiveName: obj.name,
          clientName: obj.clientName || t.clientName || '',
          km,
          usedLatLngSwap,
        });
      }
    });

    const rowsRaw = [...pairBest.values()].map((r) => {
      const kmRounded = Math.round(r.km * 10) / 10;
      const distanceReliable = r.km <= ART12_MAX_PLAUSIBLE_COMMUTE_KM;
      const needsCoordReview = !distanceReliable;
      const exceedsArt25Usable = distanceReliable && r.km > ART12_MAX_KM_VIVIENDA;
      const kmSobreUmbral = exceedsArt25Usable ? Math.round((r.km - ART12_MAX_KM_VIVIENDA) * 10) / 10 : 0;
      return {
        ...r,
        kmRounded,
        distanceReliable,
        needsCoordReview,
        exceedsArt25Usable,
        kmSobreUmbral,
      };
    });

    const rankRow = (r: (typeof rowsRaw)[0]) => {
      if (r.exceedsArt25Usable) return 0;
      if (r.needsCoordReview) return 1;
      return 2;
    };
    const rows = rowsRaw.sort((a, b) => {
      const d = rankRow(a) - rankRow(b);
      if (d !== 0) return d;
      return b.km - a.km;
    });

    const guardiasSobreUmbralConfiables = new Set(
      rows.filter((r) => r.exceedsArt25Usable).map((r) => r.empId)
    ).size;

    const empleadosRevisarCoords = new Set(rows.filter((r) => r.needsCoordReview).map((r) => r.empId)).size;

    const porGuardiaMaxKm = new Map<
      string,
      { empName: string; kmRounded: number; kmSobreUmbral: number; objectiveName: string; clientName: string }
    >();
    rows
      .filter((r) => r.exceedsArt25Usable)
      .forEach((r) => {
        const prev = porGuardiaMaxKm.get(r.empId);
        if (!prev || r.kmRounded > prev.kmRounded) {
          porGuardiaMaxKm.set(r.empId, {
            empName: r.empName,
            kmRounded: r.kmRounded,
            kmSobreUmbral: r.kmSobreUmbral,
            objectiveName: r.objectiveName,
            clientName: r.clientName,
          });
        }
      });

    const resumenGuardiasSobre25 = [...porGuardiaMaxKm.values()].sort((a, b) => b.kmRounded - a.kmRounded);

    return {
      rows,
      guardiasSobreUmbralConfiables,
      empleadosRevisarCoords,
      parejasRevisarCoords: rows.filter((r) => r.needsCoordReview).length,
      resumenGuardiasSobre25,
      umbralKm: ART12_MAX_KM_VIVIENDA,
      maxPlausibleKm: ART12_MAX_PLAUSIBLE_COMMUTE_KM,
      parejasAnalizadas: rows.length,
      empleadosConAsignacionOperativa: assignedEmpIds.size,
      empleadosSinDomicilioGeo: empMissingHomeGeo.size,
      objetivosSinGeoEnTurnos: objectiveIdsMissingGeo.size,
    };
  }, [turnos, employees, objectivesGeoById, periodKey]);

  const viabilityReport = useMemo(() => {
    if (!vialSrvId) return null;
    const srv = services.find((s: any) => s.id === vialSrvId);
    if (!srv?.startDate || !srv.endDate) return null;
    const emps = employees.map((e: any) => ({
      id: e.id,
      restriccionesObjetivo: e.restriccionesObjetivo || [],
      restriccionesCliente: e.restriccionesCliente || [],
    }));
    return buildViabilityRangeReport(srv, periodRange.start, periodRange.end, emps, ausencias, turnos);
  }, [services, vialSrvId, employees, ausencias, turnos, periodKey]);

  // ── Viabilidad ajustada por ausentismo (cuando el toggle está activo) ────────
  // Aplica un colchón sobre el pico requerido (sube) y reduce los disponibles
  // por día por la tasa configurada. Recalcula días en déficit y peor brecha.
  const viabilityReportDisplay = useMemo(() => {
    if (!viabilityReport) return null;
    if (!aplicarAusentismo || ausentismoTotal <= 0) return viabilityReport;
    const factor = 1 - ausentismoTotal / 100;
    if (factor <= 0) return viabilityReport;
    const adjustedRows = viabilityReport.rows.map((r: any) => {
      const reqAdj = Math.ceil(r.requiredPax / factor);
      const dispAdj = Math.floor(r.availablePax * factor);
      const gapAdj = reqAdj - dispAdj;
      return { ...r, requiredPax: reqAdj, availablePax: dispAdj, gap: gapAdj };
    });
    const peakRequired = adjustedRows.reduce((m: number, r: any) => Math.max(m, r.requiredPax), 0);
    const deficitRows = adjustedRows.filter((r: any) => r.gap > 0);
    const worstGap = deficitRows.reduce((m: number, r: any) => Math.max(m, r.gap), 0);
    const peakRow = adjustedRows.reduce((acc: any, r: any) => (r.requiredPax > (acc?.requiredPax ?? -1) ? r : acc), null as any);
    const minAvailable = peakRow ? peakRow.availablePax : viabilityReport.minAvailable;
    return {
      ...viabilityReport,
      rows: adjustedRows,
      peakRequired,
      deficitDays: deficitRows.length,
      worstGap,
      minAvailable,
    };
  }, [viabilityReport, aplicarAusentismo, ausentismoTotal]);

  const viabilityBarData = useMemo(() => {
    if (!viabilityReportDisplay) return [];
    return viabilityReportDisplay.rows
      .filter((r) => r.requiredPax > 0)
      .map((r) => ({
        name: r.dayLabel,
        Requeridos: r.requiredPax,
        Disponibles: r.availablePax,
      }));
  }, [viabilityReportDisplay]);

  // ── Plantel vs disponibles ──
  /**
   * Día: cuenta personas (plantel − franco/licencia ese día).
   * Semana: GUARDIAS-DÍA (cada guardia aporta hasta `daysWithDemand`; franco y lic/aus restan días reales).
   * Mes/Año: nómina completa, solo se restan licencias/ausencias que cubren el período (los francos ya están dentro del cupo CCT mensual y NO restan plantel).
   */
  const disponibilidadGuardias = useMemo(() => {
    const plantel = new Set(employees.map((e: any) => e.id));
    const pStart = new Date(periodRange.start);
    const pEnd = new Date(periodRange.end);
    const plantelTotal = employees.length;
    const daysWithDemand = Math.max(1, slaDemandDaysInPeriod || periodRange.daysCount || 1);

    if (periodMode === 'day') {
      const francoIds = new Set<string>();
      const licenciaIds = new Set<string>();
      turnos.forEach((t: any) => {
        const eid = t.employeeId;
        if (!eid || !plantel.has(eid)) return;
        const code = String(t.code || '').trim().toUpperCase();
        if (FRANCO_SHIFT_CODES.has(code) || (t.isFranco === true && !LICENCIA_SHIFT_CODES.has(code))) {
          francoIds.add(eid);
        } else if (LICENCIA_SHIFT_CODES.has(code)) {
          licenciaIds.add(eid);
        }
      });
      ausencias.forEach((a: any) => {
        const eid = a.employeeId;
        if (!eid || !plantel.has(eid)) return;
        if (!ausenciaCuentaNoDisponible(a)) return;
        if (!ausenciaSolapaPeriodo(a, pStart, pEnd)) return;
        licenciaIds.add(eid);
      });
      const unavailable = new Set<string>([...francoIds, ...licenciaIds]);
      return {
        plantelTotal,
        availableEffective: Math.max(0, plantelTotal - unavailable.size),
        unavailableTotal: unavailable.size,
        francoCount: francoIds.size,
        licenciaCount: licenciaIds.size,
        daysWithDemand: 1,
        guardDaysTotal: plantelTotal,
        francoDays: francoIds.size,
        licenciaDays: licenciaIds.size,
        guardDaysAvailable: Math.max(0, plantelTotal - unavailable.size),
        modo: 'persona' as const,
      };
    }

    if (periodMode === 'month' || periodMode === 'quarter' || periodMode === 'semester' || periodMode === 'year') {
      // Nómina completa; solo licencias/ausencias bajan el plantel.
      const francoEmpSet = new Set<string>();
      const licenciaEmpSet = new Set<string>();
      turnos.forEach((t: any) => {
        const eid = t.employeeId;
        if (!eid || !plantel.has(eid)) return;
        const code = String(t.code || '').trim().toUpperCase();
        if (FRANCO_SHIFT_CODES.has(code) || (t.isFranco === true && !LICENCIA_SHIFT_CODES.has(code))) {
          francoEmpSet.add(eid);
        } else if (LICENCIA_SHIFT_CODES.has(code)) {
          licenciaEmpSet.add(eid);
        }
      });
      ausencias.forEach((a: any) => {
        const eid = a.employeeId;
        if (!eid || !plantel.has(eid)) return;
        if (!ausenciaCuentaNoDisponible(a)) return;
        if (!ausenciaSolapaPeriodo(a, pStart, pEnd)) return;
        licenciaEmpSet.add(eid);
      });
      const availableEffective = Math.max(0, plantelTotal - licenciaEmpSet.size);
      return {
        plantelTotal,
        availableEffective,
        unavailableTotal: licenciaEmpSet.size,
        francoCount: francoEmpSet.size,
        licenciaCount: licenciaEmpSet.size,
        daysWithDemand,
        guardDaysTotal: plantelTotal * daysWithDemand,
        francoDays: 0,
        licenciaDays: licenciaEmpSet.size * daysWithDemand,
        guardDaysAvailable: availableEffective * daysWithDemand,
        modo: 'persona-mes' as const,
      };
    }

    // Modo semana: por guardias-día
    const guardDaysTotal = plantelTotal * daysWithDemand;
    let francoDays = 0;
    let licenciaDays = 0;
    const francoEmpSet = new Set<string>();
    const licenciaEmpSet = new Set<string>();

    turnos.forEach((t: any) => {
      const eid = t.employeeId;
      if (!eid || !plantel.has(eid)) return;
      const code = String(t.code || '').trim().toUpperCase();
      if (FRANCO_SHIFT_CODES.has(code) || (t.isFranco === true && !LICENCIA_SHIFT_CODES.has(code))) {
        francoDays++;
        francoEmpSet.add(eid);
      } else if (LICENCIA_SHIFT_CODES.has(code)) {
        licenciaDays++;
        licenciaEmpSet.add(eid);
      }
    });

    ausencias.forEach((a: any) => {
      const eid = a.employeeId;
      if (!eid || !plantel.has(eid)) return;
      if (!ausenciaCuentaNoDisponible(a)) return;
      const sd = parseAbsenceInstant(a.startDate, false);
      const ed = parseAbsenceInstant(a.endDate, true);
      if (!sd || !ed) return;
      const cs = sd < pStart ? pStart : sd;
      const ce = ed > pEnd ? pEnd : ed;
      if (cs > ce) return;
      const days = Math.max(0, Math.round((ce.getTime() - cs.getTime()) / 86400000) + 1);
      const cap = Math.min(days, daysWithDemand);
      licenciaDays += cap;
      if (cap > 0) licenciaEmpSet.add(eid);
    });

    const guardDaysAvailable = Math.max(0, guardDaysTotal - francoDays - licenciaDays);
    const availableEffective = Math.floor(guardDaysAvailable / daysWithDemand);

    return {
      plantelTotal,
      availableEffective,
      unavailableTotal: Math.max(0, plantelTotal - availableEffective),
      francoCount: francoEmpSet.size,
      licenciaCount: licenciaEmpSet.size,
      daysWithDemand,
      guardDaysTotal,
      francoDays,
      licenciaDays,
      guardDaysAvailable,
      modo: 'guardias-dia' as const,
    };
  }, [employees, turnos, ausencias, periodKey, periodMode, slaDemandDaysInPeriod, periodRange.daysCount]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const plantelGuardias    = disponibilidadGuardias.plantelTotal;
  const availableGuards    = disponibilidadGuardias.availableEffective;
  const guardiasNoDispTotal = disponibilidadGuardias.unavailableTotal;
  const guardiasNoDispFranco = disponibilidadGuardias.francoCount;
  const guardiasNoDispLicencia = disponibilidadGuardias.licenciaCount;

  const gap                = theoretical.totalGuards - availableGuards;
  const coveragePct        = theoretical.totalHours > 0 ? Math.round(actual.scheduledHours / theoretical.totalHours * 100) : 0;
  const vacancyPct         = theoretical.totalHours > 0 ? Math.round(actual.vacantHours    / theoretical.totalHours * 100) : 0;

  // ── Ajuste por ausentismo aplicado a "Guardias necesarios" y "Brecha" ────────
  const guardiasAjustados = hsRealesGuardia > 0 ? Math.ceil(theoretical.totalHours / hsRealesGuardia) : 0;
  const brechaAjustada    = guardiasAjustados - availableGuards;
  // Cuando el toggle "Aplicar ausentismo" está activo, los KPIs principales muestran estos valores.
  const totalGuardsDisplay = aplicarAusentismo ? guardiasAjustados : theoretical.totalGuards;
  const gapDisplay         = aplicarAusentismo ? brechaAjustada    : gap;

  // ── Viabilidad global ─────────────────────────────────────────────────────────
  const totalHsDisponibles = availableGuards * capHsPerGuardPeriod;
  const avgHsPerGuardia    = availableGuards > 0 ? Math.round(theoretical.totalHours / availableGuards) : 0;
  const utilizacionPct     =
    capHsPerGuardPeriod > 0 && availableGuards > 0
      ? Math.round((theoretical.totalHours / availableGuards / capHsPerGuardPeriod) * 100)
      : 0;
  const superavitGlobal    = totalHsDisponibles - theoretical.totalHours; // >0 sobran hs, <0 faltan

  // ── Projection ───────────────────────────────────────────────────────────────
  const projection = useMemo(() => {
    const end = new Date(periodRange.end);
    const anchor = new Date(end.getFullYear(), end.getMonth() + 1, 1);
    return [0, 1, 2].map((offset) => {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
      const y = d.getFullYear(), m = d.getMonth();
      let hours = 0, guards = 0, active = 0;
      services.forEach(srv => {
        if (!srv.startDate || !srv.endDate) return;
        const r = calcSrvMonth(srv, y, m, efectiveHours);
        if (r.hours > 0) { hours += r.hours; guards += r.guards; active++; }
      });
      return { label: `${MONTHS_SHORT[m]} ${y}`, monthLabel: MONTHS_SHORT[m], hours, guards, active, gap: guards - availableGuards };
    });
  }, [services, availableGuards, efectiveHours, periodKey]);

  // ── Proyección con ajuste por ausentismo (cuando el toggle está activo) ──────
  const projectionDisplay = useMemo(() => {
    if (!aplicarAusentismo || hsRealesGuardia <= 0) return projection;
    return projection.map(p => {
      const guardsAdj = Math.ceil(p.hours / hsRealesGuardia);
      return { ...p, guards: guardsAdj, gap: guardsAdj - availableGuards };
    });
  }, [projection, aplicarAusentismo, hsRealesGuardia, availableGuards]);

  // ── Chart data ───────────────────────────────────────────────────────────────
  // Capacidad: donut coverage
  const coverageDonut = useMemo(() => {
    const prog  = actual.scheduledHours;
    const vac   = actual.vacantHours;
    const noSrv = Math.max(0, theoretical.totalHours - prog - vac);
    return [
      { name: 'Programadas', value: prog,  color: '#4f46e5' },
      { name: 'Vacantes',    value: vac,   color: '#f59e0b' },
      { name: 'Sin cubrir',  value: noSrv, color: '#e2e8f0' },
    ].filter(d => d.value > 0);
  }, [actual.scheduledHours, actual.vacantHours, theoretical.totalHours]);

  // Capacidad: grouped bars per service
  const capacidadBars = useMemo(() => theoretical.active.map(srv => {
    const obj = actual.byObjective.find(o => o.id === srv.objectiveId);
    return {
      name: shortName(srv.objectiveName||srv.clientName, 13),
      'Teóricas':    srv.monthHours,
      'Programadas': Math.round(obj?.scheduled??0),
      'Vacantes':    Math.round(obj?.vacant??0),
    };
  }), [theoretical.active, actual.byObjective]);

  // Guardias: band donut
  const bandDonut = useMemo(() => [
    { name: 'Con margen (<160h)',    value: actual.byGuard.filter(g=>g.hours<160).length,                     color: '#059669' },
    { name: 'En capacidad (160-200)', value: actual.byGuard.filter(g=>g.hours>=160&&g.hours<=200).length,    color: '#d97706' },
    { name: 'En extras (>200h)',      value: actual.byGuard.filter(g=>g.hours>200).length,                   color: '#dc2626' },
  ].filter(d => d.value > 0), [actual.byGuard]);

  // Guardias: radial utilization (top 10)
  const radialGuards = useMemo(() =>
    actual.byGuard.slice(0, 10).map(g => ({
      name: shortName(g.name, 16),
      pct:  Math.min(Math.round(g.hours/200*100), 150),
      fill: g.hours>200 ? '#dc2626' : g.hours>=160 ? '#d97706' : '#059669',
    })).reverse()
  , [actual.byGuard]);

  // Guardias: horizontal bars
  const guardBars = useMemo(() => actual.byGuard.map(g => ({
    name:  shortName(g.name, 16),
    horas: Math.round(g.hours),
  })), [actual.byGuard]);
  const guardMaxH = useMemo(() => Math.max(220, ...actual.byGuard.map(g=>g.hours))+20, [actual.byGuard]);

  // Cobertura: treemap
  const treemapData = useMemo(() => actual.byObjective.map(obj => ({
    name:   obj.name,
    size:   Math.round(obj.scheduled+obj.vacant),
    vacPct: (obj.scheduled+obj.vacant)>0 ? Math.round(obj.vacant/(obj.scheduled+obj.vacant)*100) : 0,
  })).filter(d => d.size > 0), [actual.byObjective]);

  // Cobertura: stacked bars
  const coberturaBars = useMemo(() => actual.byObjective.slice(0,20).map(obj => ({
    name:         shortName(obj.name, 13),
    'Programadas': Math.round(obj.scheduled),
    'Vacantes':    Math.round(obj.vacant),
  })), [actual.byObjective]);

  // Proyección: area chart (current + 3 months) — respeta el toggle de ausentismo
  const areaData = useMemo(() => [
    { name: periodRange.labelShort, 'Hs teóricas': theoretical.totalHours, 'Guardias mín.': totalGuardsDisplay },
    ...projectionDisplay.map(p => ({ name: p.label, 'Hs teóricas': p.hours, 'Guardias mín.': p.guards })),
  ], [theoretical.totalHours, totalGuardsDisplay, projectionDisplay, periodRange.labelShort]);

  const exportInforme = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const resumen = [
      ['Informe analítico operativo', periodRange.labelShort],
      ['Dotación activa', informe.dotacionActiva],
      ['Horas vendidas (SLA)', informe.hsVendidas],
      ['Horas planificadas', informe.hsPlanificadas],
      ['Horas realizadas', informe.hsRealizadas],
      ['Bolsa inicial hs', informe.bolsaInicial],
      ['Bolsa modo', informe.bolsaModo === 'sin_indice' ? 'Techo 200×N (sin índice)' : 'Capacidad realista'],
      ['Bolsa techo 200×N', informe.bolsaTecho],
      ['Índice ausencia 3m %', informe.bolsaModo === 'sin_indice' ? 'sin índice' : informe.bolsaIndicePct],
      ['Hs efectivas / guardia', informe.bolsaHsEfectivasGuardia],
      ['Ventana índice', informe.bolsaLookbackLabel],
      ['Bolsa disponible', informe.bolsaDisponible],
      ['Cobertura plan %', informe.coberturaPlanPct],
      ['Cobertura efectiva %', informe.coberturaEfectivaPct],
      ['Desvío extras (hs)', informe.desvioExtras],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Concepto', 'Horas', 'Observaciones'],
        ...informe.balance.map((r) => [r.concepto, r.horas, r.observacion]),
      ]),
      'Balance',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Rubro', 'Código', 'Horas', 'Eventos', 'Impacto'],
        ...informe.novedades.map((r) => [r.rubro, r.code, r.horas, r.eventos, r.impacto]),
      ]),
      'Novedades',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Tipo', 'Título', 'Texto'],
        ...informe.conclusiones.map((c) => [c.tipo, c.titulo, c.texto]),
      ]),
      'Conclusiones',
    );
    XLSX.writeFile(wb, `informe-analisis-${periodRange.labelShort.replace(/[^\w]+/g, '-')}.xlsx`);
  };

  const exportFinanciera = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const modo = finHoursMode === 'real' ? 'Real / fichado' : 'Planificado';
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Financiera hs-hombre', periodRange.labelShort, modo],
      ['SLA empresa', fin.slaHours],
      ['Hs plan', finPlanHours(fin, finHoursMode)],
      ['Horas sumadas', finSumadasHours(fin)],
      ['Consumo', fin.hsConsumo],
      ...FIN_NOV_BREAKDOWN_CODES.map((c) => [c, finNovCode(fin.novedades, c)]),
      ['Otras novedades', finNovOtros(fin.novedades)],
      ['EV', fin.hsEv],
      ['FT', fin.hsFt],
      ['Extras', fin.hsExtra],
      ['Ops', fin.hsOps],
      ['Francos F/FF', fin.hsFranco],
      ['RET no usado', fin.hsRet],
      ['REF / ESC', fin.hsDespliegue],
      ['Vacante', fin.hsVacante],
      ['Guardias', fin.guardias],
      ['Hs/guardia', fin.hsConsumoPorGuardia],
      ['SLA/guardia', fin.hsSlaPorGuardia],
      ['Eficiencia SLA/consumo %', fin.eficienciaPct],
    ]), 'Empresa');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Cliente', 'Objetivos', 'SLA', 'Hs plan', ...FIN_NOV_BREAKDOWN_CODES, 'Otr nov', 'EV', 'FT', 'Extra', 'Ops', 'Francos', 'RET', 'REF/ESC', 'Σ sumadas', 'Consumo', 'Vacante', 'Guardias', 'Hs/g', 'Δ SLA'],
      ...fin.clients.map((c) => [
        c.name, c.objetivos, c.slaHours, finPlanHours(c, finHoursMode),
        ...FIN_NOV_BREAKDOWN_CODES.map((code) => finNovCode(c.novedades, code)),
        finNovOtros(c.novedades), c.hsEv, c.hsFt, c.hsExtra, c.hsOps, c.hsFranco, c.hsRet, c.hsDespliegue,
        finSumadasHours(c), c.hsConsumo, c.hsVacante, c.guardias, c.hsConsumoPorGuardia, c.deltaVsSla,
      ]),
    ]), 'Clientes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Cliente', 'Objetivo', 'SLA', 'Hs plan', ...FIN_NOV_BREAKDOWN_CODES, 'Otr nov', 'EV', 'FT', 'Extra', 'Ops', 'Francos', 'RET', 'REF/ESC', 'Σ sumadas', 'Consumo', 'Vacante', 'Guardias', 'Hs/g', 'SLA/g', 'Δ SLA'],
      ...fin.clients.flatMap((c) => c.rows.map((o) => [
        c.name, o.name, o.slaHours, finPlanHours(o, finHoursMode),
        ...FIN_NOV_BREAKDOWN_CODES.map((code) => finNovCode(o.novedades, code)),
        finNovOtros(o.novedades), o.hsEv, o.hsFt, o.hsExtra, o.hsOps, o.hsFranco, o.hsRet, o.hsDespliegue,
        finSumadasHours(o), o.hsConsumo, o.hsVacante, o.guardias, o.hsConsumoPorGuardia, o.hsSlaPorGuardia, o.deltaVsSla,
      ])),
    ]), 'Objetivos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Cliente', 'Objetivo', 'Guardia', 'Hs plan', ...FIN_NOV_BREAKDOWN_CODES, 'Otr nov', 'EV', 'FT', 'Extra', 'Ops', 'Francos', 'RET', 'REF/ESC', 'Σ sumadas', 'Consumo'],
      ...fin.clients.flatMap((c) => c.rows.flatMap((o) => o.guards.map((g) => [
        c.name, o.name, empNameById[g.employeeId] || g.name, finPlanHours(g, finHoursMode),
        ...FIN_NOV_BREAKDOWN_CODES.map((code) => finGuardNovCode(g, code)),
        finGuardNovOtros(g), g.hsEv, g.hsFt, g.hsExtra, g.hsOps, g.hsFranco, g.hsRet, g.hsDespliegue,
        finSumadasHours(g), finGuardConsumo(g, finHoursMode),
      ]))),
    ]), 'Guardias');
    XLSX.writeFile(wb, `financiera-hs-${periodRange.labelShort.replace(/[^\w]+/g, '-')}.xlsx`);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  if (loadInit) {
    const pct = Math.max(0, Math.min(100, loadProgress?.pct ?? 0));
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto mt-16 px-4">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-6 sm:p-8">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-2">Análisis operativo</p>
            <h1 className="text-xl font-black text-slate-800 dark:text-white uppercase">Cargando Analítica</h1>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              Primero el <strong>mes en pantalla</strong> (y ausencias). Los 3 meses previos siguen en segundo plano;
              cambiar de mes dentro de esa ventana no vuelve a consultar.
            </p>
            <div className="mt-6">
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wide text-slate-500 mb-2">
                <span>{loadProgress?.label || 'Preparando…'}</span>
                <span className="tabular-nums text-indigo-600">{pct}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {loadProgress?.docs ? (
                <p className="text-[11px] text-slate-400 mt-2 tabular-nums">
                  {loadProgress.docs.toLocaleString('es-AR')} turnos en memoria
                </p>
              ) : null}
            </div>
            {loadError ? (
              <p className="mt-4 text-sm font-medium text-rose-600">{loadError}</p>
            ) : (
              <p className="mt-4 text-[11px] text-slate-400 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin"/> Esperá a que termine. No hace falta recargar a mitad de camino.
              </p>
            )}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageShell>
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0">
                <TrendingUp size={20} className="text-white"/>
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight uppercase" style={{ color: 'var(--txt)' }}>Análisis Operativo</h1>
                <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>Universo real · operativa · humana · financiera</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {/* Período: modo + navegación */}
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-0.5">
                  {([
                    { id: 'day' as PeriodMode, label: 'Día' },
                    { id: 'week' as PeriodMode, label: 'Sem.' },
                    { id: 'month' as PeriodMode, label: 'Mes' },
                    { id: 'quarter' as PeriodMode, label: 'Trim.' },
                    { id: 'semester' as PeriodMode, label: 'Semestre' },
                    { id: 'year' as PeriodMode, label: 'Año' },
                  ]).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPeriodModeSafe(id)}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${
                        periodMode === id
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => shiftPeriod(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 transition-colors"><ChevronLeft size={16}/></button>
                  <span className="text-sm font-black text-slate-700 dark:text-white uppercase min-w-[140px] max-w-[280px] text-center leading-tight">{periodRange.labelShort}</span>
                  <button type="button" onClick={() => shiftPeriod(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 transition-colors"><ChevronRight size={16}/></button>
                </div>
                <button
                  type="button"
                  onClick={() => void reloadAll()}
                  disabled={loadInit || loadFacts}
                  title={factsAt ? `Última carga ${new Date(factsAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : 'Recargar catálogo y hechos'}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 disabled:opacity-50 text-[10px] font-black uppercase tracking-wide"
                >
                  <RefreshCw size={12} className={loadFacts ? 'animate-spin' : ''}/>
                  Recargar
                </button>
              </div>
            </div>
          </div>

          {extractReady && !mallaReady && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Extracto mensual · actualizando malla
              </p>
              <p className="text-[12px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                Informe, Demanda y Financiera a nivel objetivo ya están. Guardias, F/RET/REF y el desglose fino de novedades llegan al terminar la malla.
              </p>
            </div>
          )}

          {loadFacts && loadProgress && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/30 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  {loadProgress.label}
                </p>
                <span className="text-[11px] font-black tabular-nums text-indigo-600">{Math.max(0, Math.min(100, loadProgress.pct))}%</span>
              </div>
              <div className="h-2 rounded-full bg-white dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-600 transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, loadProgress.pct))}%` }} />
              </div>
            </div>
          )}

          {(loadError || (employees.length === 0 && services.length === 0)) && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 shadow-sm">
              <p className="text-xs font-black uppercase text-amber-800 dark:text-amber-300">
                {loadError ? 'No se pudo leer el catálogo' : 'Catálogo vacío para esta empresa'}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                {loadError
                  ? loadError
                  : 'No hay legajos ni SLA vigentes. Si en Planificación o RRHH sí ves datos, recargá el módulo. Los documentos legacy de Bacarsa sin empresaId ahora se incluyen (misma regla que CRM).'}
              </p>
            </div>
          )}

          {/* ── Universo real ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={Building2} color="#4f46e5" label="Clientes" value={universo.clientes}
              subtext="Con SLA vigente en el período"/>
            <KpiCard icon={Briefcase} color="#7c3aed" label="Objetivos" value={universo.objetivos}
              subtext={`${universo.puestosUnicos} puestos SLA`}/>
            <KpiCard icon={Layers} color="#0891b2" label="Puestos (pax)" value={universo.puestos}
              subtext="Suma quantity de contratos vigentes"/>
            <KpiCard icon={Target} color="#0ea5e9" label="Slots a cubrir" value={universo.slotsPeriodo.toLocaleString('es-AR')}
              subtext={universo.picoSimultaneo > 0 ? `Pico ${universo.picoSimultaneo} en simultáneo${universo.picoFecha ? ` · ${universo.picoFecha.slice(8,10)}/${universo.picoFecha.slice(5,7)}` : ''}` : 'Sin demanda SLA'}/>
            <KpiCard icon={Users} color="#059669" label="Plantel" value={universo.plantel}
              subtext={
                availableGuards !== universo.plantel
                  ? `${availableGuards} disponibles · −${guardiasNoDispTotal} no disp.`
                  : 'Legajos activos'
              }/>
            <KpiCard icon={Clock} color="#4f46e5" label="Hs vendidas (SLA)" value={theoretical.totalHours.toLocaleString('es-AR')} unit="hs"
              subtext={loadTurnos ? 'Cargando malla…' : `Plan ${informe.hsPlanificadas.toLocaleString('es-AR')} · real ${informe.hsRealizadas.toLocaleString('es-AR')} · vac ${informe.hsVacante.toLocaleString('es-AR')}`}/>
          </div>

          {!loadTurnos && deploymentStatsTotal > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-3">
                Despliegue · estadística operativa (no suma hs planificadas SLA)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  { kind: 'RET' as const, label: 'RET · guardia pasiva', hint: 'Stand-by · liquidación 8 hs si no se usó' },
                  { kind: 'REF' as const, label: 'REF · superposición', hint: 'Conocer objetivo · solo liquidación' },
                  { kind: 'ESC' as const, label: 'ESC · escuela', hint: 'Conocer cliente/objetivo · solo liquidación' },
                ]).map(({ kind, label, hint }) => {
                  const row = deploymentStats[kind];
                  if (row.count === 0) return null;
                  return (
                    <div key={kind} className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-amber-100 dark:border-amber-900/40">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${codeBadgeClass(kind)}`}>{kind}</span>
                        <span className="text-lg font-black text-slate-800 dark:text-white">{row.count.toLocaleString('es-AR')}</span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{label}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{Math.round(row.hours).toLocaleString('es-AR')} hs ref. · {hint}</p>
                      {row.vacant > 0 && (
                        <p className="text-[9px] font-bold text-amber-600 mt-1">{row.vacant} vacante(s)</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Lectura real del período ─────────────────────────────── */}
          {theoretical.totalHours > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">
                {periodRange.labelShort} · {universo.clientes} clientes · {universo.objetivos} objetivos · {universo.puestos} pax en puesto · {universo.slotsPeriodo.toLocaleString('es-AR')} slots SLA · pico {universo.picoSimultaneo} · plantel {universo.plantel}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="text-center">
                  <p className="text-xl font-black text-indigo-600">{informe.hsVendidas.toLocaleString('es-AR')}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400">Vendidas</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-sky-600">{informe.hsPlanificadas.toLocaleString('es-AR')}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400">Planificadas</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-emerald-600">{informe.hsRealizadas.toLocaleString('es-AR')}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400">Realizadas</p>
                </div>
                <div className="text-center">
                  <p className={`text-xl font-black ${informe.hsVacante > 0 ? 'text-amber-600' : 'text-slate-700 dark:text-white'}`}>{informe.hsVacante.toLocaleString('es-AR')}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400">Vacante</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-orange-600">{informe.desvioExtras.toLocaleString('es-AR')}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400">Extras / FT / ops</p>
                </div>
              </div>
              {!loadTurnos && informe.hsVendidas > 0 && turnos.length === 0 && (
                <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Hay {informe.hsVendidas.toLocaleString('es-AR')} hs SLA y <strong>0 turnos</strong> en {periodRange.labelShort}.
                  Si el mes está planificado, recargá el header. Si no hay malla en Firestore para este período, la financiera no puede calcular consumo.
                </p>
              )}
              {!loadTurnos && turnos.length > 0 && informe.hsPlanificadas === 0 && (
                <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  {turnos.length.toLocaleString('es-AR')} turnos en el período pero 0 hs de malla (códigos no computables o exclusiones SLA).
                </p>
              )}
            </div>
          )}

          {/* ── Solapas ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
              {([
                { id: 'operativa' as const, label: 'Operativa', icon: Activity, tab: 'informe' as const },
                { id: 'humana' as const, label: 'Humana', icon: Users, tab: 'guardias' as const },
                { id: 'financiera' as const, label: 'Financiera', icon: Wallet, tab: 'financiera' as const },
                { id: 'herramientas' as const, label: 'Herramientas', icon: Filter, tab: 'viabilidad' as const },
              ]).map((g) => {
                const group =
                  activeTab === 'financiera' ? 'financiera'
                  : (activeTab === 'guardias' || activeTab === 'art12') ? 'humana'
                  : (activeTab === 'viabilidad' || activeTab === 'analitica' || activeTab === 'proyeccion') ? 'herramientas'
                  : 'operativa';
                const Icon = g.icon;
                const isActive = group === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { if (group !== g.id) setActiveTab(g.tab); }}
                    className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all shrink-0 ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200 dark:shadow-indigo-900'
                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:text-indigo-600'
                    }`}
                  >
                    <Icon size={13}/>
                    {g.label}
                  </button>
                );
              })}
            </div>
            {activeTab !== 'financiera' && (
              <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                {(
                  (activeTab === 'guardias' || activeTab === 'art12')
                    ? [
                        { id: 'guardias', label: 'Guardias', icon: Users, alert: false },
                        { id: 'art12', label: 'ART.12', icon: MapPin, alert: false },
                      ]
                    : (activeTab === 'viabilidad' || activeTab === 'analitica' || activeTab === 'proyeccion')
                      ? [
                          { id: 'viabilidad', label: 'Viabilidad', icon: Scale, alert: superavitGlobal < 0 },
                          { id: 'analitica', label: 'Analítica', icon: Filter, alert: false },
                          { id: 'proyeccion', label: 'Proyección', icon: TrendingUp, alert: false },
                        ]
                      : [
                          { id: 'informe', label: 'Informe', icon: FileText, alert: informe.desvioRealVsVendido < -8 || informe.hsVacante > 8 },
                          { id: 'demanda', label: 'Demanda', icon: Wallet, alert: demanda.totals.deltaSla < -8 || demanda.totals.vacantHours > 0 },
                          { id: 'cobertura', label: 'Cobertura', icon: Target, alert: vacancyPct > 20 },
                          { id: 'capacidad', label: 'Dist. horas', icon: BarChart3, alert: false },
                        ]
                ).map((t) => {
                  const Icon = t.icon;
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id as typeof activeTab)}
                      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all shrink-0 ${
                        isActive
                          ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Icon size={12}/>
                      {t.label}
                      {t.alert && (
                        <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${isActive ? 'bg-amber-300' : 'bg-rose-500'}`}/>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Panel ausentismo ────────────────────────────────────────── */}
          {(activeTab === 'guardias' || activeTab === 'art12') && theoretical.totalHours > 0 && (() => {
            const COMPONENTES = [
              { label:'Vacaciones',             val:ausVac,   set:setAusVac,   color:'#4f46e5', hint:'CCT: 14-28 días/año → ~4-9%', real: ausenciasStats?.vacPct   ?? null },
              { label:'Enfermedad / Cert.',      val:ausEnf,   set:setAusEnf,   color:'#d97706', hint:'Promedio sector: 3-6%',        real: ausenciasStats?.enfPct   ?? null },
              { label:'Accidentes ART',          val:ausArt,   set:setAusArt,   color:'#dc2626', hint:'Sector seguridad: 1-3%',       real: ausenciasStats?.artPct   ?? null },
              { label:'Ausencias injustificadas',val:ausAus,   set:setAusAus,   color:'#7c3aed', hint:'Variable: 1-5%',               real: ausenciasStats?.injPct   ?? null },
              { label:'Licencias / Otros',       val:ausOtros, set:setAusOtros, color:'#0891b2', hint:'Matrimonio, duelo, etc.',      real: ausenciasStats?.otrosPct ?? null },
            ];
            return (
              <div className={`rounded-xl border transition-colors ${
                showAusentismo
                  ? 'border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-900/10'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
              }`}>
                {/* Header colapsable */}
                <div className="w-full flex items-center justify-between px-5 py-3.5 gap-3">
                  <button
                    onClick={() => setShowAusentismo(s => !s)}
                    className="flex-1 flex items-center gap-3 text-left">
                    <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/40">
                      <AlertTriangle size={14} className="text-violet-600"/>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-700 dark:text-white tracking-wide">
                        Ajuste por Ausentismo
                      </p>
                      <p className="text-[9px] text-slate-400 font-medium">
                        Escenario what-if: <strong className={`${ausentismoTotal>=20?'text-rose-600':ausentismoTotal>=12?'text-amber-600':'text-emerald-600'}`}>{ausentismoTotal}%</strong>
                        {' · '}Hs reales/guardia: <strong className="text-violet-600">{hsRealesGuardia} hs</strong>
                        {' · '}Guardias ajustados: <strong className={brechaAjustada>0?'text-rose-600':'text-emerald-600'}>{guardiasAjustados}</strong>
                        {' · '}Brecha: <strong className={brechaAjustada>0?'text-rose-600':'text-emerald-600'}>{brechaAjustada>0?`+${brechaAjustada} déficit`:`${Math.abs(brechaAjustada)} superávit`}</strong>
                      </p>
                    </div>
                  </button>
                  {/* Toggle propaga el ajuste a los KPIs principales del header */}
                  <label className="flex items-center gap-2 cursor-pointer shrink-0 select-none" title="What-if: ajusta Viabilidad (herramientas) con el escenario de ausentismo. No cambia los KPIs reales del header.">
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-300 hidden sm:inline">
                      Aplicar a Viabilidad
                    </span>
                    <input
                      type="checkbox"
                      checked={aplicarAusentismo}
                      onChange={e => setAplicarAusentismo(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 rounded-full peer peer-checked:bg-violet-600 transition-colors relative">
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aplicarAusentismo?'translate-x-4':''}`}/>
                    </div>
                  </label>
                  <button
                    onClick={() => setShowAusentismo(s => !s)}
                    className="p-1">
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${showAusentismo?'rotate-180':''}`}/>
                  </button>
                </div>

                {/* Contenido expandido */}
                {showAusentismo && (
                  <div className="px-5 pb-5 space-y-4 border-t border-violet-100 dark:border-violet-800/50 pt-4">

                    {/* Datos reales del mes */}
                    {ausenciasStats && (
                      <div className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between ${
                        ausenciasStats.total > 0
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700'
                          : 'bg-slate-50 dark:bg-slate-700/30 border-slate-200 dark:border-slate-700'
                      }`}>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                            Tasas reales del período — {ausenciasStats.total} eventos (RRHH + isAbsent / AUTO_T30) en {periodRange.labelShort}
                            {loadAus && <span className="ml-2 text-indigo-500">· cargando...</span>}
                          </p>
                          {ausenciasStats.total > 0 ? (
                            <div className="flex flex-wrap gap-3">
                              {[
                                { label:'Vacaciones', pct: ausenciasStats.vacPct,   color:'#4f46e5' },
                                { label:'Enfermedad', pct: ausenciasStats.enfPct,   color:'#d97706' },
                                { label:'ART',        pct: ausenciasStats.artPct,   color:'#dc2626' },
                                { label:'Injust.',    pct: ausenciasStats.injPct,   color:'#7c3aed' },
                                { label:'Otros',      pct: ausenciasStats.otrosPct, color:'#0891b2' },
                              ].map(r => (
                                <div key={r.label} className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }}/>
                                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{r.label}:</span>
                                  <span className="text-[10px] font-black" style={{ color: r.color }}>{r.pct}%</span>
                                </div>
                              ))}
                              <span className="text-[10px] font-black text-slate-700 dark:text-white border-l border-slate-300 dark:border-slate-600 pl-3">
                                Total real: {ausenciasStats.totalPct}% · {ausenciasStats.hsAfectadas} hs afectadas
                              </span>
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-400">Sin ausencias registradas en RRHH para este período</p>
                          )}
                        </div>
                        {ausenciasStats.total > 0 && (
                          <button
                            onClick={() => {
                              setAusVac(ausenciasStats.vacPct);
                              setAusEnf(ausenciasStats.enfPct);
                              setAusArt(ausenciasStats.artPct);
                              setAusAus(ausenciasStats.injPct);
                              setAusOtros(ausenciasStats.otrosPct);
                            }}
                            className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
                            Usar datos reales
                          </button>
                        )}
                      </div>
                    )}

                    {/* Fórmula explicada */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-[10px] text-slate-500 leading-relaxed">
                      <p className="font-black text-slate-700 dark:text-white mb-1 text-xs">Fórmula de disponibilidad real</p>
                      <p>
                        <span className="font-black text-violet-600">{capHsPerGuardPeriod} hs jornada de referencia/guardia</span>
                        {' × (1 − '}
                        <span className="font-black text-amber-600">{ausentismoTotal}%</span>
                        {' ausentismo) = '}
                        <span className="font-black text-emerald-600">{hsRealesGuardia} hs reales/guardia</span>
                      </p>
                      <p className="mt-1">
                        {'⌈ '}
                        <span className="font-black text-indigo-600">{theoretical.totalHours.toLocaleString('es-AR')} hs</span>
                        {' / '}
                        <span className="font-black text-emerald-600">{hsRealesGuardia} hs</span>
                        {' ⌉ = '}
                        <span className="font-black text-violet-600">{guardiasAjustados} guardias necesarios reales</span>
                      </p>
                      <p className="mt-1 text-slate-400">
                        Con {ausentismoTotal}% de ausentismo, cada guardia está disponible efectivamente {hsRealesGuardia} hs en el período analizado.
                        Cupo efectivo: {availableGuards} guardias (plantel {plantelGuardias}) aportan {(availableGuards * hsRealesGuardia).toLocaleString('es-AR')} hs reales totales.
                      </p>
                    </div>

                    {/* Sliders por componente */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      {COMPONENTES.map(c => (
                        <div key={c.label} className="space-y-1.5 bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-black uppercase text-slate-500 tracking-wide">{c.label}</span>
                            <span className="text-sm font-black" style={{ color: c.color }}>{c.val.toFixed(1)}%</span>
                          </div>
                          {/* Indicador dato real */}
                          {c.real !== null && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[8px] text-slate-400">Real RRHH:</span>
                              <span className="text-[9px] font-black" style={{ color: c.color }}>{c.real}%</span>
                              {Math.abs(c.val - c.real) > 0.1 && (
                                <span className={`text-[8px] font-bold ${c.val > c.real ? 'text-amber-500' : 'text-rose-500'}`}>
                                  {c.val > c.real ? `+${(c.val-c.real).toFixed(1)}` : (c.val-c.real).toFixed(1)} vs real
                                </span>
                              )}
                            </div>
                          )}
                          <input
                            type="range" min={0} max={20} step={0.1} value={c.val}
                            onChange={e => c.set(Math.round(Number(e.target.value) * 10) / 10)}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                            style={{ accentColor: c.color }}
                          />
                          <p className="text-[8px] text-slate-400 text-center">{c.hint}</p>
                        </div>
                      ))}
                    </div>

                    {/* Resumen visual */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
                        <p className="text-2xl font-black text-violet-600">{ausentismoTotal}%</p>
                        <p className="text-[9px] font-black uppercase text-slate-400">Escenario what-if</p>
                        {ausenciasStats && ausenciasStats.total > 0 && (
                          <p className="text-[9px] text-slate-400 mt-0.5">Real RRHH: <strong style={{ color: ausenciasStats.totalPct>ausentismoTotal?'#dc2626':'#059669' }}>{ausenciasStats.totalPct}%</strong></p>
                        )}
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
                        <p className="text-2xl font-black text-emerald-600">{hsRealesGuardia}</p>
                        <p className="text-[9px] font-black uppercase text-slate-400">Hs reales/guardia</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">vs {capHsPerGuardPeriod} hs jornada ref.</p>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
                        <p className={`text-2xl font-black ${brechaAjustada>0?'text-rose-600':'text-emerald-600'}`}>{guardiasAjustados}</p>
                        <p className="text-[9px] font-black uppercase text-slate-400">Guardias necesarios</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">vs {theoretical.totalGuards} sin ausentismo</p>
                      </div>
                      <div className={`rounded-xl p-3 border text-center ${
                        brechaAjustada>0
                          ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                          : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      }`}>
                        <p className={`text-2xl font-black ${brechaAjustada>0?'text-rose-600':'text-emerald-600'}`}>
                          {brechaAjustada>0?`+${brechaAjustada}`:brechaAjustada}
                        </p>
                        <p className="text-[9px] font-black uppercase text-slate-400">Brecha real</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          {brechaAjustada>0
                            ? `Necesitás contratar ${brechaAjustada} guardia${brechaAjustada>1?'s':''}`
                            : `Tenés ${Math.abs(brechaAjustada)} guardia${Math.abs(brechaAjustada)>1?'s':''} de margen`
                          }
                        </p>
                      </div>
                    </div>

                    {/* Detalle ausencias del mes */}
                    {ausenciasStats && ausenciasStats.detalle.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-[9px] font-black uppercase text-indigo-500 tracking-widest hover:text-indigo-700 flex items-center gap-1.5">
                          <ChevronDown size={11} className="transition-transform group-open:rotate-180"/>
                          Ver detalle de {ausenciasStats.detalle.length} ausencia{ausenciasStats.detalle.length>1?'s':''} del período
                        </summary>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-[10px] text-left">
                            <thead className="bg-slate-50 dark:bg-slate-700/40 text-slate-500 font-black uppercase text-[8px]">
                              <tr>
                                <th className="px-3 py-2">Empleado</th>
                                <th className="px-3 py-2">Código</th>
                                <th className="px-3 py-2 text-center">Días</th>
                                <th className="px-3 py-2 text-center">Hs afectadas</th>
                                <th className="px-3 py-2 text-center">Origen</th>
                                <th className="px-3 py-2 text-center">Estado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                              {ausenciasStats.detalle.map((a: any) => (
                                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                  <td className="px-3 py-1.5 font-bold text-slate-700 dark:text-white uppercase">{a.emp}</td>
                                  <td className="px-3 py-1.5">
                                    <span className={`px-1.5 py-0.5 rounded font-black text-[8px] ${
                                      a.code==='V'?'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400':
                                      a.code==='E'?'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400':
                                      a.code==='A'?'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400':
                                      a.code==='AA'?'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400':
                                      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                    }`}>
                                      {a.code || a.tipo}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-center text-slate-500">{a.days}</td>
                                  <td className="px-3 py-1.5 text-center font-black text-rose-600">{a.hs} hs</td>
                                  <td className="px-3 py-1.5 text-center text-[8px] font-bold text-slate-400 uppercase">
                                    {a.source==='auto_t30'?'AUTO T30':a.source==='turno'?'Turno':a.source==='rrhh'?'RRHH':'—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${
                                      a.status==='Justificada'||a.status==='Autorizada'?'bg-emerald-100 text-emerald-700':
                                      a.status==='Injustificada'||a.status==='Ausente'?'bg-rose-100 text-rose-700':
                                      'bg-slate-100 text-slate-500'
                                    }`}>{a.status||'—'}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}

                  </div>
                )}
              </div>
            );
          })()}

          {/* ══════════════════════════════════════════════════════════════
              TAB: INFORME ANALÍTICO
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'financiera' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <p className="text-[11px] text-slate-500 max-w-3xl leading-relaxed">
                  Consumo de <strong>hs-hombre</strong> en <strong>{periodRange.labelShort}</strong>:
                  <strong>hs plan</strong> (cobertura de malla) + <strong>horas sumadas</strong> (novedades V/L/E/A/AA/PG + FT + extra/ops + francos F/FF y RET/REF/ESC no usados).
                  El SLA no incluye esas horas extra. Si el RET se usó el mismo día (M/T/N), no se duplica.
                  Las novedades se atribuyen al puesto (malla / historial / legajo).
                  Sin precios. Pirámide empresa → cliente → objetivo.
                  Techo liquidación = <strong>200 hs</strong>/vigilador (no mezclar con jornada 192).
                  {informe.bolsaModo === 'sin_indice'
                    ? ` Sin índice: no hay ausencias en ${informe.bolsaLookbackLabel || 'los 3 meses previos'}; se muestra el techo 200×N, no una capacidad realista.`
                    : ` Capacidad realista: ${informe.bolsaHsEfectivasGuardia} hs/g con índice 3m ${informe.bolsaIndicePct}% (${informe.bolsaLookbackLabel || '—'}).`}
                  {' '}{turnos.length.toLocaleString('es-AR')} turnos en el período.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
                    {([
                      { id: 'planned' as const, label: 'Planificado' },
                      { id: 'real' as const, label: 'Real / fichado' },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setFinHoursMode(opt.id)}
                        className={`px-3 py-2 text-[10px] font-black uppercase ${
                          finHoursMode === opt.id
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void exportFinanciera()}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase"
                  >
                    <FileSpreadsheet size={13}/> Exportar Excel
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard icon={Target} color="#4f46e5" label="SLA empresa" value={fin.slaHours.toLocaleString('es-AR')} unit="hs" subtext={`${fin.clientes} clientes · ${fin.objetivos} objetivos`}/>
                <KpiCard icon={Clock} color="#0284c7" label={finHoursMode === 'real' ? 'Hs plan (fichada)' : 'Hs plan'} value={finPlanHours(fin, finHoursMode).toLocaleString('es-AR')} unit="hs" subtext={finHoursMode === 'real' ? `Plan ${fin.hsPlan.toLocaleString('es-AR')} hs` : 'Cobertura de malla, sin novedades'}/>
                <KpiCard icon={Wallet} color="#0f766e" label="Consumo hs-hombre" value={fin.hsConsumo.toLocaleString('es-AR')} unit="hs" subtext={`Plan ${finPlanHours(fin, finHoursMode).toLocaleString('es-AR')} + sumadas ${finSumadasHours(fin).toLocaleString('es-AR')}`} alert={fin.deltaVsSla > 8}/>
                <KpiCard icon={Users} color="#0891b2" label="Hs / guardia" value={fin.hsConsumoPorGuardia.toLocaleString('es-AR')} unit="hs" subtext={`${fin.guardias} guardias · SLA ${fin.hsSlaPorGuardia.toLocaleString('es-AR')} hs/c/u`}/>
                <KpiCard icon={AlertTriangle} color="#ea580c" label="FT + extras + no usadas" value={(fin.hsFt + fin.hsExtra + fin.hsOps + finIdleHours(fin)).toLocaleString('es-AR')} unit="hs" subtext={`FT ${fin.hsFt.toLocaleString('es-AR')} · ext ${fin.hsExtra.toLocaleString('es-AR')} · ops ${fin.hsOps.toLocaleString('es-AR')} · F ${fin.hsFranco.toLocaleString('es-AR')} · RET ${fin.hsRet.toLocaleString('es-AR')} · REF/ESC ${fin.hsDespliegue.toLocaleString('es-AR')}`}/>
                <KpiCard icon={Activity} color={fin.eficienciaPct >= 90 ? '#059669' : fin.eficienciaPct >= 75 ? '#d97706' : '#dc2626'} label="Eficiencia SLA/consumo" value={`${fin.eficienciaPct}%`} subtext={`Novedades ${fin.novedades.total.toLocaleString('es-AR')} · vacante ${fin.hsVacante.toLocaleString('es-AR')}`} alert={fin.eficienciaPct < 75}/>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                {([
                  { k: 'V Vacaciones', v: finNovCode(fin.novedades, 'V'), c: '#7c3aed' },
                  { k: 'E Enfermedad', v: finNovCode(fin.novedades, 'E'), c: '#dc2626' },
                  { k: 'L Licencia', v: finNovCode(fin.novedades, 'L'), c: '#0891b2' },
                  { k: 'A ART', v: finNovCode(fin.novedades, 'A'), c: '#d97706' },
                  { k: 'AA Injust.', v: finNovCode(fin.novedades, 'AA'), c: '#64748b' },
                  { k: 'PG Gremial', v: finNovCode(fin.novedades, 'PG'), c: '#0f766e' },
                  { k: 'SUS Suspensión', v: finNovCode(fin.novedades, 'SUS'), c: '#be123c' },
                  { k: 'EV Evento', v: fin.hsEv, c: '#ca8a04' },
                ]).map((n) => (
                  <div key={n.k} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-sm">
                    <p className="text-[9px] font-black uppercase text-slate-400">{n.k}</p>
                    <p className="text-lg font-black" style={{ color: n.c }}>{n.v.toLocaleString('es-AR')} <span className="text-[10px] font-bold text-slate-400">hs</span></p>
                  </div>
                ))}
              </div>

              {!loadTurnos && finClientBars.length > 0 && (
                <SectionCard title={`SLA vs consumo por cliente · ${periodRange.labelShort}`} icon={BarChart3} loading={loadTurnos}>
                  <LegendRow items={[
                    { color: '#4f46e5', label: 'SLA' },
                    { color: '#0f766e', label: 'Consumo hs-hombre' },
                    { color: '#7c3aed', label: 'Novedades' },
                    { color: '#ea580c', label: 'FT' },
                    { color: '#64748b', label: 'F / RET / REF' },
                  ]}/>
                  <div className="px-5 pb-5 pt-2">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={finClientBars} margin={{ top: 4, right: 8, left: -16, bottom: 52 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} angle={-40} textAnchor="end" interval={0}/>
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="SLA" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={16}/>
                        <Bar dataKey="Consumo" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={16}/>
                        <Bar dataKey="Novedades" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={16}/>
                        <Bar dataKey="FT" fill="#ea580c" radius={[4, 4, 0, 0]} maxBarSize={16}/>
                        <Bar dataKey="F/RET" fill="#64748b" radius={[4, 4, 0, 0]} maxBarSize={16}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              <SectionCard title={`Clientes · ${periodRange.labelShort}`} icon={Building2} loading={loadTurnos}>
                {fin.clients.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <Wallet size={36} className="mx-auto mb-2 opacity-20"/>
                    <p className="text-sm font-bold">Sin consumo calculable en este período</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[70vh] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <table className="w-full min-w-[1680px] text-sm border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-800 text-white text-[10px] font-black uppercase tracking-wide">
                          <th rowSpan={2} className="sticky left-0 z-20 bg-slate-800 p-3 text-left min-w-[180px] border-b border-slate-700">Cliente</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">Obj.</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">SLA hs</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700 bg-slate-700/80">Hs plan</th>
                          <th colSpan={FIN_NOV_HEAD_COLS} className="p-2 text-center border-b border-l border-slate-600 bg-violet-900/80">Novedades</th>
                          <th colSpan={6} className="p-2 text-center border-b border-l border-slate-600 bg-slate-700">Otras sumadas</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">Σ</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">Consumo</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">Vacante</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">G</th>
                          <th rowSpan={2} className="p-3 text-right border-b border-slate-700">Hs / g</th>
                          <th rowSpan={2} className="p-3 text-right pr-4 border-b border-slate-700">Δ vs SLA</th>
                        </tr>
                        <tr className="bg-slate-700 text-white text-[9px] font-black uppercase tracking-wide">
                          {FIN_NOV_BREAKDOWN_CODES.map((c, i) => (
                            <th key={c} className={`p-2 text-right ${i === 0 ? 'border-l border-slate-600' : ''}`}>{c}</th>
                          ))}
                          <th className="p-2 text-right">Otr.</th>
                          <th className="p-2 text-right border-l border-slate-600">EV</th>
                          <th className="p-2 text-right">FT</th>
                          <th className="p-2 text-right">Extra</th>
                          <th className="p-2 text-right">F</th>
                          <th className="p-2 text-right">RET</th>
                          <th className="p-2 text-right">REF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fin.clients.map((cli, idx) => {
                          const open = expandedFinClientId === cli.id;
                          const hsCell = (n: number, extra = '') => (
                            <td className={`p-2.5 text-right tabular-nums ${extra}`}>
                              {n === 0 ? <span className="text-slate-300 dark:text-slate-600">—</span> : n.toLocaleString('es-AR')}
                            </td>
                          );
                          return (
                            <React.Fragment key={cli.id}>
                              <tr
                                className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 ${
                                  open
                                    ? 'bg-indigo-50/80 dark:bg-indigo-950/40'
                                    : idx % 2 === 0
                                      ? 'bg-white dark:bg-slate-900'
                                      : 'bg-slate-50 dark:bg-slate-800/40'
                                } hover:bg-indigo-50 dark:hover:bg-indigo-950/30`}
                                onClick={() => setExpandedFinClientId(open ? null : cli.id)}
                              >
                                <td className={`sticky left-0 z-10 p-2.5 font-bold text-slate-800 dark:text-white text-xs ${open ? 'bg-indigo-50 dark:bg-indigo-950' : idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-800'}`}>
                                  <span className="inline-flex items-center gap-1.5">
                                    {open ? <ChevronDown size={14} className="text-indigo-500 shrink-0"/> : <ChevronRight size={14} className="text-slate-400 shrink-0"/>}
                                    <span className="uppercase tracking-wide">{cli.name}</span>
                                  </span>
                                </td>
                                {hsCell(cli.objetivos, 'text-slate-500')}
                                {hsCell(cli.slaHours, 'text-slate-700 dark:text-slate-200')}
                                {hsCell(finPlanHours(cli, finHoursMode), 'font-semibold')}
                                {FIN_NOV_BREAKDOWN_CODES.map((c) => (
                                  <React.Fragment key={c}>{hsCell(finNovCode(cli.novedades, c))}</React.Fragment>
                                ))}
                                {hsCell(finNovOtros(cli.novedades))}
                                {hsCell(cli.hsEv)}
                                {hsCell(cli.hsFt)}
                                {hsCell(cli.hsExtra + cli.hsOps)}
                                {hsCell(cli.hsFranco)}
                                {hsCell(cli.hsRet)}
                                {hsCell(cli.hsDespliegue)}
                                {hsCell(finSumadasHours(cli), 'font-bold text-slate-700 dark:text-slate-200')}
                                {hsCell(cli.hsConsumo, 'font-black text-slate-900 dark:text-white')}
                                {hsCell(cli.hsVacante)}
                                {hsCell(cli.guardias, 'text-slate-500')}
                                {hsCell(cli.hsConsumoPorGuardia, 'font-semibold')}
                                <td className={`p-2.5 pr-4 text-right tabular-nums font-black ${
                                  cli.deltaVsSla > 4 ? 'text-rose-600' : cli.deltaVsSla < -4 ? 'text-amber-600' : 'text-emerald-600'
                                }`}>
                                  {cli.deltaVsSla > 0 ? '+' : ''}{cli.deltaVsSla.toLocaleString('es-AR')}
                                </td>
                              </tr>
                              {open && (
                                <tr>
                                  <td colSpan={16 + FIN_NOV_HEAD_COLS} className="p-0 bg-slate-100/90 dark:bg-slate-950/50">
                                    <table className="w-full min-w-[1680px] text-sm border-collapse">
                                      <thead>
                                        <tr className="bg-slate-200/80 dark:bg-slate-800 text-[9px] uppercase font-black tracking-wide text-slate-600 dark:text-slate-300">
                                          <th rowSpan={2} className="p-2 pl-10 text-left border-b border-slate-300 dark:border-slate-700">Objetivo</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">SLA hs</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">Hs plan</th>
                                          <th colSpan={FIN_NOV_HEAD_COLS} className="p-1.5 text-center border-b border-l border-slate-300 dark:border-slate-600">Novedades</th>
                                          <th colSpan={6} className="p-1.5 text-center border-b border-l border-slate-300 dark:border-slate-600">Otras sumadas</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">Σ</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">Consumo</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">Vacante</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">G</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">Hs / g</th>
                                          <th rowSpan={2} className="p-2 text-right border-b border-slate-300 dark:border-slate-700">SLA / g</th>
                                          <th rowSpan={2} className="p-2 text-right pr-4 border-b border-slate-300 dark:border-slate-700">Δ</th>
                                        </tr>
                                        <tr className="bg-slate-300/70 dark:bg-slate-700 text-[9px] uppercase font-black tracking-wide text-slate-600 dark:text-slate-300">
                                          {FIN_NOV_BREAKDOWN_CODES.map((c, i) => (
                                            <th key={c} className={`p-1.5 text-right ${i === 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''}`}>{c}</th>
                                          ))}
                                          <th className="p-1.5 text-right">Otr.</th>
                                          <th className="p-1.5 text-right border-l border-slate-300 dark:border-slate-600">EV</th>
                                          <th className="p-1.5 text-right">FT</th>
                                          <th className="p-1.5 text-right">Extra</th>
                                          <th className="p-1.5 text-right">F</th>
                                          <th className="p-1.5 text-right">RET</th>
                                          <th className="p-1.5 text-right">REF</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {cli.rows.map((obj, oidx) => {
                                          const objOpen = expandedFinObjId === obj.id;
                                          const oCell = (n: number, extra = '') => (
                                            <td className={`p-2 text-right tabular-nums ${extra}`}>
                                              {n === 0 ? <span className="text-slate-300 dark:text-slate-600">—</span> : n.toLocaleString('es-AR')}
                                            </td>
                                          );
                                          return (
                                            <React.Fragment key={obj.id}>
                                              <tr
                                                className={`cursor-pointer border-b border-slate-200/70 dark:border-slate-800 ${
                                                  objOpen ? 'bg-white dark:bg-slate-800' : oidx % 2 === 0 ? 'bg-white/70 dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-900/20'
                                                } hover:bg-white dark:hover:bg-slate-800`}
                                                onClick={(e) => { e.stopPropagation(); setExpandedFinObjId(objOpen ? null : obj.id); }}
                                              >
                                                <td className="p-2 pl-10 font-bold text-xs text-slate-700 dark:text-slate-100">
                                                  <span className="inline-flex items-center gap-1">
                                                    {objOpen ? <ChevronDown size={12} className="text-indigo-500 shrink-0"/> : <ChevronRight size={12} className="text-slate-400 shrink-0"/>}
                                                    {obj.name}
                                                  </span>
                                                </td>
                                                {oCell(obj.slaHours)}
                                                {oCell(finPlanHours(obj, finHoursMode), 'font-semibold')}
                                                {FIN_NOV_BREAKDOWN_CODES.map((c) => (
                                                  <React.Fragment key={c}>{oCell(finNovCode(obj.novedades, c))}</React.Fragment>
                                                ))}
                                                {oCell(finNovOtros(obj.novedades))}
                                                {oCell(obj.hsEv)}
                                                {oCell(obj.hsFt)}
                                                {oCell(obj.hsExtra + obj.hsOps)}
                                                {oCell(obj.hsFranco)}
                                                {oCell(obj.hsRet)}
                                                {oCell(obj.hsDespliegue)}
                                                {oCell(finSumadasHours(obj), 'font-bold')}
                                                {oCell(obj.hsConsumo, 'font-black')}
                                                {oCell(obj.hsVacante)}
                                                {oCell(obj.guardias, 'text-slate-500')}
                                                {oCell(obj.hsConsumoPorGuardia, 'font-semibold')}
                                                {oCell(obj.hsSlaPorGuardia, 'text-slate-500')}
                                                <td className={`p-2 pr-4 text-right tabular-nums font-black ${
                                                  obj.deltaVsSla > 4 ? 'text-rose-600' : obj.deltaVsSla < -4 ? 'text-amber-600' : 'text-emerald-600'
                                                }`}>
                                                  {obj.deltaVsSla > 0 ? '+' : ''}{obj.deltaVsSla.toLocaleString('es-AR')}
                                                </td>
                                              </tr>
                                              {objOpen && (
                                                <tr>
                                                  <td colSpan={16 + FIN_NOV_HEAD_COLS} className="px-10 py-3 bg-white dark:bg-slate-800">
                                                    <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2 mb-3">
                                                      {([
                                                        { k: 'V Vacaciones', v: finNovCode(obj.novedades, 'V') },
                                                        { k: 'E Enfermedad', v: finNovCode(obj.novedades, 'E') },
                                                        { k: 'L Licencia', v: finNovCode(obj.novedades, 'L') },
                                                        { k: 'A ART', v: finNovCode(obj.novedades, 'A') },
                                                        { k: 'AA Injust.', v: finNovCode(obj.novedades, 'AA') },
                                                        { k: 'PG Gremial', v: finNovCode(obj.novedades, 'PG') },
                                                        { k: 'SUS Suspensión', v: finNovCode(obj.novedades, 'SUS') },
                                                        { k: 'Otras nov.', v: finNovOtros(obj.novedades) },
                                                        { k: 'EV Evento', v: obj.hsEv },
                                                        { k: 'RET', v: obj.hsRet },
                                                      ]).map((n) => (
                                                        <div key={n.k} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 shadow-sm">
                                                          <p className="text-[9px] font-black uppercase text-slate-400">{n.k}</p>
                                                          <p className="text-sm font-black tabular-nums">{n.v.toLocaleString('es-AR')} hs</p>
                                                        </div>
                                                      ))}
                                                    </div>
                                                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Hs-hombre por guardia</p>
                                                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                                                      <table className="w-full text-xs border-collapse">
                                                        <thead>
                                                          <tr className="bg-slate-100 dark:bg-slate-700 text-[9px] uppercase font-black text-slate-500">
                                                            <th className="p-2 text-left">Guardia</th>
                                                            <th className="p-2 text-right">Hs plan</th>
                                                            {FIN_NOV_BREAKDOWN_CODES.map((c) => (
                                                              <th key={c} className="p-2 text-right">{c}</th>
                                                            ))}
                                                            <th className="p-2 text-right">Otr.</th>
                                                            <th className="p-2 text-right">EV</th>
                                                            <th className="p-2 text-right">FT</th>
                                                            <th className="p-2 text-right">Extra</th>
                                                            <th className="p-2 text-right">F</th>
                                                            <th className="p-2 text-right">RET</th>
                                                            <th className="p-2 text-right">REF</th>
                                                            <th className="p-2 text-right">Σ</th>
                                                            <th className="p-2 text-right pr-3">Consumo</th>
                                                          </tr>
                                                        </thead>
                                                        <tbody>
                                                          {obj.guards.map((g, gi) => (
                                                            <tr key={g.employeeId} className={`border-t border-slate-100 dark:border-slate-700 ${gi % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-900/40'}`}>
                                                              <td className="p-2 font-bold">{empNameById[g.employeeId] || g.name}</td>
                                                              <td className="p-2 text-right tabular-nums">{finPlanHours(g, finHoursMode).toLocaleString('es-AR')}</td>
                                                              {FIN_NOV_BREAKDOWN_CODES.map((c) => (
                                                                <td key={c} className="p-2 text-right tabular-nums">{finGuardNovCode(g, c) === 0 ? '—' : finGuardNovCode(g, c).toLocaleString('es-AR')}</td>
                                                              ))}
                                                              <td className="p-2 text-right tabular-nums">{finGuardNovOtros(g) === 0 ? '—' : finGuardNovOtros(g).toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{g.hsEv === 0 ? '—' : g.hsEv.toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{g.hsFt === 0 ? '—' : g.hsFt.toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{(g.hsExtra + g.hsOps) === 0 ? '—' : (g.hsExtra + g.hsOps).toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{g.hsFranco === 0 ? '—' : g.hsFranco.toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{g.hsRet === 0 ? '—' : g.hsRet.toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums">{g.hsDespliegue === 0 ? '—' : g.hsDespliegue.toLocaleString('es-AR')}</td>
                                                              <td className="p-2 text-right tabular-nums font-bold">{finSumadasHours(g) === 0 ? '—' : finSumadasHours(g).toLocaleString('es-AR')}</td>
                                                              <td className="p-2 pr-3 text-right tabular-nums font-black">{finGuardConsumo(g, finHoursMode).toLocaleString('es-AR')}</td>
                                                            </tr>
                                                          ))}
                                                        </tbody>
                                                      </table>
                                                    </div>
                                                  </td>
                                                </tr>
                                              )}
                                            </React.Fragment>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="sticky bottom-0">
                        <tr className="bg-slate-800 text-white text-xs font-black">
                          <td className="sticky left-0 z-10 bg-slate-800 p-3">Total empresa · {fin.clientes} clientes</td>
                          <td className="p-3 text-right tabular-nums">{fin.objetivos}</td>
                          <td className="p-3 text-right tabular-nums">{fin.slaHours.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{finPlanHours(fin, finHoursMode).toLocaleString('es-AR')}</td>
                          {FIN_NOV_BREAKDOWN_CODES.map((c) => (
                            <td key={c} className="p-3 text-right tabular-nums">{finNovCode(fin.novedades, c).toLocaleString('es-AR')}</td>
                          ))}
                          <td className="p-3 text-right tabular-nums">{finNovOtros(fin.novedades).toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsEv.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsFt.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{(fin.hsExtra + fin.hsOps).toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsFranco.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsRet.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsDespliegue.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{finSumadasHours(fin).toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsConsumo.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsVacante.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-right tabular-nums">{fin.guardias}</td>
                          <td className="p-3 text-right tabular-nums">{fin.hsConsumoPorGuardia.toLocaleString('es-AR')}</td>
                          <td className={`p-3 pr-4 text-right tabular-nums ${fin.deltaVsSla > 4 ? 'text-rose-300' : fin.deltaVsSla < -4 ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {fin.deltaVsSla > 0 ? '+' : ''}{fin.deltaVsSla.toLocaleString('es-AR')}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {activeTab === 'informe' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <p className="text-[11px] text-slate-500 max-w-2xl leading-relaxed">
                  Lectura gerencial de <strong>{periodRange.labelShort}</strong>: vendido, plan, fichado y ausentismo real.
                  {informe.bolsaModo === 'sin_indice'
                    ? ` Bolsa = techo 200×N sin índice (${informe.bolsaLookbackLabel || '3 meses previos'} sin historial de ausencias). No es capacidad realista.`
                    : ` La bolsa no es plantel × 200 como promedio: 200 hs es el techo. Capacidad = techo × (1 − índice ${informe.bolsaLookbackLabel || '3m'}).`}
                  {' '}Jornada de referencia (viabilidad) = {CCT_HS_MENSUAL} hs; no se mezcla con el techo 200.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                    <span className="text-[9px] font-black uppercase text-slate-400">Valor hora $</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={valorHoraBasica || ''}
                      onChange={(e) => setValorHoraBasica(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-24 text-xs font-black text-right bg-transparent text-slate-700 dark:text-white outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void exportInforme()}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase"
                  >
                    <FileSpreadsheet size={13}/> Exportar Excel
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard icon={Users} color="#0891b2" label="Dotación activa" value={informe.dotacionActiva} subtext="Legajos activos"/>
                <KpiCard icon={Target} color="#4f46e5" label="Horas vendidas" value={informe.hsVendidas.toLocaleString('es-AR')} unit="hs" subtext="SLA / contrato"/>
                <KpiCard icon={Clock} color="#6366f1" label="Horas planificadas" value={informe.hsPlanificadas.toLocaleString('es-AR')} unit="hs" subtext="Malla crono"/>
                <KpiCard icon={CheckCircle} color="#059669" label="Horas realizadas" value={informe.hsRealizadas.toLocaleString('es-AR')} unit="hs"
                  subtext={informe.hsPendientesFichada > 0 ? `${informe.hsPendientesFichada.toLocaleString('es-AR')} hs sin fichar` : 'Presencia / cierre'}/>
                <KpiCard icon={Wallet} color="#7c3aed" label="Bolsa disponible" value={informe.bolsaDisponible.toLocaleString('es-AR')} unit="hs"
                  subtext={`Inicial ${informe.bolsaInicial.toLocaleString('es-AR')} · techo ${informe.bolsaTecho.toLocaleString('es-AR')} · índice 3m ${informe.bolsaIndicePct}% · ${informe.bolsaHsEfectivasGuardia} hs/g`}/>
                <KpiCard icon={Activity} color={informe.coberturaEfectivaPct >= 95 ? '#059669' : informe.coberturaEfectivaPct >= 85 ? '#d97706' : '#dc2626'}
                  label="Cobertura operativa" value={`${informe.coberturaEfectivaPct}%`}
                  subtext={`Plan ${informe.coberturaPlanPct}% · extras ${informe.desvioExtras.toLocaleString('es-AR')} hs`}
                  alert={informe.coberturaEfectivaPct < 90}/>
              </div>

              {activeTab === 'informe' && !loadTurnos && informeSeries.length > 0 && (
                <SectionCard
                  title={`Evolución · ${periodRange.labelShort} · ${informeSeriesMeta.bucket === 'hour' ? 'por hora' : informeSeriesMeta.bucket === 'day' ? 'por día' : informeSeriesMeta.bucket === 'week' ? 'por semana' : 'por mes'}`}
                  icon={TrendingUp}
                  loading={loadTurnos}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3">
                    <LegendRow items={[
                      { color: '#4f46e5', label: 'Vendidas' },
                      { color: '#0284c7', label: 'Planificadas' },
                      { color: '#059669', label: 'Realizadas' },
                      { color: '#ea580c', label: 'Extras / FT' },
                      { color: '#f59e0b', label: 'Vacante' },
                    ]}/>
                    <div className="flex gap-1">
                      {([
                        { id: 'area' as const, label: 'Áreas' },
                        { id: 'line' as const, label: 'Líneas' },
                      ]).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setInformeChartType(opt.id)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                            informeChartType === opt.id
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 pb-5 pt-1">
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={informeSeries} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                        <defs>
                          <linearGradient id="infVend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.28}/>
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02}/>
                          </linearGradient>
                          <linearGradient id="infPlan" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.22}/>
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02}/>
                          </linearGradient>
                          <linearGradient id="infReal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#059669" stopOpacity={0.28}/>
                            <stop offset="100%" stopColor="#059669" stopOpacity={0.02}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="label" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} interval={informeSeries.length > 20 ? 2 : 0}/>
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        {informeSeriesMeta.bucket === 'hour' && informe.hsVendidas > 0 && (
                          <ReferenceLine
                            y={Math.round(informe.hsVendidas / 24)}
                            stroke="#4f46e5"
                            strokeDasharray="5 4"
                            label={{ value: 'SLA/h', fontSize: 9, fill: '#4f46e5', position: 'right' }}
                          />
                        )}
                        {informeChartType === 'area' ? (
                          <>
                            {informeSeriesMeta.bucket !== 'hour' && (
                              <Area type="monotone" dataKey="Vendidas" name="Vendidas" stroke="#4f46e5" strokeWidth={2} fill="url(#infVend)" />
                            )}
                            <Area type="monotone" dataKey="Realizadas" name="Realizadas" stroke="#059669" strokeWidth={2} fill="url(#infReal)" />
                            <Line type="monotone" dataKey="Plan" name="Planificadas" stroke="#0284c7" strokeWidth={3} dot={{ r: 3, fill: '#0284c7', strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="Extras" name="Extras / FT" stroke="#ea580c" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Vacante" name="Vacante" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                          </>
                        ) : (
                          <>
                            {informeSeriesMeta.bucket !== 'hour' && (
                              <Line type="monotone" dataKey="Vendidas" name="Vendidas" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3, fill: '#4f46e5', strokeWidth: 0 }} />
                            )}
                            <Line type="monotone" dataKey="Plan" name="Planificadas" stroke="#0284c7" strokeWidth={3} dot={{ r: 3.5, fill: '#0284c7', strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="Realizadas" name="Realizadas" stroke="#059669" strokeWidth={2.5} dot={{ r: 3, fill: '#059669', strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="Extras" name="Extras / FT" stroke="#ea580c" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Vacante" name="Vacante" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                          </>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              <SectionCard title={`1. Cuadro de balance de horas · ${periodRange.labelShort}`} icon={Scale} loading={loadTurnos}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-4">Concepto</th>
                        <th className="p-4 text-center">Horas</th>
                        <th className="p-4">Observaciones / impacto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {informe.balance.map((row) => (
                        <tr key={row.concepto} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/20">
                          <td className="p-4 font-bold text-slate-700 dark:text-white text-xs uppercase">{row.concepto}</td>
                          <td className={`p-4 text-center font-black ${row.horas < 0 ? 'text-rose-600' : 'text-slate-800 dark:text-white'}`}>
                            {row.concepto.startsWith('Diferencia') && row.horas > 0 ? '+' : ''}{row.horas.toLocaleString('es-AR')}
                          </td>
                          <td className="p-4 text-[11px] text-slate-500">{row.observacion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {activeTab === 'informe' && (
              <SectionCard title="2. Novedades e incidencias (CCT SUVICO)" icon={AlertTriangle} loading={loadAus}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-4">Rubro</th>
                        <th className="p-4 text-center">Código</th>
                        <th className="p-4 text-center">Eventos</th>
                        <th className="p-4 text-center">Horas</th>
                        <th className="p-4">Impacto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {informe.novedades.map((row) => (
                        <tr key={row.rubro}>
                          <td className="p-4 font-bold text-slate-700 dark:text-white text-xs">{row.rubro}</td>
                          <td className="p-4 text-center">
                            <span className="px-1.5 py-0.5 rounded font-black text-[8px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{row.code}</span>
                          </td>
                          <td className="p-4 text-center text-slate-500">{row.eventos}</td>
                          <td className="p-4 text-center font-black text-rose-600">{row.horas > 0 ? row.horas.toLocaleString('es-AR') : '—'}</td>
                          <td className="p-4 text-[11px] text-slate-500">{row.impacto}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-5 pb-4 text-[10px] text-slate-400">
                  Ausencias cubiertas con FT/ops: <strong className="text-slate-600 dark:text-slate-300">{informe.hsAusenciasCubiertas.toLocaleString('es-AR')} hs</strong>
                  {' · '}Vacante de malla: <strong className="text-amber-600">{informe.hsVacante.toLocaleString('es-AR')} hs</strong>
                </p>
              </SectionCard>
              )}

              <SectionCard title="3. Costo real en horas (y estimado en $)" icon={Wallet}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5">
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-3">
                    <p className="text-[9px] font-black uppercase text-slate-400">Normales (100%)</p>
                    <p className="text-lg font-black text-slate-800 dark:text-white">{informe.hsNormales.toLocaleString('es-AR')} hs</p>
                    {costoEstimado && <p className="text-[10px] font-bold text-emerald-600">{formatArs(costoEstimado.normales)}</p>}
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-3">
                    <p className="text-[9px] font-black uppercase text-slate-400">Extras / ext+adel (50%)</p>
                    <p className="text-lg font-black text-violet-600">{informe.hsExtras50.toLocaleString('es-AR')} hs</p>
                    {costoEstimado && <p className="text-[10px] font-bold text-violet-600">{formatArs(costoEstimado.extras50)}</p>}
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-3">
                    <p className="text-[9px] font-black uppercase text-slate-400">FT (100%)</p>
                    <p className="text-lg font-black text-orange-600">{informe.hsFT100.toLocaleString('es-AR')} hs</p>
                    {costoEstimado && <p className="text-[10px] font-bold text-orange-600">{formatArs(costoEstimado.ft100)}</p>}
                  </div>
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-3">
                    <p className="text-[9px] font-black uppercase text-indigo-400">Costo cobertura ausentismo</p>
                    <p className="text-lg font-black text-indigo-700 dark:text-indigo-300">
                      {(informe.hsAusencias + informe.hsFT100).toLocaleString('es-AR')} hs
                    </p>
                    <p className="text-[10px] text-slate-500">No trabajadas + FT para cubrir</p>
                    {costoEstimado && <p className="text-[10px] font-bold text-indigo-600">{formatArs(costoEstimado.ausentismo)}</p>}
                  </div>
                </div>
                <p className="px-5 pb-4 text-[10px] text-slate-400">
                  {costoEstimado
                    ? <>Estimación total (normales + extra 50% + FT 100%): <strong className="text-slate-600 dark:text-slate-200">{formatArs(costoEstimado.total)}</strong>. No reemplaza la liquidación CCT (bolsa 200 hs por legajo).</>
                    : 'Cargá un valor hora básica para ver el estimado en pesos. Sin tarifa única en el sistema: el $ es what-if, no liquidación.'}
                </p>
              </SectionCard>

              {activeTab === 'informe' && (
              <>
              <SectionCard title="4. Cobertura y calidad de servicio" icon={Target}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5">
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-4 text-center">
                    <p className="text-3xl font-black text-indigo-600">{informe.coberturaPlanPct}%</p>
                    <p className="text-[9px] font-black uppercase text-slate-400 mt-1">Cobertura planificada</p>
                    <p className="text-[10px] text-slate-400 mt-1">Hs plan / hs vendidas</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-4 text-center">
                    <p className={`text-3xl font-black ${informe.coberturaEfectivaPct >= 95 ? 'text-emerald-600' : informe.coberturaEfectivaPct >= 85 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {informe.coberturaEfectivaPct}%
                    </p>
                    <p className="text-[9px] font-black uppercase text-slate-400 mt-1">Cobertura efectiva</p>
                    <p className="text-[10px] text-slate-400 mt-1">(Realizadas o resultante) / vendidas</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-4 text-center">
                    <p className={`text-3xl font-black ${informe.hsVacante > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {informe.hsVacante.toLocaleString('es-AR')}
                    </p>
                    <p className="text-[9px] font-black uppercase text-slate-400 mt-1">Hs acéfalas</p>
                    <p className="text-[10px] text-slate-400 mt-1">Vacantes de malla sin titular</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="5. Conclusiones y propuestas" icon={FileText}>
                <div className="p-5 space-y-3">
                  {informe.conclusiones.map((c) => (
                    <div
                      key={c.titulo}
                      className={`rounded-xl border p-4 ${
                        c.tipo === 'risk'
                          ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                          : c.tipo === 'warn'
                            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                            : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      <p className={`text-xs font-black uppercase mb-1 ${
                        c.tipo === 'risk' ? 'text-rose-700 dark:text-rose-300' : c.tipo === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
                      }`}>{c.titulo}</p>
                      <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">{c.texto}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
              </>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: CAPACIDAD
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'capacidad' && (
            <div className="space-y-4">

              {/* Donut cobertura + stats */}
              {!loadTurnos && theoretical.totalHours > 0 && (
                <SectionCard title={`Distribución de horas · ${periodRange.labelShort}`} icon={Activity} loading={loadTurnos}>
                  <div className="flex flex-col md:flex-row items-center gap-0 md:gap-8 p-6">
                    {/* Donut */}
                    <div className="relative shrink-0">
                      <PieChart width={200} height={200}>
                        <Pie data={coverageDonut} cx={100} cy={100}
                          innerRadius={62} outerRadius={88}
                          paddingAngle={3} dataKey="value" stroke="none">
                          {coverageDonut.map((e,i) => <Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <DonutCenter cx={100} cy={100} value={`${coveragePct}%`} label="cobertura" color="#4f46e5"/>
                        <Tooltip content={<ChartTooltip/>}/>
                      </PieChart>
                    </div>
                    {/* Stats */}
                    <div className="flex-1 space-y-3 w-full">
                      {coverageDonut.map(d => (
                        <div key={d.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }}/>
                              <span className="font-bold text-slate-600 dark:text-slate-300">{d.name}</span>
                            </div>
                            <span className="font-black text-slate-700 dark:text-white">
                              {d.value.toLocaleString('es-AR')} hs
                              <span className="text-slate-400 font-medium ml-1">
                                ({theoretical.totalHours>0?Math.round(d.value/theoretical.totalHours*100):0}%)
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ background: d.color, width:`${theoretical.totalHours>0?Math.round(d.value/theoretical.totalHours*100):0}%` }}/>
                          </div>
                        </div>
                      ))}
                      <p className="text-[9px] text-slate-400 pt-1">Hs vendidas (SLA): <strong className="text-slate-600 dark:text-slate-300">{theoretical.totalHours.toLocaleString('es-AR')} hs</strong> en {theoretical.active.length} servicios vigentes</p>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Barras por servicio */}
              {capacidadBars.length > 0 && (
                <SectionCard title={`Horas por servicio · ${periodRange.labelShort}`} icon={BarChart3} loading={loadTurnos}>
                  <LegendRow items={[
                    { color:'#4f46e5', label:'Hs teóricas' },
                    { color:'#059669', label:'Hs programadas' },
                    { color:'#f59e0b', label:'Hs vacantes' },
                  ]}/>
                  <div className="p-5 pt-2">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={capacidadBars} margin={{ top:4, right:8, left:-16, bottom:52 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="name" tick={{ fontSize:9, fontWeight:700, fill:'#94a3b8' }} angle={-35} textAnchor="end" interval={0}/>
                        <YAxis tick={{ fontSize:9, fill:'#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="Teóricas"    fill="#4f46e5" radius={[4,4,0,0]} maxBarSize={28}/>
                        <Bar dataKey="Programadas" fill="#059669" radius={[4,4,0,0]} maxBarSize={28}/>
                        <Bar dataKey="Vacantes"    fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={28}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {/* Distribución por duración de turno */}
              {!loadTurnos && shiftDurationBreakdown.length > 0 && (
                <SectionCard title={`Turnos planificados por duración · ${periodRange.labelShort}`} icon={Clock} loading={loadTurnos}>
                  <div className="p-5 space-y-4">
                    <p className="text-[10px] text-slate-400 font-medium -mt-1">
                      Clic en una tarjeta para ver desglose por código. Los KPIs de cobertura SLA excluyen RET, REF y ESC; esos turnos aparecen abajo en estadística de despliegue y en el drill-down marcados como «no cobertura».
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {shiftDurationBreakdown.map(d => {
                        const progPct = d.count > 0 ? Math.round((d.count - d.vacant) / d.count * 100) : 0;
                        const isSelected = expandedDuration === d.dur;
                        const color =
                          d.dur <= 8  ? '#4f46e5' :
                          d.dur <= 12 ? '#7c3aed' :
                                        '#0891b2';
                        return (
                          <button
                            key={d.dur}
                            type="button"
                            onClick={() => {
                              setExpandedDurationCode(null);
                              setExpandedDuration(isSelected ? null : d.dur);
                            }}
                            className={`text-left bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 border flex flex-col gap-1.5 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                              isSelected
                                ? 'border-indigo-400 ring-2 ring-indigo-300/60 shadow-md'
                                : 'border-slate-100 dark:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xl font-black" style={{ color }}>{d.dur}h</span>
                              <div className="flex gap-0.5 flex-wrap justify-end max-w-[80px]">
                                {d.codes.map(c => (
                                  <span key={c} className={`text-[8px] font-black px-1 py-0.5 rounded ${codeBadgeClass(c)}`}>{c}</span>
                                ))}
                              </div>
                            </div>
                            <p className="text-xl font-black text-slate-800 dark:text-white leading-none">{d.count.toLocaleString('es-AR')}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase leading-tight">
                              turnos · {Math.round(d.coverageHours).toLocaleString('es-AR')} hs cobertura
                              {d.hours > d.coverageHours && (
                                <span className="text-orange-600 normal-case"> · +{(d.hours - d.coverageHours).toLocaleString('es-AR')} hs despliegue</span>
                              )}
                            </p>
                            {d.vacant > 0 && (
                              <p className="text-[9px] font-black text-amber-600">{d.vacant} vacantes ({100-progPct}%)</p>
                            )}
                            <div className="h-1 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden mt-auto">
                              <div className="h-full rounded-full" style={{ width:`${progPct}%`, background: color }}/>
                            </div>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDurationCode(null);
                          setExpandedDuration(expandedDuration === 'all' ? null : 'all');
                        }}
                        className={`text-left bg-slate-900 dark:bg-slate-900 rounded-xl p-3 flex flex-col gap-1.5 col-span-2 sm:col-span-1 border transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                          expandedDuration === 'all' ? 'border-indigo-400 ring-2 ring-indigo-300/40' : 'border-transparent'
                        }`}
                      >
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Total</p>
                        <p className="text-xl font-black text-white leading-none">
                          {shiftDurationBreakdown.reduce((s,d) => s+d.count, 0).toLocaleString('es-AR')}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">turnos programados</p>
                        <p className="text-[9px] font-black text-indigo-400">
                          {shiftDurationBreakdown.reduce((s,d) => s+d.coverageHours, 0).toLocaleString('es-AR')} hs cobertura SLA
                        </p>
                      </button>
                    </div>

                    {durationDetail && (
                      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 animate-in slide-in-from-top-2">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">{durationDetail.label}</p>
                            <p className="text-sm font-black text-slate-800 dark:text-white">
                              {durationDetail.count.toLocaleString('es-AR')} turnos · {durationDetail.hours.toLocaleString('es-AR')} hs
                              {durationDetail.coverageHours > 0 && (
                                <span className="text-emerald-600 font-bold text-xs ml-2">
                                  ({durationDetail.coverageHours.toLocaleString('es-AR')} hs cobertura SLA)
                                </span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setExpandedDuration(null); setExpandedDurationCode(null); }}
                            className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white/60"
                          >
                            Cerrar
                          </button>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                              <Activity size={10}/> Por código de turno
                            </p>
                            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                              {durationDetail.codeRows.map((row) => {
                                const isCodeSelected = expandedDurationCode === row.code;
                                const progPct = row.count > 0 ? Math.round(((row.count - row.vacant) / row.count) * 100) : 0;
                                return (
                                  <button
                                    key={row.code}
                                    type="button"
                                    onClick={() => setExpandedDurationCode(isCodeSelected ? null : row.code)}
                                    className={`w-full flex items-center gap-2.5 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 shadow-sm text-left transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer ${
                                      isCodeSelected ? 'ring-2 ring-indigo-400' : ''
                                    }`}
                                  >
                                    <span className={`w-9 text-center text-[9px] font-black rounded-lg px-1 py-0.5 shrink-0 ${codeBadgeClass(row.code)}`}>
                                      {row.code}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex justify-between text-[10px] mb-1 gap-2">
                                        <span className="font-bold text-slate-600 dark:text-slate-300">
                                          {row.count.toLocaleString('es-AR')} turnos
                                          {row.vacant > 0 && <span className="text-amber-600"> · {row.vacant} vac</span>}
                                        </span>
                                        <span className="text-slate-400 font-medium shrink-0">{row.hours.toLocaleString('es-AR')} hs</span>
                                      </div>
                                      <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${progPct === 100 ? 'bg-emerald-500' : progPct >= 70 ? 'bg-indigo-500' : 'bg-rose-500'}`}
                                          style={{ width: `${progPct}%` }}
                                        />
                                      </div>
                                      {!row.countsAsCoverage && row.count > 0 && (
                                        <p className="text-[8px] text-orange-600 font-bold mt-0.5">Estadística / liquidación — no cobertura SLA</p>
                                      )}
                                    </div>
                                    <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${isCodeSelected ? 'rotate-180' : ''}`}/>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                              <Target size={10}/>
                              {expandedDurationCode
                                ? `Objetivos · código ${expandedDurationCode}`
                                : 'Por objetivo (clic en un código)'}
                            </p>
                            {!expandedDurationCode ? (
                              <p className="text-[10px] text-slate-400 italic py-6 text-center">
                                Elegí M, T, N, D12, N12, REF o ESC para ver en qué servicios aparecen.
                              </p>
                            ) : durationObjectiveRows.length === 0 ? (
                              <p className="text-[10px] text-slate-400 italic py-6 text-center">Sin turnos de este código en el período.</p>
                            ) : (
                              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                {durationObjectiveRows.map((obj) => (
                                  <div key={obj.id} className="flex items-center gap-2.5 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 shadow-sm">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[10px] font-black text-slate-700 dark:text-white uppercase truncate">{obj.name}</p>
                                      <p className="text-[9px] text-slate-400 font-bold truncate">{obj.client}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-[10px] font-black text-indigo-600">{obj.row.count} turnos</p>
                                      <p className="text-[9px] text-slate-400">{obj.row.hours.toLocaleString('es-AR')} hs</p>
                                      {obj.row.vacant > 0 && (
                                        <p className="text-[8px] font-bold text-amber-600">{obj.row.vacant} vac</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* Tabla */}
              <SectionCard title={`Servicios activos · ${periodRange.labelShort}`} icon={BarChart3} loading={loadTurnos}>
                {theoretical.active.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <BarChart3 size={36} className="mx-auto mb-2 opacity-20"/>
                    <p className="text-sm font-bold">Sin servicios activos en este período</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-4">Cliente / Objetivo</th>
                          <th className="p-4 text-center">Puestos</th>
                          <th className="p-4 text-center text-indigo-600">Hs teóricas</th>
                          <th className="p-4 text-center">G. mín.</th>
                          <th className="p-4 text-center">Hs prog.</th>
                          <th className="p-4 text-center">Cobertura</th>
                          <th className="p-4 text-center text-amber-600">Hs vacantes</th>
                          <th className="p-4 text-center text-violet-600" title={`Horas sobrantes del último guardia (G. mín. × ${guardQuotaHs} − Hs teóricas). Es el margen disponible para cubrir francos, licencias y reemplazos sin contratar otro guardia.`}>Colchón hs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {theoretical.active.map(srv => {
                          const srvCanon = resolveCanonicalObjectiveId(srv, objectiveAliasesFromServices)
                            || String(srv.objectiveId ?? '').trim();
                          const obj = actual.byObjective.find(o =>
                            o.id === srvCanon
                            || o.id === srv.objectiveId
                            || o.name === srv.objectiveName,
                          );
                          const scheduled = obj?.scheduled??0, vacant = obj?.vacant??0;
                          const cov = srv.monthHours>0 ? Math.round(scheduled/srv.monthHours*100) : 0;
                          return (
                            <tr key={srv.id} className="hover:bg-indigo-50/20 dark:hover:bg-indigo-900/10">
                              <td className="p-4">
                                <p className="font-black text-xs text-slate-800 dark:text-white uppercase">{srv.clientName}</p>
                                <p className="text-xs text-indigo-500 font-bold">{srv.objectiveName}</p>
                              </td>
                              <td className="p-4 text-center text-slate-500">{(srv.positions||[]).length}</td>
                              <td className="p-4 text-center font-black text-indigo-600">{srv.monthHours.toLocaleString('es-AR')}</td>
                              <td className="p-4 text-center font-black text-slate-700 dark:text-white">{srv.guardsNeeded}</td>
                              <td className="p-4 text-center font-bold text-slate-600 dark:text-slate-300">
                                {loadTurnos ? <Loader2 size={13} className="animate-spin mx-auto text-slate-300"/> : Math.round(scheduled).toLocaleString('es-AR')}
                              </td>
                              <td className="p-4">
                                {loadTurnos ? <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full"/> : (
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden min-w-[60px]">
                                      <div className={`h-full rounded-full ${cov>=80?'bg-emerald-500':cov>=50?'bg-amber-500':'bg-rose-500'}`} style={{ width:`${Math.min(cov,100)}%` }}/>
                                    </div>
                                    <span className={`text-[10px] font-black w-9 text-right shrink-0 ${cov>=80?'text-emerald-600':cov>=50?'text-amber-600':'text-rose-600'}`}>{cov}%</span>
                                  </div>
                                )}
                              </td>
                              <td className="p-4 text-center">
                                {!loadTurnos && (vacant>0
                                  ? <span className="text-[10px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">{Math.round(vacant)} hs</span>
                                  : <span className="text-slate-300 dark:text-slate-600">—</span>)}
                              </td>
                              <td className="p-4 text-center">
                                {srv.surplusHs > 0
                                  ? <span className="text-[10px] font-black text-violet-600 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-full">{srv.surplusHs} hs</span>
                                  : <span className="text-slate-300 dark:text-slate-600">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-900 text-white font-black text-xs uppercase">
                        <tr>
                          <td className="p-4 text-right" colSpan={2}>Total</td>
                          <td className="p-4 text-center text-emerald-400">{theoretical.totalHours.toLocaleString('es-AR')}</td>
                          <td className="p-4 text-center">{theoretical.totalGuards}</td>
                          <td className="p-4 text-center">{actual.scheduledHours.toLocaleString('es-AR')}</td>
                          <td className="p-4 text-center">{coveragePct}%</td>
                          <td className="p-4 text-center text-amber-400">{actual.vacantHours.toLocaleString('es-AR')}</td>
                          <td className="p-4 text-center text-violet-300">{theoretical.totalSurplus.toLocaleString('es-AR')} hs</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: GUARDIAS
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'guardias' && (
            <div className="space-y-4">

              {/* Donut bandas + RadialBar utilización */}
              {!loadTurnos && actual.byGuard.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Donut distribución de bandas */}
                  <SectionCard title="Distribución de carga" icon={Users}>
                    <div className="flex flex-col items-center py-4 gap-2">
                      <PieChart width={200} height={200}>
                        <Pie data={bandDonut} cx={100} cy={100}
                          innerRadius={58} outerRadius={88}
                          paddingAngle={4} dataKey="value" stroke="none">
                          {bandDonut.map((e,i) => <Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <DonutCenter cx={100} cy={100}
                          value={actual.byGuard.length}
                          label="guardias"
                          color="#4f46e5"/>
                        <Tooltip content={<ChartTooltip/>}/>
                      </PieChart>
                      <div className="flex gap-4 flex-wrap justify-center">
                        {bandDonut.map(b => (
                          <div key={b.name} className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }}/>
                            <span className="text-[10px] font-bold text-slate-500">{b.name}: <strong style={{ color: b.color }}>{b.value}</strong></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </SectionCard>

                  {/* RadialBar top guardias */}
                  <SectionCard title={`Top ${radialGuards.length} guardias por utilización`} icon={Activity}>
                    <div className="px-4 py-3">
                      <p className="text-[9px] text-slate-400 font-bold mb-2 uppercase">% del límite CCT 200h/mes (cobertura + RET/REF/ESC liquidables)</p>
                      <ResponsiveContainer width="100%" height={Math.max(160, radialGuards.length * 22)}>
                        <RadialBarChart cx="50%" cy="50%"
                          innerRadius="15%" outerRadius="95%"
                          data={radialGuards} barSize={14}>
                          <RadialBar
                            dataKey="pct"
                            background={{ fill: '#f1f5f9' }}
                            label={{ position:'insideStart', fill:'#fff', fontSize:9, fontWeight:700 }}
                          />
                          <Tooltip content={({ active, payload }) => {
                            if (!active||!payload?.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-3 text-xs">
                                <p className="font-black text-slate-700 dark:text-white">{d.name}</p>
                                <p style={{ color: d.fill }} className="font-bold">{d.pct}% del límite ({Math.round(d.pct*2)} hs)</p>
                              </div>
                            );
                          }}/>
                        </RadialBarChart>
                      </ResponsiveContainer>
                      {/* Leyenda nombres */}
                      <div className="space-y-1 mt-2">
                        {[...radialGuards].reverse().map((g, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.fill }}/>
                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate flex-1">{g.name}</span>
                            <span className="text-[10px] font-black shrink-0" style={{ color: g.fill }}>{g.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* Barras horizontales */}
              {!loadTurnos && guardBars.length > 0 && (
                <SectionCard title="Horas programadas por guardia" icon={BarChart3}>
                  <LegendRow items={[
                    { color:'#059669', label:'< 160 hs (margen)' },
                    { color:'#d97706', label:'160–200 hs (capacidad)' },
                    { color:'#dc2626', label:'> 200 hs (extras)' },
                  ]}/>
                  <div className="px-5 pb-5 pt-2">
                    <ResponsiveContainer width="100%" height={Math.max(160, guardBars.length*30)}>
                      <BarChart layout="vertical" data={guardBars} margin={{ top:4, right:60, left:4, bottom:4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false}/>
                        <XAxis type="number" domain={[0,guardMaxH]} tick={{ fontSize:9, fill:'#94a3b8' }}/>
                        <YAxis type="category" dataKey="name" tick={{ fontSize:10, fontWeight:700, fill:'#64748b' }} width={130}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <ReferenceLine x={160} stroke="#d97706" strokeDasharray="4 4" label={{ value:'160h', fontSize:9, fill:'#d97706', position:'top' }}/>
                        <ReferenceLine x={200} stroke="#dc2626" strokeDasharray="4 4" label={{ value:'200h', fontSize:9, fill:'#dc2626', position:'top' }}/>
                        <Bar dataKey="horas" radius={[0,4,4,0]} maxBarSize={22}>
                          {guardBars.map((e,i) => <Cell key={i} fill={e.horas>200?'#dc2626':e.horas>=160?'#d97706':'#059669'}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {/* Tabla detalle */}
              <SectionCard title={`Utilización por guardia · ${periodRange.labelShort}`} icon={Users} loading={loadTurnos}>
                {!loadTurnos && actual.byGuard.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <Users size={36} className="mx-auto mb-2 opacity-20"/>
                    <p className="text-sm font-bold">Sin turnos programados en este período</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-4">Guardia</th>
                          <th className="p-4 text-center">Turnos</th>
                          <th className="p-4 text-center text-indigo-600">Horas</th>
                          <th className="p-4">% límite 200h</th>
                          <th className="p-4 text-center">Hs disponibles</th>
                          <th className="p-4 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {actual.byGuard.map(g => {
                          const pct    = Math.round(g.hours/200*100);
                          const avail  = Math.round(Math.max(0, 200-g.hours));
                          const status = g.hours>200?'red':g.hours>=160?'amber':'green';
                          const colors = { red:'text-rose-600 bg-rose-100 dark:bg-rose-900/30', amber:'text-amber-700 bg-amber-100 dark:bg-amber-900/30', green:'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30' };
                          const bars   = { red:'bg-rose-500', amber:'bg-amber-500', green:'bg-emerald-500' };
                          return (
                            <tr key={g.id} className="hover:bg-indigo-50/20 dark:hover:bg-indigo-900/10">
                              <td className="p-4 font-bold text-slate-700 dark:text-white uppercase">{g.name}</td>
                              <td className="p-4 text-center text-slate-500">{g.shifts}</td>
                              <td className="p-4 text-center font-black text-indigo-600 text-lg">{Math.round(g.hours)}</td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden min-w-[80px]">
                                    <div className={`h-full rounded-full ${bars[status]}`} style={{ width:`${Math.min(pct,100)}%` }}/>
                                  </div>
                                  <span className={`text-[10px] font-black w-9 text-right shrink-0 ${status==='red'?'text-rose-600':status==='amber'?'text-amber-600':'text-emerald-600'}`}>{pct}%</span>
                                </div>
                              </td>
                              <td className="p-4 text-center">
                                {avail>0
                                  ? <span className="text-[10px] font-black text-emerald-600">{avail} hs</span>
                                  : <span className="text-[10px] font-black text-rose-500">+{Math.round(g.hours-200)} extra</span>}
                              </td>
                              <td className="p-4 text-center">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${colors[status]}`}>
                                  {status==='red'?'EN EXTRAS':status==='amber'?'CAPACIDAD':'CON MARGEN'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              {/* Sin turnos */}
              {!loadTurnos && (() => {
                const conTurnoOperativo = new Set(actual.byGuard.map(g => g.id));
                const conFrancoOLicencia = new Set<string>();
                turnos.forEach((t: any) => {
                  const eid = t.employeeId;
                  if (!eid || eid === 'VACANTE') return;
                  const code = String(t.code || '').trim().toUpperCase();
                  if (
                    FRANCO_SHIFT_CODES.has(code) ||
                    LICENCIA_SHIFT_CODES.has(code) ||
                    (t.isFranco === true && !LICENCIA_SHIFT_CODES.has(code))
                  ) {
                    conFrancoOLicencia.add(eid);
                  }
                });
                const pStart = new Date(periodRange.start);
                const pEnd = new Date(periodRange.end);
                ausencias.forEach((a: any) => {
                  if (!a.employeeId) return;
                  if (!ausenciaCuentaNoDisponible(a)) return;
                  if (!ausenciaSolapaPeriodo(a, pStart, pEnd)) return;
                  conFrancoOLicencia.add(a.employeeId);
                });
                const free = employees.filter(
                  e => !conTurnoOperativo.has(e.id) && !conFrancoOLicencia.has(e.id)
                );
                if (!free.length) return null;
                return (
                  <div className="rounded-xl border shadow-sm p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-3">
                      Guardias sin turnos en el período · disponibles totales ({free.length})
                      <span className="ml-1 normal-case font-medium text-slate-400">
                        (excluye F/FF/FP, licencias planificadas y ausencias activas)
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {free.map(e => (
                        <span key={e.id} className="text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1.5 rounded-lg">
                          {e.lastName ? `${e.lastName}, ${e.firstName}` : e.name||e.id}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: COBERTURA
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'cobertura' && (
            <div className="space-y-4">

              {/* Treemap */}
              {!loadTurnos && treemapData.length > 0 && (
                <SectionCard title="Mapa de cobertura por objetivo" icon={Target}>
                  <div className="px-5 pb-5 pt-3">
                    <div className="flex gap-4 flex-wrap mb-3">
                      {[
                        { color:'#059669', label:'0% vacancia' },
                        { color:'#10b981', label:'1-10%' },
                        { color:'#d97706', label:'11-25%' },
                        { color:'#dc2626', label:'>25%' },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.color }}/>
                          <span className="text-[10px] font-bold text-slate-500">{l.label}</span>
                        </div>
                      ))}
                      <span className="text-[10px] text-slate-400 ml-auto">Tamaño = horas totales</span>
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <Treemap
                        data={treemapData}
                        dataKey="size"
                        aspectRatio={16/9}
                        content={<TreemapTile/>}
                      />
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {/* Barras apiladas */}
              {!loadTurnos && coberturaBars.length > 0 && (
                <SectionCard title={`Horas por objetivo · ${periodRange.labelShort}`} icon={BarChart3} loading={loadTurnos}>
                  <LegendRow items={[
                    { color:'#4f46e5', label:'Programadas' },
                    { color:'#f59e0b', label:'Vacantes' },
                  ]}/>
                  <div className="px-5 pb-5 pt-2">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={coberturaBars} margin={{ top:4, right:8, left:-16, bottom:52 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="name" tick={{ fontSize:9, fontWeight:700, fill:'#94a3b8' }} angle={-40} textAnchor="end" interval={0}/>
                        <YAxis tick={{ fontSize:9, fill:'#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="Programadas" stackId="a" fill="#4f46e5" radius={[0,0,0,0]} maxBarSize={32}/>
                        <Bar dataKey="Vacantes"    stackId="a" fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={32}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {/* Tabla */}
              <SectionCard title={`Cobertura por objetivo · ${periodRange.labelShort}`} icon={Target} loading={loadTurnos}>
                {!loadTurnos && actual.byObjective.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <Target size={36} className="mx-auto mb-2 opacity-20"/>
                    <p className="text-sm font-bold">Sin datos de cobertura en este período</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-4">Objetivo</th>
                          <th className="p-4">Cliente</th>
                          <th className="p-4 text-center text-indigo-600">Hs prog.</th>
                          <th className="p-4 text-center text-amber-600">Hs vacantes</th>
                          <th className="p-4 text-center">Total hs</th>
                          <th className="p-4 text-center">% Vacancia</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {actual.byObjective.map(obj => {
                          const total      = obj.scheduled+obj.vacant;
                          const vacPct     = total>0 ? Math.round(obj.vacant/total*100) : 0;
                          const isExpanded = expandedObjId === obj.id;
                          const det        = actual.byObjDetail.get(obj.id);
                          return (
                            <React.Fragment key={obj.id}>
                              <tr
                                onClick={() => setExpandedObjId(isExpanded ? null : obj.id)}
                                className={`cursor-pointer select-none transition-colors
                                  ${isExpanded
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20'
                                    : vacPct>20
                                      ? 'bg-rose-50/30 dark:bg-rose-900/10 hover:bg-rose-50/60 dark:hover:bg-rose-900/20'
                                      : 'hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10'
                                  }`}>
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform duration-200 ${isExpanded?'rotate-180':''}`}/>
                                    <span className="font-bold text-slate-700 dark:text-white uppercase text-xs">{obj.name}</span>
                                  </div>
                                </td>
                                <td className="p-4 text-slate-500 text-xs font-bold">{obj.client}</td>
                                <td className="p-4 text-center font-black text-indigo-600">{Math.round(obj.scheduled)}</td>
                                <td className="p-4 text-center font-bold text-amber-600">
                                  {obj.vacant>0 ? Math.round(obj.vacant) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                </td>
                                <td className="p-4 text-center text-slate-500">{Math.round(total)}</td>
                                <td className="p-4 text-center">
                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                    vacPct===0?'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    :vacPct<=20?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                    :'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                                    {vacPct}%
                                  </span>
                                </td>
                              </tr>
                              {isExpanded && det && (
                                <tr>
                                  <td colSpan={6} className="p-0">
                                    <div className="bg-indigo-50/60 dark:bg-indigo-900/10 border-b-2 border-indigo-200 dark:border-indigo-700/50 px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-5">

                                      {/* Breakdown por tipo de turno */}
                                      <div>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                                          <Activity size={10}/> Turnos programados por tipo
                                        </p>
                                        {det.byCode.size === 0 ? (
                                          <p className="text-[10px] text-slate-400 italic">Sin datos de turno</p>
                                        ) : (
                                          <div className="space-y-1.5">
                                            {[...det.byCode.entries()]
                                              .sort((a,b) => (b[1].schHours+b[1].vacHours)-(a[1].schHours+a[1].vacHours))
                                              .map(([code, bd]) => {
                                                const hsTotal = bd.schHours + bd.vacHours;
                                                const progPct = hsTotal>0 ? Math.round(bd.schHours/hsTotal*100) : 0;
                                                const codeBg =
                                                  code==='M'   ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                                                  code==='T'   ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400' :
                                                  code==='N'   ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' :
                                                  code==='D12' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                  code==='N12' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' :
                                                  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
                                                return (
                                                  <div key={code} className="flex items-center gap-2.5 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 shadow-sm">
                                                    <span className={`w-9 text-center text-[9px] font-black rounded-lg px-1 py-0.5 shrink-0 ${codeBg}`}>{code}</span>
                                                    <div className="flex-1 min-w-0">
                                                      <div className="flex justify-between text-[10px] mb-1">
                                                        <span className="font-bold text-slate-600 dark:text-slate-300">
                                                          {bd.schCount} prog · <span className="text-amber-600">{bd.vacCount} vac</span>
                                                        </span>
                                                        <span className="text-slate-400 font-medium">{Math.round(hsTotal)} hs</span>
                                                      </div>
                                                      <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full ${progPct===100?'bg-emerald-500':progPct>=70?'bg-indigo-500':'bg-rose-500'}`}
                                                          style={{ width:`${progPct}%` }}/>
                                                      </div>
                                                    </div>
                                                    <span className={`text-[10px] font-black shrink-0 w-10 text-right ${
                                                      progPct===100?'text-emerald-600':progPct>=70?'text-indigo-600':'text-rose-500'}`}>
                                                      {progPct}%
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                          </div>
                                        )}
                                      </div>

                                      {/* Guardias asignados en este objetivo */}
                                      <div>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                                          <Shield size={10}/> Guardias asignados ({det.guards.size})
                                        </p>
                                        {det.guards.size === 0 ? (
                                          <p className="text-[10px] text-slate-400 italic">Sin guardias asignados — todos los turnos son vacantes</p>
                                        ) : (
                                          <div className="space-y-1.5">
                                            {[...det.guards.entries()]
                                              .sort((a,b) => b[1].hours-a[1].hours)
                                              .map(([gid, gd]) => {
                                                const usePct = Math.min(Math.round(gd.hours/total*100*det.guards.size),100);
                                                return (
                                                  <div key={gid} className="flex items-center gap-2.5 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 shadow-sm">
                                                    <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                                                      <Shield size={12} className="text-indigo-500"/>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-700 dark:text-white flex-1 uppercase truncate">{gd.name}</span>
                                                    <span className="text-[9px] text-slate-400 shrink-0">{gd.shifts} turnos</span>
                                                    <span className="text-sm font-black text-indigo-600 shrink-0 w-14 text-right">{Math.round(gd.hours)} hs</span>
                                                  </div>
                                                );
                                              })}
                                          </div>
                                        )}
                                      </div>

                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DEMANDA / COSTO
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'demanda' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard icon={Target} color="#4f46e5" label="SLA vendidas" value={demanda.totals.slaHours.toLocaleString('es-AR')} unit="hs"/>
                <KpiCard icon={Clock} color="#6366f1" label="Costo previo (plan)" value={demanda.totals.planHours.toLocaleString('es-AR')} unit="hs"
                  subtext="Crono de cobertura, sin FT/ext"/>
                <KpiCard icon={Activity} color="#059669" label="Resultante" value={demanda.totals.resultante.toLocaleString('es-AR')} unit="hs"
                  subtext="Plan + ext/adel + FT + ops"/>
                <KpiCard icon={demanda.totals.deltaSla >= 0 ? ArrowUp : ArrowDown}
                  color={demanda.totals.deltaSla >= 0 ? '#059669' : '#dc2626'}
                  label="Δ vs SLA" value={`${demanda.totals.deltaSla > 0 ? '+' : ''}${demanda.totals.deltaSla.toLocaleString('es-AR')}`} unit="hs"/>
                <KpiCard icon={Wallet} color="#ea580c" label="Extras (FT+ext+ops)" value={(demanda.totals.ftHours + demanda.totals.extHours + demanda.totals.adelHours + demanda.totals.opsHours).toLocaleString('es-AR')} unit="hs"/>
                <KpiCard icon={AlertTriangle} color="#d97706" label="Vacante + ausencias" value={(demanda.totals.vacantHours + demanda.totals.absenceHours).toLocaleString('es-AR')} unit="hs"
                  subtext={`${Math.round(demanda.totals.vacantHours)} vac · ${Math.round(demanda.totals.absenceHours)} aus`}/>
              </div>
              <p className="text-[10px] text-slate-400 px-1">
                Horas comparables con pre-factura / cierre SLA. El costo en pesos queda para una fase posterior (tarifas CCT por código).
              </p>

              {!loadTurnos && demandaCompareBars.length > 0 && (
                <SectionCard title={`SLA vs plan vs resultante · ${periodRange.labelShort}`} icon={BarChart3} loading={loadTurnos}>
                  <LegendRow items={[
                    { color: '#4f46e5', label: 'SLA vendidas' },
                    { color: '#6366f1', label: 'Plan' },
                    { color: '#059669', label: 'Resultante' },
                  ]}/>
                  <div className="px-5 pb-5 pt-2">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={demandaCompareBars} margin={{ top: 4, right: 8, left: -16, bottom: 52 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} angle={-40} textAnchor="end" interval={0}/>
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="SLA" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={18}/>
                        <Bar dataKey="Plan" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={18}/>
                        <Bar dataKey="Resultante" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={18}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {!loadTurnos && demandaStackBars.length > 0 && (
                <SectionCard title={`Composición por objetivo · ${periodRange.labelShort}`} icon={Wallet} loading={loadTurnos}>
                  <LegendRow items={[
                    { color: '#4f46e5', label: 'Plan' },
                    { color: '#7c3aed', label: 'Ext+Adel' },
                    { color: '#ea580c', label: 'FT' },
                    { color: '#f59e0b', label: 'Vacante' },
                    { color: '#dc2626', label: 'Ausencia' },
                  ]}/>
                  <div className="px-5 pb-5 pt-2">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={demandaStackBars} margin={{ top: 4, right: 8, left: -16, bottom: 52 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                        <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} angle={-40} textAnchor="end" interval={0}/>
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="Plan" stackId="a" fill="#4f46e5" maxBarSize={32}/>
                        <Bar dataKey="Ext+Adel" stackId="a" fill="#7c3aed" maxBarSize={32}/>
                        <Bar dataKey="FT" stackId="a" fill="#ea580c" maxBarSize={32}/>
                        <Bar dataKey="Vacante" stackId="a" fill="#f59e0b" maxBarSize={32}/>
                        <Bar dataKey="Ausencia" stackId="a" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={32}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              {!loadTurnos && demandaExtrasDonut.length > 0 && (
                <SectionCard title="Composición de extras" icon={PieIcon}>
                  <div className="flex flex-col md:flex-row items-center gap-6 p-5">
                    <PieChart width={200} height={200}>
                      <Pie data={demandaExtrasDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2}>
                        {demandaExtrasDonut.map((d) => <Cell key={d.name} fill={d.color}/>)}
                      </Pie>
                      <Tooltip content={<ChartTooltip/>}/>
                    </PieChart>
                    <div className="space-y-2">
                      {demandaExtrasDonut.map((d) => (
                        <div key={d.name} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }}/>
                          <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{d.name}</span>
                          <span className="text-[11px] font-black text-slate-800 dark:text-white ml-auto">{d.value.toLocaleString('es-AR')} hs</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              <SectionCard title={`Demanda por objetivo · ${periodRange.labelShort}`} icon={Wallet} loading={loadTurnos}>
                {!loadTurnos && demanda.rows.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <Wallet size={36} className="mx-auto mb-2 opacity-20"/>
                    <p className="text-sm font-bold">Sin demanda calculable en este período</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-700/30 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-4">Objetivo</th>
                          <th className="p-4">Cliente</th>
                          <th className="p-4 text-center text-indigo-600">SLA</th>
                          <th className="p-4 text-center">Plan</th>
                          <th className="p-4 text-center text-violet-600">Ext+Adel</th>
                          <th className="p-4 text-center text-orange-600">FT</th>
                          <th className="p-4 text-center text-emerald-600">Ops</th>
                          <th className="p-4 text-center text-amber-600">Vacante</th>
                          <th className="p-4 text-center text-rose-600">Ausencias</th>
                          <th className="p-4 text-center">Resultante</th>
                          <th className="p-4 text-center">Δ SLA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {demanda.rows.map((row) => {
                          const isExpanded = expandedDemandaId === row.id;
                          return (
                            <React.Fragment key={row.id}>
                              <tr
                                onClick={() => setExpandedDemandaId(isExpanded ? null : row.id)}
                                className={`cursor-pointer select-none transition-colors ${
                                  isExpanded
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20'
                                    : row.deltaSla < -8
                                      ? 'bg-rose-50/30 dark:bg-rose-900/10 hover:bg-rose-50/60'
                                      : 'hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10'
                                }`}
                              >
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                    <span className="font-bold text-slate-700 dark:text-white uppercase text-xs">{row.name}</span>
                                  </div>
                                </td>
                                <td className="p-4 text-slate-500 text-xs font-bold">{row.client}</td>
                                <td className="p-4 text-center font-black text-indigo-600">{Math.round(row.slaHours)}</td>
                                <td className="p-4 text-center font-bold text-slate-700 dark:text-white">{Math.round(row.planHours)}</td>
                                <td className="p-4 text-center text-violet-600">{row.extHours + row.adelHours > 0 ? Math.round(row.extHours + row.adelHours) : '—'}</td>
                                <td className="p-4 text-center text-orange-600">{row.ftHours > 0 ? Math.round(row.ftHours) : '—'}</td>
                                <td className="p-4 text-center text-emerald-600">{row.opsHours > 0 ? Math.round(row.opsHours) : '—'}</td>
                                <td className="p-4 text-center text-amber-600">{row.vacantHours > 0 ? Math.round(row.vacantHours) : '—'}</td>
                                <td className="p-4 text-center text-rose-600">{row.absenceHours > 0 ? Math.round(row.absenceHours) : '—'}</td>
                                <td className="p-4 text-center font-black text-slate-800 dark:text-white">{Math.round(row.resultante)}</td>
                                <td className="p-4 text-center">
                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                    row.deltaSla >= 0
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                  }`}>
                                    {row.deltaSla > 0 ? '+' : ''}{Math.round(row.deltaSla)}
                                  </span>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-slate-50/80 dark:bg-slate-800/60">
                                  <td colSpan={11} className="px-6 py-3 text-[11px] text-slate-500 space-y-1">
                                    <p>
                                      <strong className="text-slate-700 dark:text-slate-200">Costo previo:</strong> {row.planHours.toLocaleString('es-AR')} hs planificadas
                                      {' · '}
                                      <strong className="text-slate-700 dark:text-slate-200">Resultante − plan:</strong> {row.deltaPlan > 0 ? '+' : ''}{row.deltaPlan.toLocaleString('es-AR')} hs
                                      {' · '}
                                      Ext {row.extHours} · Adel {row.adelHours} · FT {row.ftHours} · Ops {row.opsHours}
                                    </p>
                                    <p>
                                      Licencias/ausencias: {row.absenceHours.toLocaleString('es-AR')} hs
                                      {row.absenceCoveredHours > 0
                                        ? ` · ${row.absenceCoveredHours.toLocaleString('es-AR')} hs con cobertura FT/ops`
                                        : ' · sin cobertura extra detectada'}
                                    </p>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 dark:bg-slate-700/50 font-black text-xs">
                          <td className="p-4" colSpan={2}>Total</td>
                          <td className="p-4 text-center text-indigo-600">{Math.round(demanda.totals.slaHours)}</td>
                          <td className="p-4 text-center">{Math.round(demanda.totals.planHours)}</td>
                          <td className="p-4 text-center text-violet-600">{Math.round(demanda.totals.extHours + demanda.totals.adelHours)}</td>
                          <td className="p-4 text-center text-orange-600">{Math.round(demanda.totals.ftHours)}</td>
                          <td className="p-4 text-center text-emerald-600">{Math.round(demanda.totals.opsHours)}</td>
                          <td className="p-4 text-center text-amber-600">{Math.round(demanda.totals.vacantHours)}</td>
                          <td className="p-4 text-center text-rose-600">{Math.round(demanda.totals.absenceHours)}</td>
                          <td className="p-4 text-center">{Math.round(demanda.totals.resultante)}</td>
                          <td className="p-4 text-center">{demanda.totals.deltaSla > 0 ? '+' : ''}{Math.round(demanda.totals.deltaSla)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: PROYECCIÓN
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'proyeccion' && (
            <div className="space-y-4">

              {/* AreaChart con gradiente */}
              <SectionCard title={`Tendencia · ${periodRange.labelShort} + 3 meses`} icon={TrendingUp}>
                <LegendRow items={[
                  { color:'#4f46e5', label:'Hs teóricas' },
                  { color:'#7c3aed', label:'Guardias mín.' },
                ]}/>
                <div className="px-5 pb-5 pt-2">
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={areaData} margin={{ top:4, right:50, left:-16, bottom:4 }}>
                      <defs>
                        <linearGradient id="horasGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#4f46e5" stopOpacity={0.25}/>
                          <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/>
                      <XAxis dataKey="name" tick={{ fontSize:10, fontWeight:700, fill:'#94a3b8' }}/>
                      <YAxis yAxisId="left"  tick={{ fontSize:9, fill:'#94a3b8' }}/>
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize:9, fill:'#94a3b8' }}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Area yAxisId="left" type="monotone" dataKey="Hs teóricas"
                        stroke="#4f46e5" strokeWidth={2.5} fill="url(#horasGrad)"
                        dot={{ fill:'#4f46e5', r:5, strokeWidth:0 }}/>
                      <Line yAxisId="right" type="monotone" dataKey="Guardias mín."
                        stroke="#7c3aed" strokeWidth={2.5}
                        dot={{ fill:'#7c3aed', r:5, strokeWidth:0 }}
                        strokeDasharray="6 3"/>
                      <ReferenceLine yAxisId="right" y={availableGuards} stroke="#059669" strokeDasharray="5 4"
                        label={{ value:`${availableGuards} disp.`, fontSize:9, fill:'#059669', position:'right' }}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* Cards 3 meses */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {projectionDisplay.map(p => (
                  <div key={p.label} className="rounded-xl border shadow-sm p-5 space-y-3" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{p.label}</p>
                      <Calendar size={13} className="text-slate-300"/>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{p.hours.toLocaleString('es-AR')}</p>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">Horas teóricas</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-slate-700 dark:text-white">{p.guards}</p>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">Guardias mín.{aplicarAusentismo ? ' (aj.)' : ''}</p>
                      </div>
                    </div>
                    <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${p.gap>0?'bg-rose-50 dark:bg-rose-900/20':p.gap<0?'bg-emerald-50 dark:bg-emerald-900/20':'bg-slate-50 dark:bg-slate-700/40'}`}>
                      <span className="text-[9px] font-black uppercase text-slate-500">Brecha</span>
                      <span className={`text-sm font-black flex items-center gap-1 ${p.gap>0?'text-rose-600':p.gap<0?'text-emerald-600':'text-slate-400'}`}>
                        {p.gap>0?<ArrowUp size={13}/>:p.gap<0?<ArrowDown size={13}/>:<Minus size={13}/>}
                        {p.gap>0?`+${p.gap} G déficit`:p.gap<0?`${Math.abs(p.gap)} G superávit`:'Exacto'}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400">{p.active} {p.active===1?'servicio activo':'servicios activos'}</p>
                  </div>
                ))}
              </div>

              {/* Servicios que vencen */}
              {(() => {
                const mStart = new Date(periodRange.start);
                mStart.setHours(0, 0, 0, 0);
                const mEnd = new Date(periodRange.end);
                mEnd.setHours(23, 59, 59, 999);
                const soon = services.filter(s => {
                  if (!s.endDate) return false;
                  const e = new Date(s.endDate + 'T00:00:00');
                  return e >= mStart && e <= mEnd;
                });
                if (!soon.length) return null;
                return (
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 space-y-3">
                    <p className="text-[9px] font-black uppercase text-amber-600 tracking-widest flex items-center gap-1">
                      <AlertTriangle size={11}/> Servicios que vencen en el período ({soon.length})
                    </p>
                    {soon.map(s => (
                      <div key={s.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-xs font-black text-slate-700 dark:text-white uppercase">{s.clientName}</p>
                          <p className="text-[9px] text-indigo-500 font-bold">{s.objectiveName}</p>
                        </div>
                        <span className="text-[9px] font-black text-amber-600 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">Vence {s.endDate}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Barra capacidad */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-3">
                  Guardias necesarios vs disponibles · {availableGuards} efectivos (plantel {plantelGuardias})
                  {guardiasNoDispTotal > 0 ? ` · −${guardiasNoDispTotal} no disp.` : ''}
                </p>
                <div className="space-y-2">
                  {projectionDisplay.map(p => (
                    <div key={p.label} className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-slate-500 w-12 uppercase">{p.monthLabel}</span>
                      <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${p.guards<=availableGuards?'bg-emerald-500':'bg-rose-500'}`}
                          style={{ width:`${Math.min((p.guards/Math.max(availableGuards,p.guards))*100,100)}%` }}/>
                      </div>
                      <span className={`text-[10px] font-black w-20 text-right shrink-0 ${p.guards<=availableGuards?'text-emerald-600':'text-rose-600'}`}>
                        {p.guards}/{availableGuards} G
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: VIABILIDAD (demanda pax/día vs dotación elegible)
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'viabilidad' && (
            <div className="space-y-4">
              <SectionCard title={`Viabilidad por servicio SLA · ${periodRange.labelShort}`} icon={Scale} loading={loadAus}>
                <div className="p-5 space-y-4">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Compara el <strong>pico de pax</strong> que exige la estructura del servicio cada día (suma de <code className="text-[9px] bg-slate-100 dark:bg-slate-700 px-1 rounded">quantity</code> por puesto con cobertura)
                    contra la <strong>dotación realmente disponible</strong> ese día. La dotación elegible (sin restricción a ese cliente/objetivo) baja por:
                    <strong> ausencias</strong> formales (RRHH), <strong>franco</strong> planificado (F/FF/FP), <strong>licencias</strong> en planificación
                    (V/L/E/A/AA/PG) y <strong>turnos en otro objetivo</strong> ese día.
                  </p>

                  {theoretical.active.length === 0 ? (
                    <p className="text-sm font-bold text-slate-400 text-center py-8">No hay servicios SLA con horas teóricas en este período.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="text-[9px] font-black uppercase text-slate-400">Servicio</label>
                        <select
                          value={vialSrvId}
                          onChange={(e) => setVialSrvId(e.target.value)}
                          className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-bold min-w-[240px] max-w-full"
                        >
                          {theoretical.active.map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {(s.objectiveName || 'Sin objetivo')} · {s.clientName || 'Sin cliente'}
                            </option>
                          ))}
                        </select>
                      </div>

                      {viabilityReportDisplay && (
                        <>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <KpiCard
                              icon={Users}
                              color="#4f46e5"
                              label="Dotación elegible"
                              value={viabilityReportDisplay.eligiblePool}
                              subtext="Sin restricción cliente/objetivo"
                            />
                            <KpiCard
                              icon={Target}
                              color="#7c3aed"
                              label="Pico pax requerido"
                              value={viabilityReportDisplay.peakRequired}
                              subtext={
                                aplicarAusentismo && viabilityReport
                                  ? `Ajustado por ${ausentismoTotal}% aus. (puro: ${viabilityReport.peakRequired})`
                                  : 'Máx. en un día del período'
                              }
                            />
                            <KpiCard
                              icon={AlertTriangle}
                              color={viabilityReportDisplay.deficitDays > 0 ? '#dc2626' : '#059669'}
                              label="Días en déficit"
                              value={viabilityReportDisplay.deficitDays}
                              subtext={
                                viabilityReportDisplay.worstGap > 0
                                  ? `Peor brecha: +${viabilityReportDisplay.worstGap} pax${aplicarAusentismo && viabilityReport ? ` · puro: ${viabilityReport.deficitDays} d / +${viabilityReport.worstGap} pax` : ''}`
                                  : aplicarAusentismo && viabilityReport
                                    ? `Sin brechas · puro: ${viabilityReport.deficitDays} d`
                                    : 'Sin brechas'
                              }
                              alert={viabilityReportDisplay.deficitDays > 0}
                            />
                            <KpiCard
                              icon={CheckCircle}
                              color="#059669"
                              label="Mín. disponible (día pico)"
                              value={viabilityReportDisplay.minAvailable}
                              subtext={
                                aplicarAusentismo && viabilityReport
                                  ? `Ajustado por ${ausentismoTotal}% aus. (puro: ${viabilityReport.minAvailable})`
                                  : 'Elegibles − aus./franco/lic./otro objetivo'
                              }
                            />
                          </div>

                          {viabilityBarData.length > 0 && (
                            <div className="pt-2">
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-2">
                                Requeridos vs disponibles (días con demanda){aplicarAusentismo ? ` · ajustado por ${ausentismoTotal}% aus.` : ''}
                              </p>
                              <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={viabilityBarData} margin={{ top: 4, right: 8, left: -16, bottom: 28 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                  <XAxis dataKey="name" tick={{ fontSize: 8, fontWeight: 700, fill: '#94a3b8' }} interval={0} angle={-40} textAnchor="end" height={48} />
                                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                  <Tooltip content={<ChartTooltip />} />
                                  <Bar dataKey="Requeridos" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={22} />
                                  <Bar dataKey="Disponibles" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={22} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600 max-h-[420px] overflow-y-auto custom-scrollbar">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10 border-b border-slate-200 dark:border-slate-600">
                                <tr className="text-[9px] font-black uppercase text-slate-400">
                                  <th className="text-left p-2">Día</th>
                                  <th className="text-center p-2 w-8">Letra</th>
                                  <th className="text-right p-2">Req.{aplicarAusentismo ? ' (aj.)' : ''}</th>
                                  <th className="text-right p-2" title="Ausencias formales (RRHH)">Aus.</th>
                                  <th className="text-right p-2" title="Franco planificado (F/FF/FP)">Frc.</th>
                                  <th className="text-right p-2" title="Licencia en planificación (V/L/E/A/AA/PG)">Lic.</th>
                                  <th className="text-right p-2" title="Asignados a otro objetivo ese día">Otro</th>
                                  <th className="text-right p-2">Disp.{aplicarAusentismo ? ' (aj.)' : ''}</th>
                                  <th className="text-right p-2">Δ</th>
                                  <th className="text-center p-2">Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {viabilityReportDisplay.rows.map((r, i) => {
                                  const show = r.requiredPax > 0 || r.gap > 0;
                                  if (!show) return null;
                                  const ok = r.gap <= 0;
                                  return (
                                    <tr
                                      key={i}
                                      className={`border-b border-slate-50 dark:border-slate-700/80 ${ok ? '' : 'bg-rose-50/80 dark:bg-rose-950/20'}`}
                                    >
                                      <td className="p-2 font-bold text-slate-700 dark:text-slate-200">{r.dayLabel}</td>
                                      <td className="p-2 text-center text-slate-400 font-mono">{r.letter}</td>
                                      <td className="p-2 text-right font-black text-indigo-600">{r.requiredPax}</td>
                                      <td className="p-2 text-right text-amber-600 font-bold">{r.absentThatDay}</td>
                                      <td className="p-2 text-right text-slate-500 font-bold">{r.francoThatDay}</td>
                                      <td className="p-2 text-right text-violet-500 font-bold">{r.licenciaThatDay}</td>
                                      <td className="p-2 text-right text-cyan-600 font-bold">{r.enOtroObjThatDay}</td>
                                      <td className="p-2 text-right font-bold text-emerald-600">{r.availablePax}</td>
                                      <td className={`p-2 text-right font-black ${ok ? 'text-slate-400' : 'text-rose-600'}`}>
                                        {r.gap > 0 ? `+${r.gap}` : r.gap}
                                      </td>
                                      <td className="p-2 text-center">
                                        {r.requiredPax === 0 ? (
                                          <span className="text-[9px] text-slate-300">—</span>
                                        ) : ok ? (
                                          <span className="text-[9px] font-black text-emerald-600">OK</span>
                                        ) : (
                                          <span className="text-[9px] font-black text-rose-600">FALTA</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[9px] text-slate-400">
                            Solo se listan días con demanda de pax o con brecha positiva. Días fuera de contrato o sin cobertura quedan ocultos.
                            {aplicarAusentismo && ` Valores ajustados con ${ausentismoTotal}% de ausentismo configurado: requeridos suben (colchón) y disponibles bajan.`}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: ART.12 — domicilio vs ubicación del puesto (> 25 km)
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'art12' && (
            <div className="space-y-4">
              <SectionCard title={`ART.12 · Distancia domicilio–objetivo · ${periodRange.labelShort}`} icon={MapPin} loading={loadTurnos}>
                <div className="p-5 space-y-4">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Sobre los turnos <strong>operativos</strong> del período (códigos {Array.from(OPERATIVE_CODES).sort().join(', ')}),
                    compara el domicilio del guardia (coordenadas en RRHH) con el objetivo asignado. Distancia en línea recta;
                    umbral de referencia <strong>{ART12_MAX_KM_VIVIENDA} km</strong>. Valores muy altos (típ. &gt;{' '}
                    {ART12_MAX_PLAUSIBLE_COMMUTE_KM} km) suelen ser <strong>coordenadas mal cargadas</strong>, no trayectos reales:
                    esas filas no cuentan para “superan 25 km” hasta corregir el legajo.
                  </p>

                  {art12Report.resumenGuardiasSobre25.length > 0 && (
                    <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/25 px-4 py-3 space-y-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-300">
                        Respuesta · Guardias que superan {art12Report.umbralKm} km (datos confiables)
                      </p>
                      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        Son <strong className="text-rose-700 dark:text-rose-400">{art12Report.guardiasSobreUmbralConfiables}</strong>{' '}
                        guardia(s). Distancia total domicilio → objetivo y cuánto pasan del umbral:
                      </p>
                      <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-4">
                        {art12Report.resumenGuardiasSobre25.map((g, idx) => (
                          <li key={`${g.empName}-${idx}`}>
                            <span className="font-black text-slate-800 dark:text-white">{g.empName}</span>
                            {' — '}
                            <span className="font-bold">{g.kmRounded} km</span> al objetivo{' '}
                            <span className="text-slate-500">({g.clientName ? `${g.clientName} · ` : ''}{g.objectiveName})</span>
                            {' · '}
                            <span className="text-rose-600 dark:text-rose-400 font-black">
                              +{g.kmSobreUmbral} km sobre los {art12Report.umbralKm} km
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {art12Report.resumenGuardiasSobre25.length === 0 && art12Report.empleadosRevisarCoords === 0 && art12Report.rows.length > 0 && (
                    <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl px-4 py-3">
                      Ningún guardia supera los {art12Report.umbralKm} km con los datos actuales (todas las distancias calculadas son
                      plausibles y están por debajo del umbral).
                    </p>
                  )}

                  {art12Report.resumenGuardiasSobre25.length === 0 && art12Report.empleadosRevisarCoords > 0 && (
                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-3">
                      Con los datos actuales <strong>no hay guardias que superen los {art12Report.umbralKm} km de forma confiable</strong>:
                      hay {art12Report.empleadosRevisarCoords} guardia(s) con distancias muy altas (posible domicilio mal geocodificado).
                      Corregí las coordenadas en RRHH para obtener la respuesta real sobre ART.12.
                    </p>
                  )}

                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <KpiCard
                      icon={AlertTriangle}
                      color={art12Report.guardiasSobreUmbralConfiables > 0 ? '#dc2626' : '#059669'}
                      label="Superan 25 km"
                      value={art12Report.guardiasSobreUmbralConfiables}
                      subtext={`Solo distancias ≤ ${art12Report.maxPlausibleKm} km (confiables)`}
                      alert={art12Report.guardiasSobreUmbralConfiables > 0}
                    />
                    <KpiCard
                      icon={AlertCircle}
                      color={art12Report.empleadosRevisarCoords > 0 ? '#f59e0b' : '#64748b'}
                      label="Revisar domicilio"
                      value={art12Report.empleadosRevisarCoords}
                      subtext={`>${art12Report.maxPlausibleKm} km · corregir coords en RRHH`}
                      alert={art12Report.empleadosRevisarCoords > 0}
                    />
                    <KpiCard
                      icon={Users}
                      color="#4f46e5"
                      label="Con turno operativo"
                      value={art12Report.empleadosConAsignacionOperativa}
                      subtext="Guardias con al menos un turno citado"
                    />
                    <KpiCard
                      icon={MapPin}
                      color={art12Report.empleadosSinDomicilioGeo > 0 ? '#f59e0b' : '#64748b'}
                      label="Sin coord. domicilio"
                      value={art12Report.empleadosSinDomicilioGeo}
                      subtext="No se puede calcular distancia"
                      alert={art12Report.empleadosSinDomicilioGeo > 0}
                    />
                    <KpiCard
                      icon={Target}
                      color={art12Report.objetivosSinGeoEnTurnos > 0 ? '#f59e0b' : '#64748b'}
                      label="Objetivos sin geo"
                      value={art12Report.objetivosSinGeoEnTurnos}
                      subtext="IDs en turnos sin lat/lng en CRM/objetivos"
                      alert={art12Report.objetivosSinGeoEnTurnos > 0}
                    />
                  </div>

                  {art12Report.rows.length === 0 ? (
                    <p className="text-sm font-bold text-slate-400 text-center py-8">
                      No hay pares guardia–objetivo con coordenadas completas en este período.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600 max-h-[480px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10 border-b border-slate-200 dark:border-slate-600">
                          <tr className="text-[9px] font-black uppercase text-slate-400">
                            <th className="text-left p-2">Guardia</th>
                            <th className="text-left p-2">Cliente</th>
                            <th className="text-left p-2">Objetivo</th>
                            <th className="text-right p-2">Km</th>
                            <th className="text-center p-2">ART.12</th>
                          </tr>
                        </thead>
                        <tbody>
                          {art12Report.rows.map((r, i) => (
                            <tr
                              key={`${r.empId}-${r.objectiveId}-${i}`}
                              className={`border-b border-slate-50 dark:border-slate-700/80 ${
                                r.exceedsArt25Usable
                                  ? 'bg-rose-50/80 dark:bg-rose-950/20'
                                  : r.needsCoordReview
                                    ? 'bg-amber-50/70 dark:bg-amber-950/15'
                                    : ''
                              }`}
                            >
                              <td className="p-2 font-bold text-slate-700 dark:text-slate-200">
                                {r.empName}
                                {r.usedLatLngSwap ? (
                                  <span className="block text-[8px] font-bold text-indigo-500 normal-case">
                                    Lat/lng corregidos en cálculo (invertidos en legajo)
                                  </span>
                                ) : null}
                              </td>
                              <td className="p-2 text-slate-600 dark:text-slate-300">{r.clientName || '—'}</td>
                              <td className="p-2 text-slate-600 dark:text-slate-300">{r.objectiveName}</td>
                              <td className="p-2 text-right font-black text-slate-800 dark:text-white">{r.kmRounded}</td>
                              <td className="p-2 text-center">
                                {r.needsCoordReview ? (
                                  <span className="text-[9px] font-black text-amber-700 dark:text-amber-400">
                                    Revisar RRHH
                                  </span>
                                ) : r.exceedsArt25Usable ? (
                                  <span className="text-[9px] font-black text-rose-600">
                                    &gt; {art12Report.umbralKm} km (+{r.kmSobreUmbral})
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-black text-emerald-600">≤ {art12Report.umbralKm} km</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="text-[9px] text-slate-400">
                    Pares guardia–objetivo con ambas coordenadas:{' '}
                    <strong className="text-slate-500">{art12Report.parejasAnalizadas}</strong>
                    {art12Report.parejasRevisarCoords > 0 ? (
                      <>
                        {' '}
                        · <strong className="text-amber-600">{art12Report.parejasRevisarCoords}</strong> con distancia implausible (
                        &gt;{art12Report.maxPlausibleKm} km): no usar para ART.12 hasta corregir domicilio u objetivo.
                      </>
                    ) : null}
                    . Cada fila es única en el período (se toma la mayor distancia si hubiera varias mediciones).
                  </p>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: ANALÍTICA
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'analitica' && (
            <div className="space-y-4">

              {/* ── Panel de filtros ─────────────────────────────────────────── */}
              <div className="rounded-xl border shadow-sm p-4 space-y-3" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                  <Filter size={10}/> Filtros y configuración
                </p>

                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  El universo del header usa el período <strong>{periodRange.labelShort}</strong>.
                  Analítica lee el mismo snapshot: si el rango de abajo ya está cubierto, no hay otro viaje a Firestore.
                </p>

                {/* Fila 1: rango de fechas + botón */}
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-black uppercase text-slate-400">Desde</label>
                    <input type="date" value={analDateFrom} onChange={e => setAnalDateFrom(e.target.value)}
                      className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white"/>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-black uppercase text-slate-400">Hasta</label>
                    <input type="date" value={analDateTo} onChange={e => setAnalDateTo(e.target.value)}
                      className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white"/>
                  </div>
                  <button type="button" onClick={() => {
                    const f = formatYmdLocal(new Date(periodRange.start));
                    const t = formatYmdLocal(new Date(periodRange.end));
                    setAnalDateFrom(f);
                    setAnalDateTo(t);
                    void loadAnalytics(f, t);
                  }} disabled={loadAnal}
                    className="flex items-center gap-1.5 border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-60 text-indigo-800 dark:text-indigo-200 text-xs font-black px-3 py-1.5 rounded-lg transition-colors">
                    Igualar al período y cargar
                  </button>
                  <button onClick={() => void loadAnalytics()} disabled={loadAnal}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-black px-3 py-1.5 rounded-lg transition-colors">
                    {loadAnal ? <Loader2 size={12} className="animate-spin"/> : <RefreshCw size={12}/>}
                    {loadAnal ? 'Cargando…' : 'Cargar datos'}
                  </button>
                  {analLoaded && (
                    <span className="text-[9px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle size={10}/> {analRawTurnos.length.toLocaleString('es-AR')} turnos cargados
                    </span>
                  )}
                </div>

                {/* Fila 2: filtros de cruce (visibles solo cuando hay datos) */}
                {analLoaded && (
                  <div className="flex flex-wrap gap-2 items-end border-t border-slate-100 dark:border-slate-700 pt-3">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] font-black uppercase text-slate-400">Cliente</label>
                      <select value={analClientId} onChange={e => { setAnalClientId(e.target.value); setAnalObjectiveId(''); }}
                        className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white min-w-[160px]">
                        <option value="">Todos los clientes</option>
                        {analClientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] font-black uppercase text-slate-400">Objetivo</label>
                      <select value={analObjectiveId} onChange={e => setAnalObjectiveId(e.target.value)}
                        className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white min-w-[160px]">
                        <option value="">Todos los objetivos</option>
                        {analObjectiveOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] font-black uppercase text-slate-400">Empleado</label>
                      <select value={analEmployeeId} onChange={e => setAnalEmployeeId(e.target.value)}
                        className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white min-w-[160px]">
                        <option value="">Todos los empleados</option>
                        {employees.sort((a:any,b:any) => (a.name||'').localeCompare(b.name||'')).map((e:any) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] font-black uppercase text-slate-400">Estado</label>
                      <select value={analStatus} onChange={e => setAnalStatus(e.target.value)}
                        className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-white">
                        <option value="">Todos</option>
                        <option value="PRESENT">Presente</option>
                        <option value="COMPLETED">Completado</option>
                        <option value="ABSENT">Ausente</option>
                        <option value="PENDING">Pendiente</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Configuración de visualización ────────────────────────────── */}
              {analLoaded && (
                <div className="rounded-xl border shadow-sm p-4" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                  <div className="flex flex-wrap gap-4 items-start">
                    {/* Ver por */}
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Ver por</p>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          { id:'employee',  label:'Empleado'   },
                          { id:'objective', label:'Objetivo'   },
                          { id:'client',    label:'Cliente'    },
                          { id:'code',      label:'Código'     },
                          { id:'status',    label:'Estado'     },
                          { id:'date',      label:'Fecha'      },
                        ] as {id:typeof analDimension; label:string}[]).map(d => (
                          <button key={d.id} onClick={() => setAnalDimension(d.id)}
                            className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-colors
                              ${analDimension===d.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Métrica */}
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Métrica</p>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          { id:'hours',    label:'Horas'           },
                          { id:'shifts',   label:'Turnos'          },
                          { id:'presence', label:'Presencias'      },
                          { id:'absence',  label:'Ausencias'       },
                          { id:'night',    label:'Horas nocturnas' },
                        ] as {id:typeof analMetric; label:string}[]).map(m => (
                          <button key={m.id} onClick={() => setAnalMetric(m.id)}
                            className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-colors
                              ${analMetric===m.id ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tipo de gráfico */}
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Gráfico</p>
                      <div className="flex gap-1.5">
                        {([
                          { id:'bar',  label:'Barras', icon: BarChart2 },
                          { id:'pie',  label:'Torta',  icon: PieIcon   },
                          { id:'area', label:'Área',   icon: TrendingUp},
                        ] as {id:typeof analChartType; label:string; icon:any}[]).map(c => (
                          <button key={c.id} onClick={() => setAnalChartType(c.id)}
                            className={`flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-lg transition-colors
                              ${analChartType===c.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                            <c.icon size={10}/>{c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Gráfico principal ─────────────────────────────────────────── */}
              {analLoaded && analData.data.length > 0 && (() => {
                const COLORS = ['#4f46e5','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#65a30d','#ea580c','#0284c7'];
                const metricLabel = analMetric==='hours'?'Horas':analMetric==='shifts'?'Turnos':analMetric==='presence'?'Presencias':analMetric==='absence'?'Ausencias':'Hs nocturnas';
                const totalVal = analData.totalValue;
                const totalGroups = analData.totalGroups;
                const shownGroups = analData.data.length;
                const truncated = totalGroups > shownGroups;

                return (
                  <SectionCard title={`${metricLabel} por ${analDimension==='employee'?'Empleado':analDimension==='objective'?'Objetivo':analDimension==='client'?'Cliente':analDimension==='code'?'Código':analDimension==='status'?'Estado':'Fecha'}`} icon={BarChart3}>
                    {/* KPIs rápidos */}
                    <div className="grid grid-cols-3 gap-3 px-5 pt-4 pb-2">
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{totalVal.toLocaleString('es-AR', {maximumFractionDigits:1})}</p>
                        <p className="text-[9px] font-black uppercase text-indigo-400">Total {metricLabel}</p>
                      </div>
                      <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-violet-700 dark:text-violet-300">{totalGroups}</p>
                        <p className="text-[9px] font-black uppercase text-violet-400">Grupos {truncated ? `(top ${shownGroups})` : ''}</p>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-emerald-700 dark:text-emerald-300">{totalGroups > 0 ? (totalVal/totalGroups).toLocaleString('es-AR',{maximumFractionDigits:1}) : 0}</p>
                        <p className="text-[9px] font-black uppercase text-emerald-400">Promedio</p>
                      </div>
                    </div>
                    {truncated && (
                      <p className="px-5 pb-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                        Se grafican los {shownGroups} grupos con más {metricLabel.toLowerCase()}. El total y promedio incluyen los {totalGroups} grupos.
                      </p>
                    )}

                    {/* Gráfico */}
                    <div className="px-5 pb-5 pt-2">
                      {analChartType === 'bar' && (
                        <ResponsiveContainer width="100%" height={Math.max(280, analData.data.length * 32)}>
                          <BarChart data={analData.data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false}/>
                            <XAxis type="number" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}/>
                            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }}
                              tickFormatter={v => (v||'').length > 16 ? v.substring(0,16)+'…' : v}/>
                            <Tooltip content={<ChartTooltip/>}/>
                            <Bar dataKey="value" name={metricLabel} radius={[0,6,6,0]}>
                              {analData.data.map((_,i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}

                      {analChartType === 'pie' && (
                        <div className="flex flex-col md:flex-row items-center gap-6">
                          <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                              <Pie data={analData.data.slice(0,10)} dataKey="value" nameKey="name"
                                cx="50%" cy="50%" innerRadius={60} outerRadius={110}
                                paddingAngle={2} label={({name,percent}) => `${(name||'').substring(0,10)} ${(percent*100).toFixed(0)}%`}
                                labelLine={false}>
                                {analData.data.slice(0,10).map((_,i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                              </Pie>
                              <Tooltip content={<ChartTooltip/>}/>
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-1.5 shrink-0 min-w-[140px]">
                            {analData.data.slice(0,10).map((d,i) => (
                              <div key={d.name} className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }}/>
                                <span className="text-[10px] text-slate-600 dark:text-slate-300 truncate max-w-[120px]">{d.name}</span>
                                <span className="text-[10px] font-black text-slate-700 dark:text-white ml-auto">{d.value.toLocaleString('es-AR',{maximumFractionDigits:1})}</span>
                              </div>
                            ))}
                            {analData.data.length > 10 && <p className="text-[9px] text-slate-400">+{analData.data.length-10} más…</p>}
                          </div>
                        </div>
                      )}

                      {analChartType === 'area' && (
                        <ResponsiveContainer width="100%" height={280}>
                          <AreaChart data={analData.data} margin={{ left: 8, right: 16, top: 4, bottom: 40 }}>
                            <defs>
                              <linearGradient id="analGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                            <XAxis dataKey="name" tick={{ fontSize: 8, fontWeight: 700, fill: '#94a3b8' }} angle={-35} textAnchor="end" interval={0}
                              tickFormatter={v => (v||'').length > 12 ? v.substring(0,12)+'…' : v}/>
                            <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}/>
                            <Tooltip content={<ChartTooltip/>}/>
                            <Area type="monotone" dataKey="value" name={metricLabel} stroke="#4f46e5" fill="url(#analGrad)" strokeWidth={2.5}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </SectionCard>
                );
              })()}

              {/* ── Tabla de datos ────────────────────────────────────────────── */}
              {analLoaded && analData.data.length > 0 && (
                <SectionCard title="Detalle de datos" icon={Activity}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40">
                          <th className="text-left px-5 py-2.5 font-black uppercase text-[9px] text-slate-400 tracking-wide">#</th>
                          <th className="text-left px-5 py-2.5 font-black uppercase text-[9px] text-slate-400 tracking-wide">
                            {analDimension==='employee'?'Empleado':analDimension==='objective'?'Objetivo':analDimension==='client'?'Cliente':analDimension==='code'?'Código':analDimension==='status'?'Estado':'Fecha'}
                          </th>
                          <th className="text-right px-5 py-2.5 font-black uppercase text-[9px] text-slate-400 tracking-wide">
                            {analMetric==='hours'?'Horas':analMetric==='shifts'?'Turnos':analMetric==='presence'?'Presencias':analMetric==='absence'?'Ausencias':'Hs nocturnas'}
                          </th>
                          <th className="text-right px-5 py-2.5 font-black uppercase text-[9px] text-slate-400 tracking-wide">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const total = analData.totalValue;
                          return analData.data.map((row, i) => (
                            <tr key={row.name} className={`border-b border-slate-50 dark:border-slate-700/50 ${i%2===0?'':'bg-slate-50/40 dark:bg-slate-700/20'}`}>
                              <td className="px-5 py-2 text-slate-400 font-bold">{i+1}</td>
                              <td className="px-5 py-2 font-bold text-slate-700 dark:text-white">{row.name}</td>
                              <td className="px-5 py-2 text-right font-black text-slate-700 dark:text-white">{row.value.toLocaleString('es-AR',{maximumFractionDigits:1})}</td>
                              <td className="px-5 py-2 text-right">
                                <span className="text-[10px] font-black text-indigo-500">
                                  {total > 0 ? ((row.value/total)*100).toFixed(1) : 0}%
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              {/* ── Estado vacío ──────────────────────────────────────────────── */}
              {loadAnal && (
                <div className="rounded-xl border shadow-sm p-12 text-center" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                  <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3"/>
                  <p className="text-sm font-black text-slate-500">Cargando turnos del snapshot…</p>
                </div>
              )}
              {!analLoaded && !loadAnal && (
                <div className="rounded-xl border shadow-sm p-12 text-center" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                  <BarChart3 size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-4"/>
                  <p className="text-sm font-black text-slate-400">El rango no está en el snapshot. Presioná <span className="text-indigo-600">Cargar datos</span> para ampliarlo.</p>
                  <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-1">Si el período del header ya cubre estas fechas, los datos aparecen solos. Podés filtrar por cliente, objetivo, empleado y estado.</p>
                </div>
              )}

              {/* ── Sin resultados ────────────────────────────────────────────── */}
              {analLoaded && analData.data.length === 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-8 text-center">
                  <AlertCircle size={32} className="mx-auto text-amber-400 mb-3"/>
                  <p className="text-sm font-black text-amber-700 dark:text-amber-300">Sin datos para los filtros seleccionados</p>
                  <p className="text-[10px] text-amber-500 mt-1">{analRawTurnos.length} turnos cargados en total — probá relajar los filtros.</p>
                </div>
              )}

            </div>
          )}

        </div>
      </PageShell>
    </DashboardLayout>
  );
}
