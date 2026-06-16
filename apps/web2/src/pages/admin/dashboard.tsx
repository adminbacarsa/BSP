import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Head from 'next/head';
import {
  Shield, Users, Clock, AlertTriangle,
  Briefcase, Activity, Calendar,
  UserCheck, TrendingUp, Building2,
  PieChart as PieChartIcon, LayoutDashboard, UserX,
  Sun, RefreshCw, CheckCircle2, XCircle, Info,
  AlertCircle, ArrowRight, CalendarClock, UserMinus,
  TrendingDown, Layers, Zap, X
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { useEmpresa } from '@/context/EmpresaContext';
import { shouldScopeQueriesToEmpresa, belongsToEmpresaView } from '@/lib/multiempresa';
import { calculateSlaHoursForMonth, serviceOverlapsMonth } from '@/lib/servicios/slaHoursCalculator';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
const fmt = (n: number, decimals = 0) => n.toLocaleString('es-AR', { maximumFractionDigits: decimals });

const formatShiftStart = (startTime: { seconds?: number } | undefined): string => {
  if (!startTime?.seconds) return '—';
  return new Date(startTime.seconds * 1000).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const NOVEDAD_TYPE_LABELS: Record<string, string> = {
  RETENCION: 'Retención',
  ADELANTO_TURNO: 'Adelanto de turno',
  CONVOCATORIA_RETEN: 'Convocatoria retén',
  FRANCO_TRABAJADO: 'Franco trabajado',
  BAJA_CUBIERTA: 'Baja cubierta',
  VACANTE_A_PLANIFICACION: 'Vacante a planificación',
  VACANTE_PROTOCOLO_COBERTURA: 'Vacante protocolo',
  RETENCION_LARGA: 'Retención prolongada',
  POSICION_SIN_RELEVO: 'Sin relevo',
  RECARGO_12H: 'Recargo 12h',
  RECARGO_MAXIMO: 'Recargo máximo',
  ERROR_PLANIFICACION: 'Error planificación',
};

const SectionLabel = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap" style={{ color: 'var(--txt3)' }}>{label}</span>
    <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
  </div>
);

// ─── RADIAL PROGRESS ──────────────────────────────────────────────────────────
const RadialProgress = ({ pct, color, size = 76 }: { pct: number; color: string; size?: number }) => {
  const r = size / 2 - 7;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={6}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}/>
    </svg>
  );
};

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
const KpiCard = ({ title, value, icon: Icon, color, subtext, alert, noData, progress, href, onClick }: any) => {
  const clickable = !!(href || onClick);
  const inner = (
    <div
      role="group"
      aria-label={title}
      className={`px-4 py-4 rounded-xl border transition-all flex flex-col gap-2.5 ${noData ? 'opacity-55' : ''} ${clickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''}`}
      style={{
        backgroundColor: 'var(--surf)',
        borderColor: alert ? 'rgba(239,68,68,0.4)' : 'var(--border)',
        borderTop: `2px solid ${alert ? '#ef4444' : 'var(--company-primary, #6366f1)'}`,
      }}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg shrink-0 flex items-center justify-center" style={{ background: color + '22' }}>
          <Icon size={16} color={color} strokeWidth={2.5} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-black uppercase tracking-wider leading-tight truncate" style={{ color: 'var(--txt3)' }}>{title}</p>
          <p className="text-2xl font-black leading-tight" style={{ color: noData ? 'var(--txt3)' : (alert ? '#ef4444' : 'var(--txt)') }}>
            {noData ? '—' : value}
          </p>
          {subtext && <p className="text-[10px] font-medium leading-tight mt-0.5 truncate" style={{ color: 'var(--txt3)' }}>{subtext}</p>}
        </div>
        {clickable && <ArrowRight size={12} style={{ color: 'var(--txt3)', marginTop: 4 }} className="shrink-0"/>}
      </div>
      {progress !== undefined && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: alert ? '#ef4444' : color }}/>
        </div>
      )}
    </div>
  );
  if (href) return <a href={href} className="block no-underline">{inner}</a>;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full text-left no-underline border-0 bg-transparent p-0">
        {inner}
      </button>
    );
  }
  return inner;
};

type DetailModalKind =
  | 'vacantes'
  | 'novedades'
  | 'ausentes'
  | 'contratos_vencer'
  | 'servicios_riesgo'
  | 'empleados_sin_turno'
  | 'concentracion_riesgo'
  | 'licencias';

interface TurnoDetalleRow {
  client: string;
  objective: string;
  puesto: string;
  hora: string;
  codigo: string;
  empleado?: string;
}

interface NovedadDetalleRow {
  titulo: string;
  descripcion: string;
  objetivo: string;
  empleado: string;
  hora: string;
}

function DashboardDetailModal({
  kind,
  onClose,
  vacantesDetalle,
  novedadesDetalle,
  ausentesDetalle,
  serviciosPorVencer,
  serviciosEnRiesgo,
  empleadosSinTurnoDetalle,
  topClientes,
  licencias,
  counts,
}: {
  kind: DetailModalKind;
  onClose: () => void;
  vacantesDetalle: TurnoDetalleRow[];
  novedadesDetalle: NovedadDetalleRow[];
  ausentesDetalle: TurnoDetalleRow[];
  serviciosPorVencer: { client: string; objective: string; dias: number }[];
  serviciosEnRiesgo: RiesgoRow[];
  empleadosSinTurnoDetalle: string[];
  topClientes: ClientHrs[];
  licencias: LicenciaRow[];
  counts: { vacantes: number; novedades: number; ausentes: number; sinTurno: number };
}) {
  const config: Record<DetailModalKind, { title: string; href: string; hrefLabel: string }> = {
    vacantes: { title: 'Puestos vacantes hoy', href: '/admin/operaciones', hrefLabel: 'Ir a Operaciones' },
    novedades: { title: 'Novedades registradas hoy', href: '/admin/operaciones', hrefLabel: 'Ir a Operaciones' },
    ausentes: { title: 'Ausentes confirmados hoy', href: '/admin/operaciones', hrefLabel: 'Ir a Operaciones' },
    contratos_vencer: { title: 'Contratos por vencer', href: '/admin/servicios', hrefLabel: 'Ir a Servicios y SLA' },
    servicios_riesgo: { title: 'Servicios con cobertura baja', href: '/admin/planificacion', hrefLabel: 'Ir a Planificación' },
    empleados_sin_turno: { title: 'Empleados sin turno este mes', href: '/admin/planificacion', hrefLabel: 'Ir a Planificación' },
    concentracion_riesgo: { title: 'Concentración de horas por cliente', href: '/admin/crm', hrefLabel: 'Ir a Clientes y Objetivos' },
    licencias: { title: 'Licencias activas hoy', href: '/admin/empleados', hrefLabel: 'Ir a Personal' },
  };
  const { title, href, hrefLabel } = config[kind];

  const emptyWithCount = (count: number, label: string) => (
    <div className="py-4 space-y-2">
      <p className="text-sm font-medium" style={{ color: 'var(--txt3)' }}>
        El panel registra <strong>{count}</strong> {label}, pero el detalle aún no está cargado.
      </p>
      <p className="text-xs font-medium" style={{ color: 'var(--txt3)' }}>
        Usá <strong>Actualizar</strong> arriba a la derecha o esperá unos segundos a que termine la sincronización.
      </p>
    </div>
  );

  const renderTurnoRows = (rows: TurnoDetalleRow[], emptyMsg: string, expectedCount = 0) => {
    if (rows.length === 0) {
      if (expectedCount > 0) return emptyWithCount(expectedCount, emptyMsg.toLowerCase());
      return <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>{emptyMsg}</p>;
    }
    return (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {rows.map((r, i) => (
          <li key={i} className="px-4 py-3" style={{ backgroundColor: 'var(--surf)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              {r.client} — {r.objective}
            </p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>
              {r.puesto} · {r.hora} · código {r.codigo}
              {r.empleado ? ` · ${r.empleado}` : ''}
            </p>
          </li>
        ))}
      </ul>
    );
  };

  let body: React.ReactNode = null;
  if (kind === 'vacantes') {
    body = renderTurnoRows(vacantesDetalle, 'puestos vacantes hoy', counts.vacantes);
  } else if (kind === 'ausentes') {
    body = renderTurnoRows(ausentesDetalle, 'ausencias confirmadas hoy', counts.ausentes);
  } else if (kind === 'novedades') {
    body = novedadesDetalle.length === 0 ? (
      counts.novedades > 0 ? emptyWithCount(counts.novedades, 'novedades hoy') : (
        <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>No hay novedades registradas hoy.</p>
      )
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {novedadesDetalle.map((n, i) => (
          <li key={i} className="px-4 py-3" style={{ backgroundColor: 'var(--surf)' }}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{n.titulo}</p>
              {n.hora && <span className="text-[10px] font-bold shrink-0" style={{ color: 'var(--txt3)' }}>{n.hora}</span>}
            </div>
            {n.descripcion && (
              <p className="text-xs font-medium mt-1" style={{ color: 'var(--txt)' }}>{n.descripcion}</p>
            )}
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--txt3)' }}>
              {[n.objetivo, n.empleado].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    );
  } else if (kind === 'contratos_vencer') {
    const list = serviciosPorVencer.filter(s => s.dias <= 30);
    body = list.length === 0 ? (
      <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>No hay contratos por vencer en los próximos 30 días.</p>
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {list.map((s, i) => (
          <li key={i} className="px-4 py-3 flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--surf)' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{s.client} — {s.objective}</p>
            </div>
            <span className={`text-xs font-black shrink-0 ${s.dias <= 15 ? 'text-red-600' : 'text-amber-600'}`}>
              {s.dias === 0 ? 'Vence hoy' : `${s.dias} días`}
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (kind === 'servicios_riesgo') {
    body = serviciosEnRiesgo.length === 0 ? (
      <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>Todos los servicios con cobertura normal.</p>
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {serviciosEnRiesgo.map((s, i) => (
          <li key={i} className="px-4 py-3" style={{ backgroundColor: 'var(--surf)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{s.client} — {s.name}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>
              {s.vacPct}% vacantes · {s.absPct}% ausencias (mes en curso)
            </p>
          </li>
        ))}
      </ul>
    );
  } else if (kind === 'empleados_sin_turno') {
    body = empleadosSinTurnoDetalle.length === 0 ? (
      counts.sinTurno > 0 ? emptyWithCount(counts.sinTurno, 'empleados sin turno este mes') : (
        <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>Todos los empleados activos tienen turnos planificados este mes.</p>
      )
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border max-h-80 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
        {empleadosSinTurnoDetalle.map((name, i) => (
          <li key={i} className="px-4 py-2.5 text-sm font-semibold" style={{ backgroundColor: 'var(--surf)', color: 'var(--txt)' }}>
            {name}
          </li>
        ))}
      </ul>
    );
  } else if (kind === 'concentracion_riesgo') {
    body = topClientes.length === 0 ? (
      <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>Sin datos de distribución por cliente.</p>
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {topClientes.map((c, i) => (
          <li key={i} className="px-4 py-3 flex items-center justify-between gap-3" style={{ backgroundColor: 'var(--surf)' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{c.name}</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>{fmt(c.hrs)} hs SLA del mes</p>
            </div>
            <span className="text-sm font-black shrink-0" style={{ color: 'var(--company-primary,#6366f1)' }}>{c.pct}%</span>
          </li>
        ))}
      </ul>
    );
  } else if (kind === 'licencias') {
    body = licencias.length === 0 ? (
      <p className="text-sm font-medium py-4" style={{ color: 'var(--txt3)' }}>Sin licencias activas hoy.</p>
    ) : (
      <ul className="divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {licencias.map((lic, i) => (
          <li key={i} className="px-4 py-3 flex items-center justify-between gap-3" style={{ backgroundColor: 'var(--surf)' }}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-black text-[11px] shrink-0">
                {lic.empName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{lic.empName}</p>
                <p className="text-[10px]" style={{ color: 'var(--txt3)' }}>{lic.from} → {lic.to}</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap shrink-0">
              {lic.reason}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/45 border-0" aria-label="Cerrar" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-black" style={{ color: 'var(--txt)' }}>{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg border-0 cursor-pointer hover:bg-black/5" aria-label="Cerrar">
            <X size={18} style={{ color: 'var(--txt3)' }} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{body}</div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--txt3)', backgroundColor: 'transparent' }}>
            Cerrar
          </button>
          <a href={href} className="px-4 py-2 rounded-lg text-xs font-bold no-underline text-white"
            style={{ backgroundColor: 'var(--company-primary, #6366f1)' }}>
            {hrefLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── TIPOS ────────────────────────────────────────────────────────────────────
interface LicenciaRow { empName: string; reason: string; from: string; to: string; }
interface RiesgoRow { name: string; client: string; vacPct: number; absPct: number; }
interface ClientHrs { name: string; hrs: number; pct: number; }

// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_KEY_PREFIX = 'dashboard_cache_v6';
const CACHE_TTL = 5 * 60 * 1000;

function cacheKeyForEmpresa(empresaId: string) {
  return `${CACHE_KEY_PREFIX}_${empresaId || 'legacy'}`;
}
function cacheHasDetailPayload(data: Record<string, unknown>): boolean {
  return (
    Array.isArray(data.vacantesDetalle) &&
    Array.isArray(data.novedadesDetalle) &&
    Array.isArray(data.ausentesDetalle) &&
    Array.isArray(data.empleadosSinTurnoDetalle)
  );
}
function saveCache(empresaId: string, data: Record<string, any>) {
  try { localStorage.setItem(cacheKeyForEmpresa(empresaId), JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function loadCache(empresaId: string): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(cacheKeyForEmpresa(empresaId));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts >= CACHE_TTL) return null;
    if (!cacheHasDetailPayload(data)) return null;
    return data;
  } catch { return null; }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
function AdminDashboard() {
  const { empresaId, empresa, loadingEmpresa } = useEmpresa();
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;

  const [loading, setLoading]           = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey]     = useState(0);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [fromCache, setFromCache]       = useState(false);

  // ── Estructura
  const [clientsCount, setClientsCount]               = useState(0);
  const [objectivesCount, setObjectivesCount]         = useState(0);
  const [activeServicesCount, setActiveServicesCount] = useState(0);
  const [slaTotalHrs, setSlaTotalHrs]                 = useState(0);
  const [slaNightHrs, setSlaNightHrs]                 = useState(0);
  const [slaHolidayHrs, setSlaHolidayHrs]             = useState(0);
  const [slaWeekendHrs, setSlaWeekendHrs]             = useState(0);
  const [activeServicesList, setActiveServicesList]   = useState<{client:string; objective:string; hrs:number}[]>([]);

  // ── Personal
  const [totalEmployees, setTotalEmployees]     = useState(0);
  const [enServicioHoy, setEnServicioHoy]       = useState(0);
  const [presentesHoy, setPresentesHoy]         = useState(0);
  const [enServicioActivo, setEnServicioActivo] = useState(0);
  const [francoHoy, setFrancoHoy]               = useState(0);
  const [vacantesHoy, setVacantesHoy]           = useState(0);
  const [ausentesHoy, setAusentesHoy]           = useState(0);
  const [novedadesHoy, setNovedadesHoy]         = useState(0);
  const [vacantesDetalle, setVacantesDetalle]     = useState<TurnoDetalleRow[]>([]);
  const [ausentesDetalle, setAusentesDetalle]     = useState<TurnoDetalleRow[]>([]);
  const [novedadesDetalle, setNovedadesDetalle]   = useState<NovedadDetalleRow[]>([]);
  const [empleadosSinTurnoDetalle, setEmpleadosSinTurnoDetalle] = useState<string[]>([]);
  const [detailModal, setDetailModal]           = useState<DetailModalKind | null>(null);
  const [portalReady, setPortalReady]           = useState(false);

  // ── Planificación
  const [hasPlanificacion, setHasPlanificacion] = useState(false);
  const [coveragePct, setCoveragePct]           = useState(0);

  // ── KPI horas promedio
  const [avgHrsVigilador, setAvgHrsVigilador]           = useState(0);
  const [vigiladoresConTurno, setVigiladoresConTurno]   = useState(0);

  // ── Licencias
  const [licencias, setLicencias]                 = useState<LicenciaRow[]>([]);
  const [licenciasByReason, setLicenciasByReason] = useState<{name:string; value:number; color:string}[]>([]);

  // ── Ausencias históricas
  const [absenceChart, setAbsenceChart] = useState<{name:string; value:number}[]>([]);

  // ── Distribución objetivos
  const [distChart, setDistChart] = useState<{name:string; value:number}[]>([]);

  // ── NUEVOS: Cumplimiento real
  const [realHoursMonth, setRealHoursMonth]         = useState(0);
  const [plannedHrsMonth, setPlannedHrsMonth]       = useState(0);

  // ── NUEVOS: Servicios en riesgo
  const [serviciosEnRiesgo, setServiciosEnRiesgo] = useState<RiesgoRow[]>([]);

  // ── NUEVOS: Gestión comercial
  const [concentracionPct, setConcentracionPct] = useState(0);
  const [topClientes, setTopClientes]           = useState<ClientHrs[]>([]);
  const [serviciosPorVencer, setServiciosPorVencer] = useState<{client:string; objective:string; dias:number}[]>([]);

  // ── NUEVOS: Personal estratégico
  const [empleadosSinTurno, setEmpleadosSinTurno] = useState(0);
  const [tasaAusentismo30, setTasaAusentismo30]   = useState(0);

  const today    = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // ── SEMÁFORO (derivado)
  const semaforo = useMemo((): 'verde' | 'amarillo' | 'rojo' | 'gris' => {
    if (!hasPlanificacion) return 'gris';
    // Solo penalizar por cumplimiento real si hay timestamps de check-in registrados
    const cumplimientoReal = (plannedHrsMonth > 0 && realHoursMonth > 0) ? (realHoursMonth / plannedHrsMonth) * 100 : 100;
    if (coveragePct < 90 || vacantesHoy > 3 || (realHoursMonth > 0 && cumplimientoReal < 85)) return 'rojo';
    if (coveragePct < 95 || vacantesHoy > 0 || serviciosEnRiesgo.length > 0 || serviciosPorVencer.filter(s => s.dias <= 15).length > 0) return 'amarillo';
    return 'verde';
  }, [hasPlanificacion, coveragePct, vacantesHoy, serviciosEnRiesgo, serviciosPorVencer, realHoursMonth, plannedHrsMonth]);

  // ── ALERTAS CRÍTICAS (derivado)
  const alertasCriticas = useMemo(() => {
    const list: { type: 'error' | 'warning' | 'info'; msg: string; href?: string; modal?: DetailModalKind }[] = [];
    if (vacantesHoy > 0)
      list.push({ type: 'error', msg: `${vacantesHoy} puesto${vacantesHoy > 1 ? 's' : ''} vacante${vacantesHoy > 1 ? 's' : ''} sin cubrir hoy`, modal: 'vacantes' });
    if (novedadesHoy > 0)
      list.push({ type: 'warning', msg: `${novedadesHoy} novedad${novedadesHoy > 1 ? 'es' : ''} registrada${novedadesHoy > 1 ? 's' : ''} hoy`, modal: 'novedades' });
    if (serviciosPorVencer.filter(s => s.dias <= 15).length > 0) {
      const n = serviciosPorVencer.filter(s => s.dias <= 15).length;
      list.push({ type: 'error', msg: `${n} contrato${n > 1 ? 's' : ''} vence${n > 1 ? 'n' : ''} en menos de 15 días`, modal: 'contratos_vencer' });
    } else if (serviciosPorVencer.filter(s => s.dias <= 30).length > 0) {
      const n = serviciosPorVencer.filter(s => s.dias <= 30).length;
      list.push({ type: 'warning', msg: `${n} contrato${n > 1 ? 's' : ''} vence${n > 1 ? 'n' : ''} en menos de 30 días`, modal: 'contratos_vencer' });
    }
    if (serviciosEnRiesgo.length > 0)
      list.push({ type: 'warning', msg: `${serviciosEnRiesgo.length} servicio${serviciosEnRiesgo.length > 1 ? 's' : ''} con cobertura baja este mes`, modal: 'servicios_riesgo' });
    if (empleadosSinTurno > 0)
      list.push({ type: 'info', msg: `${empleadosSinTurno} empleado${empleadosSinTurno > 1 ? 's' : ''} sin turno asignado este mes`, modal: 'empleados_sin_turno' });
    if (concentracionPct >= 70)
      list.push({ type: 'warning', msg: `Concentración de riesgo: top 3 clientes representan el ${concentracionPct}% de las horas`, modal: 'concentracion_riesgo' });
    return list;
  }, [vacantesHoy, novedadesHoy, serviciosPorVencer, serviciosEnRiesgo, empleadosSinTurno, concentracionPct]);

  useEffect(() => { setPortalReady(true); }, []);

  useEffect(() => {
    if (!detailModal || !empresaId || isRefreshing) return;
    const stale =
      (detailModal === 'vacantes' && vacantesHoy > 0 && vacantesDetalle.length === 0) ||
      (detailModal === 'novedades' && novedadesHoy > 0 && novedadesDetalle.length === 0) ||
      (detailModal === 'ausentes' && ausentesHoy > 0 && ausentesDetalle.length === 0) ||
      (detailModal === 'empleados_sin_turno' && empleadosSinTurno > 0 && empleadosSinTurnoDetalle.length === 0);
    if (!stale) return;
    try { localStorage.removeItem(cacheKeyForEmpresa(empresaId)); } catch {}
    setIsRefreshing(true);
    fetchAll(true);
  }, [detailModal, empresaId, vacantesHoy, vacantesDetalle.length, novedadesHoy, novedadesDetalle.length, ausentesHoy, ausentesDetalle.length, empleadosSinTurno, empleadosSinTurnoDetalle.length, isRefreshing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loadingEmpresa || !empresaId) return;
    const cached = loadCache(empresaId);
    if (cached) {
      applyState(cached);
      setFromCache(true);
      setLoading(false);
      setIsRefreshing(true);
      fetchAll(true);
    } else {
      setFromCache(false);
      fetchAll(false);
    }
  }, [loadingEmpresa, empresaId, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (refreshKey === 0 || !empresaId) return;
    setIsRefreshing(true);
    fetchAll(true);
  }, [refreshKey, empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!empresaId) return;
    const t = setInterval(() => { setIsRefreshing(true); fetchAll(true); }, CACHE_TTL);
    return () => clearInterval(t);
  }, [empresaId, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyState = (d: Record<string, any>) => {
    setClientsCount(d.clientsCount ?? 0);
    setObjectivesCount(d.objectivesCount ?? 0);
    setActiveServicesCount(d.activeServicesCount ?? 0);
    setSlaTotalHrs(d.slaTotalHrs ?? 0);
    setSlaNightHrs(d.slaNightHrs ?? 0);
    setSlaHolidayHrs(d.slaHolidayHrs ?? 0);
    setSlaWeekendHrs(d.slaWeekendHrs ?? 0);
    setActiveServicesList(d.activeServicesList ?? []);
    setTotalEmployees(d.totalEmployees ?? 0);
    setEnServicioHoy(d.enServicioHoy ?? 0);
    setPresentesHoy(d.presentesHoy ?? 0);
    setEnServicioActivo(d.enServicioActivo ?? 0);
    setFrancoHoy(d.francoHoy ?? 0);
    setVacantesHoy(d.vacantesHoy ?? 0);
    setAusentesHoy(d.ausentesHoy ?? 0);
    setNovedadesHoy(d.novedadesHoy ?? 0);
    setVacantesDetalle(d.vacantesDetalle ?? []);
    setAusentesDetalle(d.ausentesDetalle ?? []);
    setNovedadesDetalle(d.novedadesDetalle ?? []);
    setEmpleadosSinTurnoDetalle(d.empleadosSinTurnoDetalle ?? []);
    setHasPlanificacion(d.hasPlanificacion ?? false);
    setCoveragePct(d.coveragePct ?? 0);
    setAvgHrsVigilador(d.avgHrsVigilador ?? 0);
    setVigiladoresConTurno(d.vigiladoresConTurno ?? 0);
    setLicencias(d.licencias ?? []);
    setLicenciasByReason(d.licenciasByReason ?? []);
    setAbsenceChart(d.absenceChart ?? []);
    setDistChart(d.distChart ?? []);
    setRealHoursMonth(d.realHoursMonth ?? 0);
    setPlannedHrsMonth(d.plannedHrsMonth ?? 0);
    setServiciosEnRiesgo(d.serviciosEnRiesgo ?? []);
    setConcentracionPct(d.concentracionPct ?? 0);
    setTopClientes(d.topClientes ?? []);
    setServiciosPorVencer(d.serviciosPorVencer ?? []);
    setEmpleadosSinTurno(d.empleadosSinTurno ?? 0);
    setTasaAusentismo30(d.tasaAusentismo30 ?? 0);
    if (d.lastUpdated) setLastUpdated(new Date(d.lastUpdated));
  };

  // ─── FETCH PRINCIPAL ──────────────────────────────────────────────────────
  const fetchAll = async (background = false) => {
    if (!empresaId) return;
    if (!background) setLoading(true);
    try {
      const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
      const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

      const clientsQ = scopeEmpresa
        ? query(collection(db, 'clients'), where('empresaId', '==', empresaId))
        : collection(db, 'clients');
      const svcQ = scopeEmpresa
        ? query(collection(db, 'servicios_sla'), where('empresaId', '==', empresaId))
        : collection(db, 'servicios_sla');
      const empQ = scopeEmpresa
        ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
        : collection(db, 'empleados');
      const ausQ = scopeEmpresa
        ? query(collection(db, 'ausencias'), where('empresaId', '==', empresaId))
        : collection(db, 'ausencias');

      const novedadesQ = scopeEmpresa
        ? query(
            collection(db, 'novedades'),
            where('empresaId', '==', empresaId),
            where('createdAt', '>=', Timestamp.fromDate(todayStart)),
            orderBy('createdAt', 'desc'),
            limit(80),
          )
        : query(
            collection(db, 'novedades'),
            where('createdAt', '>=', Timestamp.fromDate(todayStart)),
            orderBy('createdAt', 'desc'),
            limit(80),
          );

      const [clientsSnap, svcSnap, empSnap, ausSnap, turnosSnap, monthTurnosSnap, novedadesSnap] = await Promise.all([
        getDocs(clientsQ),
        getDocs(svcQ),
        getDocs(empQ),
        getDocs(ausQ),
        getDocs(query(collection(db, 'turnos'),
          where('startTime', '>=', Timestamp.fromDate(todayStart)),
          where('startTime', '<=', Timestamp.fromDate(todayEnd)))),
        getDocs(query(collection(db, 'turnos'),
          where('startTime', '>=', Timestamp.fromDate(monthStart)),
          where('startTime', '<=', Timestamp.fromDate(monthEnd)))),
        getDocs(novedadesQ),
      ]);

      // 1. CLIENTES
      let cCount = 0, oCount = 0;
      clientsSnap.forEach(d => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        cCount++;
        oCount += (data.objetivos || data.objectives || []).length;
      });

      // 2. SERVICIOS SLA
      let svcCount = 0, totalSlaH = 0, nightSlaH = 0, holSlaH = 0, wkndSlaH = 0;
      const svcList: {client:string; objective:string; hrs:number}[] = [];
      const kpiYear = today.getFullYear(), kpiMonth = today.getMonth();
      svcSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        const sd = d.startDate || '', ed = d.endDate || '';
        if (!serviceOverlapsMonth(sd, ed, kpiYear, kpiMonth)) return;
        svcCount++;
        const { total, night, holiday, weekend } = calculateSlaHoursForMonth(
          d.positions || [], sd, ed, d.excludedDates, kpiYear, kpiMonth,
        );
        totalSlaH += total; nightSlaH += night; holSlaH += holiday; wkndSlaH += weekend;
        if (total > 0) svcList.push({ client: d.clientName || 'Cliente', objective: d.objectiveName || 'Objetivo', hrs: Math.round(total) });
      });

      // 3. EMPLEADOS
      const empMap: Record<string, string> = {};
      let totalEmp = 0;
      empSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        empMap[doc.id] = d.nombre ? `${d.nombre} ${d.apellido || ''}`.trim() : (d.name || doc.id);
        if (['active','activo','activa'].includes((d.status || '').toLowerCase())) totalEmp++;
      });

      // 4. AUSENCIAS / LICENCIAS
      const licRows: LicenciaRow[] = [];
      const licReasonMap: Record<string, number> = {};
      const absMap30: Record<string, number> = {};
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      ausSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        const from = d.startDate || d.date || '', to = d.endDate || d.date || from;
        const reason = d.type || d.reason || d.motivo || 'Sin motivo';
        if (from <= todayStr && to >= todayStr) {
          const empId = d.employeeId || d.empleadoId || '';
          licRows.push({ empName: empMap[empId] || empId || 'Empleado', reason, from, to });
          licReasonMap[reason] = (licReasonMap[reason] || 0) + 1;
        }
        if (from >= cutoffStr) absMap30[reason] = (absMap30[reason] || 0) + 1;
      });

      // 5. DISTRIBUCIÓN POR OBJETIVO
      const distMap: Record<string, number> = {};
      empSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        if (['active','activo','activa'].includes((d.status||'').toLowerCase())) {
          const obj = d.preferredObjectiveName || d.objectiveName || 'Sin Objetivo';
          distMap[obj] = (distMap[obj] || 0) + 1;
        }
      });

      // 6. TURNOS HOY
      const NON_SERVICE_TODAY = new Set(['F','FF','V','L','A','E','AA','AUS']);
      const activeGuards = new Set<string>(), francoGuards = new Set<string>();
      const presentesSet = new Set<string>(), enServicioActivoSet = new Set<string>();
      const vacantesDetalleList: TurnoDetalleRow[] = [];
      const ausentesDetalleList: TurnoDetalleRow[] = [];
      let vacantes = 0, absent = 0, novedadesShiftFlag = 0, totalTurnos = 0, serviceShiftsCount = 0;

      turnosSnap.forEach(doc => {
        const s = doc.data();
        if (!belongsToEmpresaView(s, empresaId, migracionCompleta)) return;
        if (s.status === 'Canceled' || s.status === 'CANCELED') return;
        if (s.employeeId && s.employeeId !== 'VACANTE' && !empMap[s.employeeId]) return;
        totalTurnos++;
        if (!s.employeeId || s.employeeId === 'VACANTE') {
          vacantes++;
          vacantesDetalleList.push({
            client: String(s.clientName || '—'),
            objective: String(s.objectiveName || '—'),
            puesto: String(s.positionName || '—'),
            hora: formatShiftStart(s.startTime as { seconds?: number }),
            codigo: String(s.code || s.type || '—').toUpperCase(),
          });
          return;
        }
        const code = (s.code || s.type || '').toString().toUpperCase();
        if (code === 'F') francoGuards.add(s.employeeId);
        if (!NON_SERVICE_TODAY.has(code)) {
          activeGuards.add(s.employeeId);
          serviceShiftsCount++;
        }
        if (s.status === 'ABSENT' || s.isAbsent === true) {
          absent++;
          ausentesDetalleList.push({
            client: String(s.clientName || '—'),
            objective: String(s.objectiveName || '—'),
            puesto: String(s.positionName || '—'),
            hora: formatShiftStart(s.startTime as { seconds?: number }),
            codigo: code || '—',
            empleado: String(s.employeeName || empMap[s.employeeId] || '—'),
          });
        }
        if (s.hasNovedad) novedadesShiftFlag++;
        if (s.isPresent || s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isCompleted) presentesSet.add(s.employeeId);
        if ((s.isPresent || s.status === 'PRESENT') && s.status !== 'COMPLETED' && !s.isCompleted) enServicioActivoSet.add(s.employeeId);
      });

      const novedadesDetalleList: NovedadDetalleRow[] = [];
      const novedadesShiftIdsCovered = new Set<string>();
      novedadesSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        const shiftId = String(d.shiftId || '');
        if (shiftId) novedadesShiftIdsCovered.add(shiftId);
        const typeKey = String(d.type || '').trim();
        const titulo = String(d.title || NOVEDAD_TYPE_LABELS[typeKey] || typeKey || 'Novedad');
        novedadesDetalleList.push({
          titulo,
          descripcion: String(d.description || d.details || '').trim(),
          objetivo: String(d.objectiveName || '—'),
          empleado: String(d.employeeName || '').trim(),
          hora: d.createdAt?.seconds
            ? new Date(d.createdAt.seconds * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : '',
        });
      });

      turnosSnap.forEach(doc => {
        const s = doc.data();
        if (!belongsToEmpresaView(s, empresaId, migracionCompleta)) return;
        if (!s.hasNovedad || novedadesShiftIdsCovered.has(doc.id)) return;
        novedadesDetalleList.push({
          titulo: 'Novedad en planificación',
          descripcion: String(s.comments || 'Turno con novedad pendiente').trim(),
          objetivo: String(s.objectiveName || '—'),
          empleado: String(s.employeeName || empMap[s.employeeId] || '—'),
          hora: formatShiftStart(s.startTime as { seconds?: number }),
        });
      });

      const novedades = novedadesDetalleList.length > 0 ? novedadesDetalleList.length : novedadesShiftFlag;

      vacantesDetalleList.sort((a, b) => `${a.client} ${a.objective}`.localeCompare(`${b.client} ${b.objective}`, 'es'));
      ausentesDetalleList.sort((a, b) => `${a.client} ${a.empleado}`.localeCompare(`${b.client} ${b.empleado}`, 'es'));

      // 7. HORAS PLANIFICADAS Y REALES DEL MES
      const SHIFT_HRS: Record<string,number> = { M:8,T:8,N:8,D12:12,N12:12,FT:8 };
      const NON_WORKING = new Set(['F','FF','V','L','A','E','AA','AUS']);
      let mTotalHrs = 0, mRealHrs = 0;
      const empHrsMap: Record<string,number> = {};

      // Para servicios en riesgo: agrupar por objetivo
      const objRiesgoMap: Record<string, {client:string;name:string;total:number;vacantes:number;ausentes:number}> = {};

      monthTurnosSnap.forEach(doc => {
        const s = doc.data();
        if (!belongsToEmpresaView(s, empresaId, migracionCompleta)) return;
        if (s.status === 'Canceled' || s.status === 'CANCELED') return;

        // Servicios en riesgo (agrupa todos, incluyendo vacantes)
        const objKey = s.objectiveId || s.objectiveName || 'unknown';
        if (objKey !== 'unknown') {
          if (!objRiesgoMap[objKey]) objRiesgoMap[objKey] = {
            client: s.clientName || 'Cliente',
            name: s.objectiveName || 'Objetivo',
            total: 0, vacantes: 0, ausentes: 0,
          };
          objRiesgoMap[objKey].total++;
          if (!s.employeeId || s.employeeId === 'VACANTE') objRiesgoMap[objKey].vacantes++;
          if (s.status === 'ABSENT') objRiesgoMap[objKey].ausentes++;
        }

        // Horas planificadas (solo turnos con empleado asignado)
        if (!s.employeeId || s.employeeId === 'VACANTE' || !empMap[s.employeeId]) return;
        const code = (s.code || s.type || '').toString().toUpperCase();
        if (NON_WORKING.has(code)) return;
        const hrs = Number(s.hours) || SHIFT_HRS[code] || 8;
        mTotalHrs += hrs;
        empHrsMap[s.employeeId] = (empHrsMap[s.employeeId] || 0) + hrs;

        // Horas reales (turnos completados con timestamps)
        const rStart = s.realStartTime?.seconds
          ? new Date(s.realStartTime.seconds * 1000)
          : s.checkInTime?.seconds ? new Date(s.checkInTime.seconds * 1000) : null;
        const rEnd = s.realEndTime?.seconds
          ? new Date(s.realEndTime.seconds * 1000)
          : s.checkOutTime?.seconds ? new Date(s.checkOutTime.seconds * 1000) : null;
        if (rStart && rEnd && rEnd > rStart) {
          mRealHrs += (rEnd.getTime() - rStart.getTime()) / 3600000;
        }
      });

      // 8. SERVICIOS EN RIESGO (>3% vacantes+ausencias, mínimo 5 turnos)
      const riesgoList = Object.values(objRiesgoMap)
        .filter(o => o.total >= 5 && (o.vacantes + o.ausentes) / o.total > 0.03)
        .map(o => ({
          name: o.name.length > 22 ? o.name.slice(0, 22) + '…' : o.name,
          client: o.client.length > 18 ? o.client.slice(0, 18) + '…' : o.client,
          vacPct: Math.round((o.vacantes / o.total) * 100),
          absPct: Math.round((o.ausentes / o.total) * 100),
        }))
        .sort((a,b) => (b.vacPct + b.absPct) - (a.vacPct + a.absPct))
        .slice(0, 5);

      // 9. CONCENTRACIÓN DE RIESGO (por cliente)
      const clientHrsAgg: Record<string, number> = {};
      svcList.forEach(s => { clientHrsAgg[s.client] = (clientHrsAgg[s.client] || 0) + s.hrs; });
      const clientHrsSorted = Object.entries(clientHrsAgg).sort((a,b) => b[1] - a[1]);
      const top3Total = clientHrsSorted.slice(0, 3).reduce((a,[,v]) => a + v, 0);
      const concPct = totalSlaH > 0 ? Math.round((top3Total / totalSlaH) * 100) : 0;
      const topClientsArr: ClientHrs[] = clientHrsSorted.slice(0, 5).map(([name, hrs]) => ({
        name: name.length > 22 ? name.slice(0, 22) + '…' : name,
        hrs: Math.round(hrs),
        pct: totalSlaH > 0 ? Math.round((hrs / totalSlaH) * 100) : 0,
      }));

      // 10. SERVICIOS POR VENCER (próximos 60 días)
      const porVencerList: {client:string; objective:string; dias:number}[] = [];
      svcSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        if (!d.endDate) return;
        const end = new Date(d.endDate + 'T23:59:59');
        const dias = Math.ceil((end.getTime() - today.getTime()) / 86400000);
        if (dias >= 0 && dias <= 60) {
          porVencerList.push({
            client: d.clientName || 'Cliente',
            objective: d.objectiveName || 'Objetivo',
            dias,
          });
        }
      });
      porVencerList.sort((a,b) => a.dias - b.dias);

      // 11. EMPLEADOS SIN TURNO ESTE MES
      const empleadosSinTurnoDetalleList: string[] = [];
      empSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        if (!['active', 'activo', 'activa'].includes(String(d.status || '').toLowerCase())) return;
        if (!empHrsMap[doc.id]) empleadosSinTurnoDetalleList.push(empMap[doc.id] || doc.id);
      });
      empleadosSinTurnoDetalleList.sort((a, b) => a.localeCompare(b, 'es'));
      const sinTurnoCount = empleadosSinTurnoDetalleList.length;

      // 12. TASA AUSENTISMO 30 DÍAS
      const totalAbs30 = Object.values(absMap30).reduce((a,b) => a + b, 0);
      const tasaAus30 = totalEmp > 0 ? parseFloat((totalAbs30 / totalEmp * 100).toFixed(1)) : 0;

      const hasPlan = totalTurnos > 0 && totalEmp > 0;
      const now = new Date();

      const newState = {
        clientsCount: cCount, objectivesCount: oCount,
        activeServicesCount: svcCount,
        slaTotalHrs: Math.round(totalSlaH), slaNightHrs: Math.round(nightSlaH), slaHolidayHrs: Math.round(holSlaH), slaWeekendHrs: Math.round(wkndSlaH),
        activeServicesList: svcList.sort((a,b) => b.hrs - a.hrs),
        totalEmployees: totalEmp,
        enServicioHoy: activeGuards.size, francoHoy: francoGuards.size, vacantesHoy: vacantes,
        presentesHoy: presentesSet.size, enServicioActivo: enServicioActivoSet.size,
        ausentesHoy: absent, novedadesHoy: novedades,
        vacantesDetalle: vacantesDetalleList,
        ausentesDetalle: ausentesDetalleList,
        novedadesDetalle: novedadesDetalleList,
        empleadosSinTurnoDetalle: empleadosSinTurnoDetalleList,
        hasPlanificacion: hasPlan,
        // Denominador = turnos de servicio real + vacantes (excluye F, FF, V, L, A, E, etc.)
        coveragePct: hasPlan && (serviceShiftsCount + vacantes) > 0
          ? ((serviceShiftsCount - absent) / (serviceShiftsCount + vacantes)) * 100
          : 0,
        avgHrsVigilador: totalEmp > 0 ? Math.round(totalSlaH / totalEmp) : 0,
        vigiladoresConTurno: totalEmp,
        licencias: licRows.slice(0, 8),
        licenciasByReason: Object.entries(licReasonMap).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] })).sort((a,b) => b.value - a.value),
        absenceChart: Object.entries(absMap30).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 6),
        distChart: Object.entries(distMap).map(([name, value]) => ({ name: name.length > 16 ? name.slice(0,16)+'…' : name, value })).sort((a,b) => b.value - a.value).slice(0, 6),
        // Nuevos
        realHoursMonth: Math.round(mRealHrs),
        plannedHrsMonth: Math.round(mTotalHrs),
        serviciosEnRiesgo: riesgoList,
        concentracionPct: concPct,
        topClientes: topClientsArr,
        serviciosPorVencer: porVencerList,
        empleadosSinTurno: sinTurnoCount,
        tasaAusentismo30: tasaAus30,
        lastUpdated: now.toISOString(),
      };

      applyState(newState);
      saveCache(empresaId, newState);
      setFromCache(false);
    } catch (err) {
      console.error('Dashboard fetchAll error:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // ── DERIVADOS
  const normalHrs = Math.max(0, slaTotalHrs - slaNightHrs - slaHolidayHrs - slaWeekendHrs);
  const cumplimientoRealPct = plannedHrsMonth > 0 ? Math.min(100, (realHoursMonth / plannedHrsMonth) * 100) : 0;
  const brechaPct = plannedHrsMonth > 0 ? Math.max(0, ((plannedHrsMonth - realHoursMonth) / plannedHrsMonth) * 100) : 0;

  const semaforoConfig = {
    verde:    { label: 'OPERACIÓN NORMAL',    color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.3)' },
    amarillo: { label: 'ATENCIÓN REQUERIDA',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)' },
    rojo:     { label: 'SITUACIÓN CRÍTICA',   color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)' },
    gris:     { label: 'SIN DATOS',           color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.3)' },
  }[semaforo];

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <Head><title>Panel de Control | CronoApp</title></Head>
      <div className="min-h-screen p-4 sm:p-6 pb-24 lg:pb-10 animate-in fade-in" style={{ backgroundColor: 'var(--app-bg)' }}>

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: 'var(--txt)' }}>
              <LayoutDashboard size={26} style={{ color: 'var(--company-primary,#6366f1)' }} aria-hidden="true"/>
              Panel de Control
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-sm font-medium capitalize" style={{ color: 'var(--txt3)' }}>
                {today.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
              </p>
              <span role="status" className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
                </span>
                EN VIVO
              </span>
              {lastUpdated && (
                <span className="text-[10px] font-medium" style={{ color: 'var(--txt3)' }}>
                  Act. {lastUpdated.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
                  {fromCache && <span className="ml-1 text-amber-500">· caché</span>}
                </span>
              )}
              {isRefreshing && !loading && (
                <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--company-primary,#6366f1)' }}>
                  <RefreshCw size={10} className="animate-spin"/> actualizando…
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              try { localStorage.removeItem(cacheKeyForEmpresa(empresaId)); } catch {}
              setFromCache(false);
              setRefreshKey(k => k + 1);
            }}
            disabled={loading || isRefreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50 border shrink-0"
            style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', color: 'var(--txt2)' }}
          >
            <RefreshCw size={13} className={isRefreshing || loading ? 'animate-spin' : ''}/> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"/>
              <p className="text-sm font-medium" style={{ color: 'var(--txt3)' }}>Cargando métricas...</p>
            </div>
          </div>
        ) : (
          <>
            {/* ══ BLOQUE 1: SEMÁFORO EJECUTIVO ══════════════════════════════ */}
            <SectionLabel label="Estado de la Operación" />
            <div className="mb-6 rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
              style={{ backgroundColor: semaforoConfig.bg, borderColor: semaforoConfig.border, borderLeft: `4px solid ${semaforoConfig.color}` }}>

              {/* Estado */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: semaforoConfig.color + '22' }}>
                  {semaforo === 'verde' && <CheckCircle2 size={20} color={semaforoConfig.color}/>}
                  {semaforo === 'amarillo' && <AlertTriangle size={20} color={semaforoConfig.color}/>}
                  {semaforo === 'rojo' && <AlertCircle size={20} color={semaforoConfig.color}/>}
                  {semaforo === 'gris' && <Info size={20} color={semaforoConfig.color}/>}
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: semaforoConfig.color }}>ESTADO GENERAL</p>
                  <p className="text-base font-black leading-tight" style={{ color: semaforoConfig.color }}>{semaforoConfig.label}</p>
                </div>
              </div>

              {/* Divisor */}
              <div className="hidden sm:block w-px self-stretch" style={{ backgroundColor: semaforoConfig.border }}/>
              <div className="sm:hidden h-px" style={{ backgroundColor: semaforoConfig.border }}/>

              {/* Alertas */}
              <div className="flex-1 min-w-0">
                {alertasCriticas.length === 0 ? (
                  <p className="text-sm font-bold text-emerald-700">Sin alertas activas — operación dentro de parámetros</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {alertasCriticas.map((a, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 ${a.modal ? 'cursor-pointer rounded-lg py-0.5 pr-1 -mr-1 hover:bg-black/[0.04] transition-colors' : ''}`}
                        onClick={a.modal ? () => setDetailModal(a.modal!) : undefined}
                        onKeyDown={a.modal ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailModal(a.modal!); } } : undefined}
                        role={a.modal ? 'button' : undefined}
                        tabIndex={a.modal ? 0 : undefined}
                      >
                        {a.type === 'error'   && <AlertCircle size={13} className="text-red-500 shrink-0"/>}
                        {a.type === 'warning' && <AlertTriangle size={13} className="text-amber-500 shrink-0"/>}
                        {a.type === 'info'    && <Info size={13} className="text-blue-500 shrink-0"/>}
                        <span className="text-xs font-semibold flex-1 min-w-0" style={{ color: 'var(--txt)' }}>{a.msg}</span>
                        {a.modal ? (
                          <span
                            className="ml-auto text-[10px] font-bold flex items-center gap-0.5 whitespace-nowrap shrink-0"
                            style={{ color: 'var(--company-primary,#6366f1)' }}>
                            Ver detalle <ArrowRight size={10}/>
                          </span>
                        ) : a.href ? (
                          <a
                            href={a.href}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-[10px] font-bold flex items-center gap-0.5 whitespace-nowrap hover:underline shrink-0"
                            style={{ color: 'var(--company-primary,#6366f1)' }}>
                            Ver <ArrowRight size={10}/>
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ══ BLOQUE 2: ESTRUCTURA OPERATIVA ════════════════════════════ */}
            <SectionLabel label="Estructura Operativa" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
              <KpiCard title="Clientes Activos" value={clientsCount}
                icon={Building2} color="#6366f1"
                subtext={`${objectivesCount} objetivos`}
                noData={clientsCount === 0} href="/admin/crm"/>
              <KpiCard title="Servicios Activos" value={activeServicesCount}
                icon={Briefcase} color="#0ea5e9"
                subtext={today.toLocaleString('es-AR',{month:'long',year:'numeric'})}
                noData={activeServicesCount === 0} href="/admin/servicios"/>
              <KpiCard title="Empleados en Nómina" value={totalEmployees}
                icon={Users} color="#10b981"
                subtext={totalEmployees > 0 ? `${enServicioHoy} asignados hoy` : 'Sin personal'}
                progress={totalEmployees > 0 ? (enServicioHoy / totalEmployees) * 100 : undefined}
                noData={totalEmployees === 0} href="/admin/empleados"/>
              <KpiCard title="Horas SLA del Mes" value={fmt(slaTotalHrs)}
                icon={Clock} color="#8b5cf6"
                subtext={activeServicesCount > 0 ? `${activeServicesCount} servicio${activeServicesCount>1?'s':''}` : 'Sin servicios'}
                noData={slaTotalHrs === 0}/>
              <KpiCard
                title="Prom. Hs/Vigilador"
                value={avgHrsVigilador > 0 ? `${avgHrsVigilador}h` : '—'}
                icon={TrendingUp} color="#f59e0b"
                subtext={vigiladoresConTurno > 0 ? `${vigiladoresConTurno} vigiladores` : 'Sin servicios'}
                noData={avgHrsVigilador === 0}/>
            </div>

            {/* ══ BLOQUE 3: PERSONAL HOY ═════════════════════════════════════ */}
            <SectionLabel label="Personal Hoy" />
            {!hasPlanificacion && (
              <div className="mb-4 flex items-center gap-3 p-3.5 rounded-xl border"
                style={{ backgroundColor: 'var(--surf)', borderColor: 'rgba(245,158,11,0.35)', borderLeft: '3px solid #f59e0b' }}>
                <Info size={15} className="text-amber-500 shrink-0"/>
                <p className="text-sm font-bold text-amber-600">Sin planificación cargada para hoy.</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <KpiCard title="En Servicio" value={enServicioHoy}
                icon={Activity} color="#6366f1"
                subtext={`de ${totalEmployees} en nómina`}
                progress={totalEmployees > 0 ? (enServicioHoy / totalEmployees) * 100 : undefined}
                noData={!hasPlanificacion} href="/admin/operaciones"/>
              <KpiCard title="Presentes" value={presentesHoy}
                icon={UserCheck} color="#10b981"
                subtext={hasPlanificacion
                  ? (enServicioActivo > 0
                      ? `${enServicioActivo} activos ahora · ${enServicioHoy} planificados`
                      : `de ${enServicioHoy} planificados`)
                  : 'Sin plan'}
                progress={hasPlanificacion && enServicioHoy > 0 ? (presentesHoy / enServicioHoy) * 100 : undefined}
                noData={!hasPlanificacion}/>
              <KpiCard title="Ausentes" value={ausentesHoy}
                icon={UserMinus} color="#ef4444"
                subtext="confirmados hoy"
                alert={ausentesHoy > 0}
                noData={!hasPlanificacion}
                onClick={ausentesHoy > 0 ? () => setDetailModal('ausentes') : undefined}/>
              <KpiCard title="De Franco" value={francoHoy}
                icon={Sun} color="#06b6d4"
                subtext="según planificación"
                noData={!hasPlanificacion}/>
              <KpiCard title="Vacantes" value={vacantesHoy}
                icon={AlertTriangle} color="#f59e0b"
                subtext="puestos sin cubrir"
                alert={vacantesHoy > 0}
                noData={!hasPlanificacion}
                onClick={vacantesHoy > 0 ? () => setDetailModal('vacantes') : undefined}/>
              <KpiCard title="Novedades" value={novedadesHoy}
                icon={Zap} color="#8b5cf6"
                subtext="registradas hoy"
                alert={novedadesHoy > 0}
                noData={!hasPlanificacion}
                onClick={novedadesHoy > 0 ? () => setDetailModal('novedades') : undefined}/>
            </div>

            {/* ══ BLOQUE 4: CUMPLIMIENTO OPERATIVO ══════════════════════════ */}
            <SectionLabel label="Cumplimiento Operativo" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

              {/* Cobertura hoy + horas reales vs planificadas */}
              <div className="rounded-xl border p-5 flex flex-col gap-4"
                style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', borderTop: '2px solid var(--company-primary, #6366f1)' }}>

                {/* Cobertura hoy */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>COBERTURA HOY</p>
                    <p className="text-4xl font-black leading-tight mt-1" style={{
                      color: !hasPlanificacion ? 'var(--txt3)' : coveragePct >= 95 ? '#10b981' : '#ef4444'
                    }}>
                      {hasPlanificacion ? `${coveragePct.toFixed(1)}%` : '—'}
                    </p>
                    <p className="text-[10px] font-medium mt-1" style={{ color: 'var(--txt3)' }}>
                      {!hasPlanificacion ? 'Sin planificación'
                        : coveragePct >= 95 ? '✓ Dentro de parámetros'
                        : '⚠ Por debajo del umbral (95%)'}
                    </p>
                    {hasPlanificacion && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] font-bold mb-1" style={{ color: 'var(--txt3)' }}>
                          <span>{presentesHoy} presentes</span>
                          <span>de {enServicioHoy} planificados</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: enServicioHoy > 0 ? `${Math.min(100,(presentesHoy/enServicioHoy)*100)}%` : '0%',
                              backgroundColor: coveragePct >= 95 ? '#10b981' : '#ef4444'
                            }}/>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative shrink-0">
                    <RadialProgress pct={hasPlanificacion ? coveragePct : 0}
                      color={!hasPlanificacion ? '#94a3b8' : coveragePct >= 95 ? '#10b981' : '#ef4444'} size={76}/>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Shield size={22} style={{ color: !hasPlanificacion ? '#94a3b8' : coveragePct >= 95 ? '#10b981' : '#ef4444' }}/>
                    </div>
                  </div>
                </div>

                {/* Divisor */}
                <div className="h-px" style={{ backgroundColor: 'var(--border)' }}/>

                {/* Horas reales vs planificadas del mes */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider mb-3" style={{ color: 'var(--txt3)' }}>
                    HORAS TRABAJADAS — MES ACTUAL
                  </p>
                  <div className="flex items-end gap-6">
                    <div>
                      <p className="text-[10px] font-bold" style={{ color: 'var(--txt3)' }}>Reales</p>
                      <p className="text-2xl font-black" style={{ color: 'var(--txt)' }}>{fmt(realHoursMonth)}<span className="text-sm font-bold ml-1">hs</span></p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold" style={{ color: 'var(--txt3)' }}>Planificadas</p>
                      <p className="text-2xl font-black" style={{ color: 'var(--txt3)' }}>{fmt(plannedHrsMonth)}<span className="text-sm font-bold ml-1">hs</span></p>
                    </div>
                    {plannedHrsMonth > 0 && (
                      <div className="ml-auto text-right">
                        <p className="text-[10px] font-bold" style={{ color: 'var(--txt3)' }}>Cumplimiento</p>
                        <p className="text-xl font-black" style={{ color: cumplimientoRealPct >= 90 ? '#10b981' : '#f59e0b' }}>
                          {cumplimientoRealPct.toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>
                  {plannedHrsMonth > 0 && (
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, cumplimientoRealPct)}%`, backgroundColor: cumplimientoRealPct >= 90 ? '#10b981' : '#f59e0b' }}/>
                    </div>
                  )}
                  {realHoursMonth === 0 && plannedHrsMonth > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--txt3)' }}>Sin horas reales registradas aún</p>
                  )}
                </div>
              </div>

              {/* Servicios en riesgo */}
              <div className="rounded-xl border p-5 flex flex-col"
                style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle size={16} className="text-amber-500"/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Servicios en Riesgo</h3>
                  <span className="text-[10px]" style={{ color: 'var(--txt3)' }}>— % vacantes + ausencias este mes</span>
                </div>
                {serviciosEnRiesgo.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6">
                    <CheckCircle2 size={28} className="text-emerald-400"/>
                    <p className="text-sm font-bold text-emerald-600">Todos los servicios con cobertura normal</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-2">
                    {serviciosEnRiesgo.map((s, i) => (
                      <div key={i} className="flex flex-col gap-1 px-3 py-2.5 rounded-lg"
                        style={{ backgroundColor: 'var(--app-bg)', border: '1px solid var(--border)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-black truncate" style={{ color: 'var(--txt)' }}>{s.name}</p>
                            <p className="text-[10px] truncate" style={{ color: 'var(--txt3)' }}>{s.client}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {s.vacPct > 0 && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{s.vacPct}% vac.</span>
                            )}
                            {s.absPct > 0 && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{s.absPct}% aus.</span>
                            )}
                          </div>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${Math.min(100, s.vacPct + s.absPct)}%`,
                            backgroundColor: s.vacPct + s.absPct > 15 ? '#ef4444' : '#f59e0b'
                          }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ══ BLOQUE 5: GESTIÓN COMERCIAL ═══════════════════════════════ */}
            <SectionLabel label="Gestión Comercial" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

              {/* Concentración de riesgo */}
              <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Layers size={16} style={{ color: 'var(--company-primary,#6366f1)' }}/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Concentración por Cliente</h3>
                </div>
                <p className="text-[10px] mb-4" style={{ color: 'var(--txt3)' }}>
                  Top 3 clientes representan el{' '}
                  <span className="font-black" style={{ color: concentracionPct >= 70 ? '#ef4444' : concentracionPct >= 50 ? '#f59e0b' : '#10b981' }}>
                    {concentracionPct}%
                  </span>
                  {' '}de las horas contratadas
                  {concentracionPct >= 70 && ' — riesgo de concentración alto'}
                </p>
                {topClientes.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--txt3)' }}>Sin datos de servicios</p>
                ) : (
                  <div className="space-y-2.5">
                    {topClientes.map((c, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold truncate max-w-[60%]" style={{ color: 'var(--txt)' }}>{c.name}</span>
                          <span className="text-xs font-black shrink-0" style={{ color: 'var(--txt3)' }}>
                            {fmt(c.hrs)} hs · <span style={{ color: 'var(--txt)' }}>{c.pct}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${c.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Contratos por vencer */}
              <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <CalendarClock size={16} className="text-rose-500"/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Contratos por Vencer</h3>
                  <span className="text-[10px]" style={{ color: 'var(--txt3)' }}>— próximos 60 días</span>
                </div>
                {serviciosPorVencer.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <CheckCircle2 size={28} className="text-emerald-400"/>
                    <p className="text-sm font-bold text-emerald-600">Sin contratos próximos a vencer</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--border)' }}>
                    {serviciosPorVencer.slice(0, 6).map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black truncate" style={{ color: 'var(--txt)' }}>{s.client}</p>
                          <p className="text-[10px] truncate" style={{ color: 'var(--txt3)' }}>{s.objective}</p>
                        </div>
                        <span className={`ml-3 shrink-0 text-[11px] font-black px-2.5 py-1 rounded-full ${
                          s.dias <= 15
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : s.dias <= 30
                              ? 'bg-amber-100 text-amber-700 border border-amber-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {s.dias === 0 ? 'Hoy' : s.dias === 1 ? 'Mañana' : `${s.dias} días`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ══ BLOQUE 6: PERSONAL ESTRATÉGICO ════════════════════════════ */}
            <SectionLabel label="Personal — Indicadores Estratégicos" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <KpiCard
                title="Sin Turno Este Mes"
                value={empleadosSinTurno}
                icon={UserX} color="#ef4444"
                subtext={`de ${totalEmployees} empleados activos`}
                alert={empleadosSinTurno > 0}
                progress={totalEmployees > 0 ? (empleadosSinTurno / totalEmployees) * 100 : undefined}
                noData={totalEmployees === 0}
                onClick={empleadosSinTurno > 0 ? () => setDetailModal('empleados_sin_turno') : undefined}
              />
              <KpiCard
                title="Tasa Ausentismo 30d"
                value={`${tasaAusentismo30}%`}
                icon={TrendingDown} color={tasaAusentismo30 > 10 ? '#ef4444' : tasaAusentismo30 > 5 ? '#f59e0b' : '#10b981'}
                subtext="ausencias / dotación"
                alert={tasaAusentismo30 > 10}
                noData={totalEmployees === 0}
              />
              <KpiCard
                title="Licencias Activas"
                value={licencias.length}
                icon={Calendar} color="#8b5cf6"
                subtext={licencias.length > 0 ? licencias.map(l => l.reason).filter((v,i,a) => a.indexOf(v)===i).join(' · ') : 'Sin licencias hoy'}
                noData={false}
                onClick={licencias.length > 0 ? () => setDetailModal('licencias') : undefined}
              />
            </div>

            {/* ══ DISTRIBUCIÓN PERSONAL POR OBJETIVO ═══════════════════════ */}
            {distChart.length > 0 && (
              <div className="mb-6 rounded-xl border p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Users size={16} style={{ color: 'var(--company-primary,#6366f1)' }}/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Distribución de Personal por Objetivo</h3>
                  <span className="text-[10px]" style={{ color: 'var(--txt3)' }}>— empleados activos asignados</span>
                </div>
                <div style={{ minHeight: 160 }}>
                  <ResponsiveContainer width="100%" height={Math.max(120, distChart.length * 34)}>
                    <BarChart data={distChart} layout="vertical" margin={{ left: 10, right: 40, top: 4, bottom: 4 }}>
                      <XAxis type="number" hide domain={[0, 'dataMax']}/>
                      <YAxis dataKey="name" type="category" width={140}
                        tick={{ fontSize: 10, fontWeight: 600, fill: '#6b7280' }} axisLine={false} tickLine={false}/>
                      <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                        contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--surf)', color: 'var(--txt)', boxShadow: 'none' }}/>
                      <Bar dataKey="value" fill="var(--company-primary,#6366f1)" radius={[0, 6, 6, 0]} barSize={18}
                        label={{ position: 'right', fontSize: 10, fontWeight: 700, fill: 'var(--company-primary,#6366f1)' }}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ══ BLOQUE 7: HORAS SLA ═══════════════════════════════════════ */}
            <SectionLabel label="Horas SLA — Mes Actual" />
            {slaTotalHrs === 0 ? (
              <div className="mb-6 p-5 rounded-xl border text-center" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <p className="text-sm font-bold" style={{ color: 'var(--txt3)' }}>Sin horas SLA proyectadas para el mes</p>
              </div>
            ) : (() => {
              const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
              const hsPorDia = slaTotalHrs / daysInMonth;
              const hsPorEmp = totalEmployees > 0 ? slaTotalHrs / totalEmployees : 0;
              const nightPct  = slaTotalHrs > 0 ? Math.round((slaNightHrs    / slaTotalHrs) * 100) : 0;
              const holPct    = slaTotalHrs > 0 ? Math.round((slaHolidayHrs  / slaTotalHrs) * 100) : 0;
              const wkndPct   = slaTotalHrs > 0 ? Math.round((slaWeekendHrs  / slaTotalHrs) * 100) : 0;
              const dayPct    = Math.max(0, 100 - nightPct - holPct - wkndPct);
              const slaSegments = [
                { label: 'Diurnas',         value: normalHrs,     pct: dayPct,   color: '#f97316' },
                { label: 'Nocturnas',       value: slaNightHrs,   pct: nightPct, color: '#a855f7' },
                { label: 'Plus Feriados',   value: slaHolidayHrs, pct: holPct,   color: '#10b981' },
                { label: 'Fin de semana',   value: slaWeekendHrs, pct: wkndPct,  color: '#0ea5e9' },
              ].filter(s => s.value > 0);
              return (
                <div className="mb-6 space-y-3">
                  {/* Fila 1: KPIs numéricos */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Total */}
                    <div className="rounded-xl border p-4 flex flex-col gap-1"
                      style={{ backgroundColor:'var(--surf)', borderColor:'var(--border)', borderTop:'2px solid var(--company-primary,#6366f1)' }}>
                      <p className="text-[9px] font-black uppercase tracking-wider" style={{ color:'var(--txt3)' }}>TOTAL MES</p>
                      <p className="text-2xl font-black" style={{ color:'var(--txt)' }}>{fmt(slaTotalHrs)}<span className="text-sm font-bold ml-1">hs</span></p>
                      <p className="text-[10px]" style={{ color:'var(--txt3)' }}>{today.toLocaleString('es-AR',{month:'long',year:'numeric'})}</p>
                    </div>
                    {/* Hs/día */}
                    <div className="rounded-xl border p-4 flex flex-col gap-1"
                      style={{ backgroundColor:'var(--surf)', borderColor:'var(--border)', borderTop:'2px solid #f97316' }}>
                      <p className="text-[9px] font-black uppercase tracking-wider" style={{ color:'var(--txt3)' }}>HS / DÍA PROMEDIO</p>
                      <p className="text-2xl font-black" style={{ color:'var(--txt)' }}>{fmt(hsPorDia, 0)}<span className="text-sm font-bold ml-1">hs</span></p>
                      <p className="text-[10px]" style={{ color:'var(--txt3)' }}>{daysInMonth} días en el mes</p>
                    </div>
                    {/* Hs/empleado */}
                    <div className="rounded-xl border p-4 flex flex-col gap-1"
                      style={{ backgroundColor:'var(--surf)', borderColor:'var(--border)', borderTop:'2px solid #10b981' }}>
                      <p className="text-[9px] font-black uppercase tracking-wider" style={{ color:'var(--txt3)' }}>HS / EMPLEADO</p>
                      <p className="text-2xl font-black" style={{ color:'var(--txt)' }}>{fmt(hsPorEmp, 0)}<span className="text-sm font-bold ml-1">hs</span></p>
                      <p className="text-[10px]" style={{ color:'var(--txt3)' }}>{totalEmployees} empleados en nómina</p>
                    </div>
                    {/* Nocturnidad */}
                    <div className="rounded-xl border p-4 flex flex-col gap-1"
                      style={{ backgroundColor:'var(--surf)', borderColor:'var(--border)', borderTop:'2px solid #a855f7' }}>
                      <p className="text-[9px] font-black uppercase tracking-wider" style={{ color:'var(--txt3)' }}>HS CON PLUS SALARIAL</p>
                      <p className="text-2xl font-black" style={{ color:'var(--txt)' }}>{nightPct + holPct}<span className="text-sm font-bold ml-1">%</span></p>
                      <p className="text-[10px]" style={{ color:'var(--txt3)' }}>{fmt(slaNightHrs + slaHolidayHrs)} hs (noct. + fer.)</p>
                    </div>
                  </div>

                  {/* Fila 2: Breakdown por turno con barras */}
                  <div className="rounded-xl border p-5"
                    style={{ backgroundColor:'var(--surf)', borderColor:'var(--border)' }}>
                    <p className="text-[9px] font-black uppercase tracking-wider mb-4" style={{ color:'var(--txt3)' }}>DISTRIBUCIÓN POR TIPO DE TURNO</p>
                    <div className="space-y-3">
                      {slaSegments.map((s, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }}/>
                          <span className="text-xs font-bold w-28 shrink-0" style={{ color:'var(--txt)' }}>{s.label}</span>
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor:'var(--border)' }}>
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width:`${s.pct}%`, backgroundColor: s.color }}/>
                          </div>
                          <span className="text-xs font-black w-16 text-right shrink-0" style={{ color:'var(--txt)' }}>{fmt(s.value)} hs</span>
                          <span className="text-[10px] font-bold w-8 text-right shrink-0" style={{ color:'var(--txt3)' }}>{s.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ══ BLOQUE 8: LICENCIAS ACTIVAS ═══════════════════════════════ */}
            <SectionLabel label="Licencias Activas" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="lg:col-span-2 rounded-xl border p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Calendar size={16} className="text-amber-500"/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Hoy</h3>
                  {licencias.length > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-black">{licencias.length}</span>
                  )}
                </div>
                {licencias.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <CheckCircle2 size={28} style={{ color: 'var(--border)' }}/>
                    <p className="text-sm font-bold" style={{ color: 'var(--txt3)' }}>Sin licencias activas</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--border)' }}>
                    {licencias.map((lic, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-black text-[11px] shrink-0">
                            {lic.empName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{lic.empName}</p>
                            <p className="text-[10px]" style={{ color: 'var(--txt3)' }}>{lic.from} → {lic.to}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap">
                          {lic.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border p-5 flex flex-col" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <PieChartIcon size={16} style={{ color: 'var(--company-primary, #6366f1)' }}/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Por Motivo</h3>
                </div>
                {licenciasByReason.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--txt3)' }}>Sin datos</div>
                ) : (
                  <div className="flex-1 w-full" style={{minHeight: 180}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={licenciasByReason} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                          {licenciasByReason.map((e,i) => <Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius:'12px', border:'1px solid var(--border)', backgroundColor:'var(--surf)', color:'var(--txt)', boxShadow:'none' }}/>
                        <Legend layout="vertical" verticalAlign="bottom" align="center" iconType="circle" iconSize={8}
                          formatter={(v:string) => <span style={{fontSize:10,fontWeight:700,color:'var(--txt3)'}}>{v}</span>}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* ══ BLOQUE 9: SERVICIOS + AUSENCIAS ═══════════════════════════ */}
            <SectionLabel label="Servicios y Ausencias" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Briefcase size={16} className="text-blue-500"/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>
                    Servicios Activos — {today.toLocaleString('es-AR',{month:'long'})}
                  </h3>
                </div>
                {activeServicesList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Info size={24} style={{ color: 'var(--border)' }}/>
                    <p className="text-sm font-bold" style={{ color: 'var(--txt3)' }}>Sin servicios activos este mes</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--border)', maxHeight: 320, overflowY: 'auto' }}>
                      {activeServicesList.map((svc, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black w-5 text-center shrink-0" style={{ color: 'var(--txt3)' }}>{i + 1}</span>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: 'rgba(99,102,241,0.08)' }}>
                              <Shield size={13} style={{ color: 'var(--company-primary, #6366f1)' }}/>
                            </div>
                            <div>
                              <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{svc.client}</p>
                              <p className="text-[10px]" style={{ color: 'var(--txt3)' }}>{svc.objective}</p>
                            </div>
                          </div>
                          <span className="text-xs font-black px-2.5 py-1 rounded-xl shrink-0"
                            style={{ color: 'var(--company-primary, #6366f1)', backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                            {fmt(svc.hrs)} hs
                          </span>
                        </div>
                      ))}
                    </div>
                    {activeServicesList.length > 5 && (
                      <p className="text-[10px] text-center mt-2" style={{ color: 'var(--txt3)' }}>
                        {activeServicesList.length} servicios · scroll para ver todos
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="rounded-xl border p-5 flex flex-col" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <UserX size={16} className="text-rose-500"/>
                  <h3 className="font-black text-sm" style={{ color: 'var(--txt)' }}>Ausencias — Últimos 30 días</h3>
                </div>
                {absenceChart.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--txt3)' }}>Sin ausencias registradas</div>
                ) : (
                  <div className="flex-1 w-full" style={{minHeight: 200}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={absenceChart} layout="vertical" margin={{left:10, right:36, top:4, bottom:4}}>
                        <XAxis type="number" hide domain={[0, 'dataMax']}/>
                        <YAxis dataKey="name" type="category" width={130}
                          tick={{fontSize:10, fontWeight:600, fill:'#6b7280'}} axisLine={false} tickLine={false}/>
                        <Tooltip cursor={{fill:'rgba(0,0,0,0.04)'}}
                          contentStyle={{ borderRadius:'12px', border:'1px solid var(--border)', backgroundColor:'var(--surf)', color:'var(--txt)', boxShadow:'none' }}/>
                        <Bar dataKey="value" fill="#6366f1" radius={[0,6,6,0]} barSize={18}
                          label={{position:'right', fontSize:10, fontWeight:700, fill:'#6366f1'}}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* ══ BLOQUE 10: ACCESOS RÁPIDOS ════════════════════════════════ */}
            <SectionLabel label="Accesos Rápidos" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { href:'/admin/planificacion', icon: Calendar,  color:'#6366f1',  label:'Planificador',  sub:'Gestionar y asignar turnos' },
                { href:'/admin/empleados',     icon: Users,     color:'#10b981',  label:'Personal',      sub:'Legajos y disponibilidad' },
                { href:'/admin/crm',           icon: Building2, color:'#0ea5e9',  label:'Comercial',     sub:'Clientes y objetivos' },
                { href:'/admin/servicios',     icon: Briefcase, color:'#8b5cf6',  label:'Servicios SLA', sub:'Puestos y proyecciones' },
              ].map(({ href, icon: Icon, color, label, sub }) => (
                <a key={href} href={href}
                  className="p-4 sm:p-5 rounded-xl border transition-all text-left flex flex-col gap-3 hover:shadow-md hover:-translate-y-0.5 no-underline"
                  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', borderTop: '2px solid var(--company-primary, #6366f1)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '22' }}>
                    <Icon size={16} color={color} strokeWidth={2.5}/>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="font-black text-sm leading-tight" style={{ color: 'var(--txt)' }}>{label}</p>
                      <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>{sub}</p>
                    </div>
                    <ArrowRight size={14} style={{ color: 'var(--txt3)' }}/>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      {portalReady && detailModal && createPortal(
        <DashboardDetailModal
          kind={detailModal}
          onClose={() => setDetailModal(null)}
          vacantesDetalle={vacantesDetalle}
          novedadesDetalle={novedadesDetalle}
          ausentesDetalle={ausentesDetalle}
          serviciosPorVencer={serviciosPorVencer}
          serviciosEnRiesgo={serviciosEnRiesgo}
          empleadosSinTurnoDetalle={empleadosSinTurnoDetalle}
          topClientes={topClientes}
          licencias={licencias}
          counts={{ vacantes: vacantesHoy, novedades: novedadesHoy, ausentes: ausentesHoy, sinTurno: empleadosSinTurno }}
        />,
        document.body,
      )}
    </DashboardLayout>
  );
}

export default withAuthGuard(AdminDashboard, ['admin', 'SuperAdmin', 'Director', 'Auditor']);
