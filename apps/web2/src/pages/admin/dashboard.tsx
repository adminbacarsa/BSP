import React, { useEffect, useState, useMemo } from 'react';
import Head from 'next/head';
import {
  Shield, Users, Clock, AlertTriangle,
  Briefcase, Activity, Calendar,
  AlertOctagon, UserCheck, TrendingUp, Zap, MapPin,
  Building2, BarChart3, PieChart as PieChartIcon, LayoutDashboard, UserX, Target, Filter,
  Sun, Moon, Star, Coffee, RefreshCw, CheckCircle2, XCircle, Info, ChevronRight
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { useEmpresa } from '@/context/EmpresaContext';
import { shouldScopeQueriesToEmpresa, belongsToEmpresaView } from '@/lib/multiempresa';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// ─── FERIADOS NACIONALES ARGENTINA 2025-2026 ─────────────────────────────────
const AR_HOLIDAYS = new Set([
  '2025-01-01','2025-02-03','2025-02-04','2025-03-24','2025-04-02','2025-04-18',
  '2025-05-01','2025-05-25','2025-06-16','2025-06-20','2025-07-09','2025-08-17',
  '2025-10-12','2025-11-20','2025-12-08','2025-12-25',
  '2026-01-01','2026-02-16','2026-02-17','2026-03-24','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-25','2026-06-15','2026-06-20','2026-07-09','2026-08-17',
  '2026-10-12','2026-11-20','2026-12-08','2026-12-25',
]);

const isHoliday = (d: Date) => AR_HOLIDAYS.has(d.toISOString().split('T')[0]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];

const fmt = (n: number, decimals = 0) => n.toLocaleString('es-AR', { maximumFractionDigits: decimals });

const SectionLabel = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap" style={{ color: 'var(--txt3)' }}>{label}</span>
    <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
  </div>
);

// ─── KPI CARD ────────────────────────────────────────────────────────────────
const KpiCard = ({ title, value, icon: Icon, color, subtext, sub2, alert, noData }: any) => (
  <div
    role="group"
    aria-label={title}
    className={`px-4 py-3.5 rounded-xl border transition-all flex items-center gap-3 ${noData ? 'opacity-55' : ''}`}
    style={{
      backgroundColor: 'var(--surf)',
      borderColor: alert ? 'rgba(239,68,68,0.5)' : 'var(--border)',
      borderTop: `2px solid var(--company-primary, #6366f1)`,
    }}>
    <div className="p-2 rounded-lg shrink-0 flex items-center justify-center" style={{ background: color + '22' }}>
      <Icon size={16} color={color} strokeWidth={2.5} aria-hidden="true" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black uppercase tracking-wider leading-tight truncate" style={{ color: 'var(--txt3)' }}>{title}</p>
      <p className="text-xl font-black leading-tight" style={{ color: noData ? 'var(--txt3)' : 'var(--txt)' }}>
        {noData ? '—' : value}
      </p>
      {subtext && <p className="text-[10px] font-medium leading-tight truncate" style={{ color: 'var(--txt3)' }}>{subtext}</p>}
    </div>
  </div>
);

// ─── BADGE ───────────────────────────────────────────────────────────────────
const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold
    ${ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
    {ok ? <CheckCircle2 size={11}/> : <XCircle size={11}/>} {label}
  </span>
);

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
      <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-black text-indigo-600">{payload[0].value}</p>
    </div>
  );
};

// ─── TIPOS ───────────────────────────────────────────────────────────────────
interface LicenciaRow { empName: string; reason: string; from: string; to: string; }

// ─── COMPONENT ───────────────────────────────────────────────────────────────
const CACHE_KEY_PREFIX = 'dashboard_cache_v3';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function cacheKeyForEmpresa(empresaId: string) {
  return `${CACHE_KEY_PREFIX}_${empresaId || 'legacy'}`;
}

function saveCache(empresaId: string, data: Record<string, any>) {
  try { localStorage.setItem(cacheKeyForEmpresa(empresaId), JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function loadCache(empresaId: string): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(cacheKeyForEmpresa(empresaId));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}

function AdminDashboard() {
  const { empresaId, empresa, loadingEmpresa } = useEmpresa();
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const [loading, setLoading]           = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey]     = useState(0);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [fromCache, setFromCache]       = useState(false);

  // Estructura
  const [clientsCount, setClientsCount]         = useState(0);
  const [objectivesCount, setObjectivesCount]   = useState(0);
  const [activeServicesCount, setActiveServicesCount] = useState(0);
  const [slaTotalHrs, setSlaTotalHrs]           = useState(0);
  const [slaNightHrs, setSlaNightHrs]           = useState(0);
  const [slaHolidayHrs, setSlaHolidayHrs]       = useState(0);
  const [activeServicesList, setActiveServicesList] = useState<{client:string; objective:string; hrs:number}[]>([]);

  // Personal
  const [totalEmployees, setTotalEmployees]     = useState(0);
  const [enServicioHoy, setEnServicioHoy]       = useState(0);
  const [presentesHoy, setPresentesHoy]         = useState(0);
  const [enServicioActivo, setEnServicioActivo] = useState(0);
  const [francoHoy, setFrancoHoy]               = useState(0);
  const [vacantesHoy, setVacantesHoy]           = useState(0);

  // Planificación
  const [hasPlanificacion, setHasPlanificacion] = useState(false);
  const [coveragePct, setCoveragePct]           = useState(0);
  const [absentHoy, setAbsentHoy]               = useState(0);
  const [novedadesHoy, setNovedadesHoy]         = useState(0);

  // KPI: horas promedio por vigilador
  const [avgHrsVigilador, setAvgHrsVigilador]           = useState(0);
  const [monthTotalPlannedHrs, setMonthTotalPlannedHrs] = useState(0);
  const [vigiladoresConTurno, setVigiladoresConTurno]   = useState(0);

  // Licencias
  const [licencias, setLicencias]               = useState<LicenciaRow[]>([]);
  const [licenciasByReason, setLicenciasByReason] = useState<{name:string; value:number; color:string}[]>([]);

  // Ausencias históricas
  const [absenceChart, setAbsenceChart]         = useState<{name:string; value:number}[]>([]);

  // Distribución objetivos
  const [distChart, setDistChart]               = useState<{name:string; value:number}[]>([]);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const monthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

  // Carga caché al montar y arranca fetch; re-corre cuando cambia empresaId
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

  // Refresh manual o por refreshKey
  useEffect(() => {
    if (refreshKey === 0 || !empresaId) return;
    setIsRefreshing(true);
    fetchAll(true);
  }, [refreshKey, empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh cada 5 minutos en segundo plano
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
    setActiveServicesList(d.activeServicesList ?? []);
    setTotalEmployees(d.totalEmployees ?? 0);
    setEnServicioHoy(d.enServicioHoy ?? 0);
    setPresentesHoy(d.presentesHoy ?? 0);
    setEnServicioActivo(d.enServicioActivo ?? 0);
    setFrancoHoy(d.francoHoy ?? 0);
    setVacantesHoy(d.vacantesHoy ?? 0);
    setHasPlanificacion(d.hasPlanificacion ?? false);
    setCoveragePct(d.coveragePct ?? 0);
    setAbsentHoy(d.absentHoy ?? 0);
    setNovedadesHoy(d.novedadesHoy ?? 0);
    setAvgHrsVigilador(d.avgHrsVigilador ?? 0);
    setMonthTotalPlannedHrs(d.monthTotalPlannedHrs ?? 0);
    setVigiladoresConTurno(d.vigiladoresConTurno ?? 0);
    setLicencias(d.licencias ?? []);
    setLicenciasByReason(d.licenciasByReason ?? []);
    setAbsenceChart(d.absenceChart ?? []);
    setDistChart(d.distChart ?? []);
    if (d.lastUpdated) setLastUpdated(new Date(d.lastUpdated));
  };

  // ── CÁLCULO SLA HORAS MES ACTUAL ─────────────────────────────────────────
  const calcSlaHours = (positions: any[], startDate: string, endDate: string) => {
    if (!startDate || !endDate || !positions?.length) return { total: 0, night: 0, holiday: 0 };
    const JS_DAY = ['D','L','M','X','J','V','S'];
    let total = 0, night = 0, holiday = 0;

    const s = new Date(startDate + 'T00:00:00');
    const e = new Date(endDate + 'T23:59:59');
    // solo el mes actual
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const mEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0, 23, 59, 59);
    const from = s > mStart ? s : mStart;
    const to   = e < mEnd   ? e : mEnd;

    let cur = new Date(from);
    while (cur <= to) {
      const dayCode = JS_DAY[cur.getDay()];
      const isHol   = isHoliday(cur);
      positions.forEach((pos: any) => {
        const qty = pos.quantity || 1;
        let dayH = 0, nightH = 0;
        const cov = pos.coverageType || '24hs';
        if (cov === '24hs')           { dayH = 24; nightH = 9; }  // 21-06 = 9h nocturnas
        else if (cov === '12hs_diurno')  { dayH = 12; nightH = 0; }
        else if (cov === '12hs_nocturno') { dayH = 12; nightH = 11; } // 19-06 = 11h nocturnas
        else if (cov === 'custom') {
          (pos.allowedShiftTypes || []).forEach((v: any) => {
            const inDay = !v.days?.length || v.days.includes(dayCode);
            if (inDay) { dayH += v.hours || 0; }
          });
        }
        total   += dayH * qty;
        night   += nightH * qty;
        if (isHol) holiday += dayH * qty;
      });
      cur.setDate(cur.getDate() + 1);
    }
    return { total, night, holiday };
  };

  // ── FETCH PRINCIPAL (queries en paralelo) ────────────────────────────────
  const fetchAll = async (background = false) => {
    if (!empresaId) return;
    if (!background) setLoading(true);
    try {
      const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
      const todayStart = new Date(today); todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(today); todayEnd.setHours(23,59,59,999);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0, 23, 59, 59);

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

      // Todas las queries en paralelo
      const [clientsSnap, svcSnap, empSnap, ausSnap, turnosSnap, monthTurnosSnap] = await Promise.all([
        getDocs(clientsQ),
        getDocs(svcQ),
        getDocs(empQ),
        getDocs(ausQ),
        getDocs(query(collection(db, 'turnos'), where('startTime', '>=', Timestamp.fromDate(todayStart)), where('startTime', '<=', Timestamp.fromDate(todayEnd)))),
        getDocs(query(collection(db, 'turnos'), where('startTime', '>=', Timestamp.fromDate(monthStart)), where('startTime', '<=', Timestamp.fromDate(monthEnd)))),
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
      let svcCount = 0, totalSlaH = 0, nightSlaH = 0, holSlaH = 0;
      const svcList: {client:string; objective:string; hrs:number}[] = [];
      svcSnap.forEach(doc => {
        const d = doc.data();
        if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return;
        const sd = d.startDate || '', ed = d.endDate || '';
        if (sd <= monthStr + '-31' && ed >= monthStr + '-01') {
          svcCount++;
          const { total, night, holiday } = calcSlaHours(d.positions || [], sd, ed);
          totalSlaH += total; nightSlaH += night; holSlaH += holiday;
          if (total > 0) svcList.push({ client: d.clientName || 'Cliente', objective: d.objectiveName || 'Objetivo', hrs: Math.round(total) });
        }
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
      let activeGuards = new Set<string>(), francoGuards = new Set<string>();
      let vacantes = 0, absent = 0, novedades = 0, totalTurnos = 0;
      let presentesHoy = new Set<string>(), enServicioActivo = new Set<string>();
      turnosSnap.forEach(doc => {
        const s = doc.data();
        if (!belongsToEmpresaView(s, empresaId, migracionCompleta)) return;
        if (s.status === 'Canceled') return;
        if (s.employeeId && s.employeeId !== 'VACANTE' && !empMap[s.employeeId]) return;
        totalTurnos++;
        if (!s.employeeId || s.employeeId === 'VACANTE') { vacantes++; return; }
        const code = (s.code || s.type || '').toString().toUpperCase();
        if (code === 'F') francoGuards.add(s.employeeId);
        if (!NON_SERVICE_TODAY.has(code)) activeGuards.add(s.employeeId);
        if (s.status === 'ABSENT') absent++;
        if (s.hasNovedad) novedades++;
        // Presentes reales (marcaron check-in)
        if (s.isPresent || s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isCompleted) presentesHoy.add(s.employeeId);
        // En servicio activo (presentes que aún no completaron)
        if ((s.isPresent || s.status === 'PRESENT') && s.status !== 'COMPLETED' && !s.isCompleted) enServicioActivo.add(s.employeeId);
      });

      // 7. HORAS PLANIFICADAS MES
      const SHIFT_HRS: Record<string,number> = { M:8,T:8,N:8,D12:12,N12:12,FT:8 };
      const NON_WORKING = new Set(['F','FF','V','L','A','E','AA','AUS']);
      let mTotalHrs = 0;
      const empHrsMap: Record<string,number> = {};
      monthTurnosSnap.forEach(doc => {
        const s = doc.data();
        if (!belongsToEmpresaView(s, empresaId, migracionCompleta)) return;
        if (s.status === 'Canceled') return;
        if (!s.employeeId || s.employeeId === 'VACANTE' || !empMap[s.employeeId]) return;
        const code = (s.code || s.type || '').toString().toUpperCase();
        if (NON_WORKING.has(code)) return;
        const hrs = Number(s.hours) || SHIFT_HRS[code] || 8;
        mTotalHrs += hrs;
        empHrsMap[s.employeeId] = (empHrsMap[s.employeeId] || 0) + hrs;
      });

      const hasPlan = totalTurnos > 0 && totalEmp > 0;
      const vigCount = Object.keys(empHrsMap).length;
      const now = new Date();

      // Construir objeto de estado completo
      const newState = {
        clientsCount: cCount, objectivesCount: oCount,
        activeServicesCount: svcCount,
        slaTotalHrs: Math.round(totalSlaH), slaNightHrs: Math.round(nightSlaH), slaHolidayHrs: Math.round(holSlaH),
        activeServicesList: svcList.sort((a,b) => b.hrs - a.hrs).slice(0,6),
        totalEmployees: totalEmp,
        enServicioHoy: activeGuards.size, francoHoy: francoGuards.size, vacantesHoy: vacantes,
        presentesHoy: presentesHoy.size, enServicioActivo: enServicioActivo.size,
        hasPlanificacion: hasPlan,
        coveragePct: hasPlan && totalTurnos > 0 ? ((totalTurnos - vacantes - absent) / totalTurnos) * 100 : 0,
        absentHoy: absent, novedadesHoy: novedades,
        avgHrsVigilador: totalEmp > 0 ? Math.round(totalSlaH / totalEmp) : 0,
        monthTotalPlannedHrs: Math.round(totalSlaH), vigiladoresConTurno: totalEmp,
        licencias: licRows.slice(0, 8),
        licenciasByReason: Object.entries(licReasonMap).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] })).sort((a,b) => b.value - a.value),
        absenceChart: Object.entries(absMap30).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0,6),
        distChart: Object.entries(distMap).map(([name, value]) => ({ name: name.length > 16 ? name.slice(0,16)+'…' : name, value })).sort((a,b) => b.value - a.value).slice(0,6),
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

  // ── DERIVADOS ─────────────────────────────────────────────────────────────
  const francoCount = francoHoy;
  const normalHrs   = Math.max(0, slaTotalHrs - slaNightHrs - slaHolidayHrs);

  return (
    <DashboardLayout>
      <Head><title>Panel de Control | CronoApp</title></Head>
      <div className="min-h-screen p-6 pb-20 animate-in fade-in" style={{ backgroundColor: 'var(--app-bg)' }}>

        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3" style={{ color: 'var(--txt)' }}>
              <LayoutDashboard size={30} style={{ color: 'var(--company-primary,#6366f1)' }} aria-hidden="true"/>
              PANEL DE CONTROL
              <span aria-hidden="true" className="ml-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-400 self-center">
                {process.env.NEXT_PUBLIC_BUILD_HASH || 'dev'}
              </span>
            </h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <p className="text-slate-500 font-medium text-sm">
                {today.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
              </p>
              <span role="status" aria-label="Datos en tiempo real" className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
                </span>
                EN VIVO
              </span>
              {lastUpdated && (
                <span className="text-[10px] text-slate-400 font-medium">
                  Act. {lastUpdated.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
                  {fromCache && <span className="ml-1 text-amber-500">· caché</span>}
                </span>
              )}
              {isRefreshing && !loading && (
                <span className="flex items-center gap-1 text-[10px] text-indigo-400 font-medium">
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
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50 border"
            style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', color: 'var(--txt2)' }}
          >
            <RefreshCw size={14} className={isRefreshing || loading ? 'animate-spin' : ''}/> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"/>
              <p className="text-slate-400 text-sm font-medium">Cargando métricas...</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── SECCIÓN 1: ESTRUCTURA OPERATIVA ─────────────────────────── */}
            <SectionLabel label="Estructura Operativa" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
              <KpiCard title="Clientes Activos" value={clientsCount}
                icon={Building2} color="#6366f1"
                subtext={`${objectivesCount} objetivos configurados`}
                noData={clientsCount === 0}/>
              <KpiCard title="Servicios Activos" value={activeServicesCount}
                icon={Briefcase} color="#0ea5e9"
                subtext={`en ${today.toLocaleString('es-AR',{month:'long',year:'numeric'})}`}
                noData={activeServicesCount === 0}/>
              <KpiCard title="Empleados en Nómina" value={totalEmployees}
                icon={Users} color="#10b981"
                subtext={totalEmployees > 0 ? `${enServicioHoy} asignados hoy` : 'Sin personal cargado'}
                noData={totalEmployees === 0}/>
              <KpiCard title="Horas SLA del Mes" value={fmt(slaTotalHrs)}
                icon={Clock} color="#8b5cf6"
                subtext={activeServicesCount > 0 ? `proyectadas por ${activeServicesCount} servicio${activeServicesCount>1?'s':''}` : 'Sin servicios activos'}
                noData={slaTotalHrs === 0}/>
              <KpiCard
                title="Prom. Hs/Vigilador"
                value={avgHrsVigilador > 0 ? `${avgHrsVigilador}h` : '—'}
                icon={TrendingUp} color="#f59e0b"
                subtext={vigiladoresConTurno > 0
                  ? `${monthTotalPlannedHrs}hs SLA ÷ ${vigiladoresConTurno} vigiladores`
                  : 'Sin servicios activos'}
                noData={avgHrsVigilador === 0}/>
            </div>

            {/* ── SECCIÓN 2: ESTADO HOY ─────────────────────────────────── */}
            <SectionLabel label="Estado del Día" />
            {!hasPlanificacion && (
              <div className="mb-4 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700">
                <Info size={18} className="shrink-0"/>
                <p className="text-sm font-bold">Sin planificación cargada para hoy — los indicadores operativos no están disponibles.</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <KpiCard title="Presentes Hoy" value={presentesHoy}
                icon={UserCheck} color="#10b981"
                subtext={hasPlanificacion ? `de ${enServicioHoy} planificados` : 'Sin planificación'}
                noData={!hasPlanificacion}/>
              <KpiCard title="En Servicio" value={enServicioActivo}
                icon={Activity} color="#6366f1"
                subtext="Activos — sin completar turno"
                noData={!hasPlanificacion}/>
              <KpiCard title="De Franco" value={francoCount}
                icon={Sun} color="#06b6d4"
                subtext={hasPlanificacion ? 'estimado' : 'Sin planificación'}
                noData={!hasPlanificacion && totalEmployees === 0}/>
              <KpiCard
                title="Cumplimiento"
                value={hasPlanificacion ? coveragePct.toFixed(1)+'%' : '—'}
                icon={Shield}
                color={!hasPlanificacion ? '#94a3b8' : coveragePct >= 95 ? '#10b981' : '#ef4444'}
                subtext={!hasPlanificacion ? 'Sin planificación' : coveragePct >= 95 ? 'Dentro de parámetros' : 'Por debajo del umbral'}
                alert={hasPlanificacion && coveragePct < 95}
                noData={!hasPlanificacion}/>
            </div>

            {/* ── SECCIÓN 3: DISTRIBUCIÓN DE HORAS SLA ─────────────────── */}
            <SectionLabel label="Distribución de Horas SLA — Mes Actual" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <KpiCard title="Horas Diurnas" value={fmt(normalHrs)}
                icon={Sun} color="#10b981"
                subtext="Jornada normal"
                noData={slaTotalHrs === 0}/>
              <KpiCard title="Horas Nocturnas" value={fmt(slaNightHrs)}
                icon={Moon} color="#6366f1"
                subtext="21:00–06:00"
                noData={slaTotalHrs === 0}/>
              <KpiCard title="Plus Feriados" value={fmt(slaHolidayHrs)}
                icon={Star} color="#f59e0b"
                subtext="Horas en feriados nacionales"
                noData={slaTotalHrs === 0}/>
              <KpiCard title="Puestos Vacantes" value={hasPlanificacion ? vacantesHoy : '—'}
                icon={AlertTriangle}
                color={vacantesHoy > 0 ? '#ef4444' : '#94a3b8'}
                subtext={hasPlanificacion ? 'Sin cubrir hoy' : 'Sin planificación'}
                alert={hasPlanificacion && vacantesHoy > 0}
                noData={!hasPlanificacion}/>
            </div>

            {/* ── SECCIÓN 4: LICENCIAS + DISTRIBUCIÓN ──────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

              {/* Licencias activas hoy */}
              <div className="lg:col-span-2 rounded-xl border p-6" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="font-black text-base mb-4 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                  <Coffee className="text-amber-500" size={18}/> Licencias Activas Hoy
                  {licencias.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-black">{licencias.length}</span>
                  )}
                </h3>
                {licencias.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-300">
                    <CheckCircle2 size={32}/>
                    <p className="text-sm font-bold text-slate-400">Sin licencias activas hoy</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden divide-y border" style={{ borderColor: 'var(--border)' }}>
                    {licencias.map((lic, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 transition-colors hover:opacity-80">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-black text-[11px]">
                            {lic.empName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{lic.empName}</p>
                            <p className="text-[10px] text-slate-400">{lic.from} → {lic.to}</p>
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

              {/* Licencias por motivo */}
              <div className="rounded-xl border p-6 flex flex-col" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="font-black text-base mb-4 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                  <PieChartIcon className="text-indigo-500" size={18}/> Por Motivo
                </h3>
                {licenciasByReason.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-300 text-xs">Sin datos</div>
                ) : (
                  <div className="flex-1 w-full" style={{minHeight: 180}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={licenciasByReason} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                          {licenciasByReason.map((e,i) => <Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px -5px rgb(0 0 0 / 0.1)'}}/>
                        <Legend layout="vertical" verticalAlign="bottom" align="center" iconType="circle" iconSize={8}
                          formatter={(v:string) => <span style={{fontSize:10,fontWeight:700}}>{v}</span>}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* ── SECCIÓN 5: SERVICIOS ACTIVOS + AUSENCIAS ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

              {/* Servicios activos este mes */}
              <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="font-black text-base mb-4 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                  <Briefcase className="text-blue-500" size={18}/> Servicios Activos — {today.toLocaleString('es-AR',{month:'long'})}
                </h3>
                {activeServicesList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-300">
                    <Info size={28}/>
                    <p className="text-sm font-bold text-slate-400">Sin servicios activos este mes</p>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden divide-y border" style={{ borderColor: 'var(--border)' }}>
                    {activeServicesList.map((svc, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 transition-colors hover:opacity-80">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                            <Shield size={13} className="text-blue-500"/>
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{svc.client}</p>
                            <p className="text-[10px] text-slate-400">{svc.objective}</p>
                          </div>
                        </div>
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-xl">
                          {fmt(svc.hrs)} hs
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ausencias últimos 30 días */}
              <div className="rounded-xl border p-6 flex flex-col" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="font-black text-base mb-4 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                  <UserX className="text-rose-500" size={18}/> Ausencias — Últimos 30 días
                </h3>
                {absenceChart.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-300 text-xs">Sin ausencias registradas</div>
                ) : (
                  <div className="flex-1 w-full" style={{minHeight: 180}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={absenceChart} layout="vertical" margin={{left:10, right:30, top:4, bottom:4}}>
                        <XAxis type="number" hide/>
                        <YAxis dataKey="name" type="category" width={130} tick={{fontSize:10, fontWeight:600}} axisLine={false} tickLine={false}/>
                        <Tooltip cursor={{fill:'#f8fafc'}} contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px -5px rgb(0 0 0 / 0.1)'}}/>
                        <Bar dataKey="value" fill="#6366f1" radius={[0,6,6,0]} barSize={18}
                          label={{position:'right', fontSize:10, fontWeight:700, fill:'#6366f1'}}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* ── SECCIÓN 6: ACCESOS RÁPIDOS ───────────────────────────── */}
            <SectionLabel label="Accesos Rápidos" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { href:'/admin/planificacion', icon: Calendar, color:'text-indigo-500', hover:'hover:border-indigo-200', label:'Planificador', sub:'Gestionar y asignar turnos' },
                { href:'/admin/empleados',     icon: Users,    color:'text-emerald-500', hover:'hover:border-emerald-200', label:'Personal',      sub:'Legajos y disponibilidad' },
                { href:'/admin/crm',           icon: Building2, color:'text-blue-500',  hover:'hover:border-blue-200',   label:'Comercial',     sub:'Clientes, objetivos y tarifas' },
                { href:'/admin/servicios',     icon: Briefcase, color:'text-purple-500', hover:'hover:border-purple-200', label:'Servicios SLA', sub:'Puestos y proyecciones' },
              ].map(({ href, icon: Icon, color, hover, label, sub }) => (
                <button key={href} onClick={() => window.location.href = href}
                  className="h-24 p-5 rounded-xl border transition-all text-left group flex flex-col justify-between hover:opacity-90"
                  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                  <Icon size={22} className={`${color} group-hover:scale-110 transition-transform`}/>
                  <div>
                    <p className="font-black text-sm leading-tight" style={{ color: 'var(--txt)' }}>{label}</p>
                    <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

export default withAuthGuard(AdminDashboard, ['admin', 'SuperAdmin', 'Director', 'Auditor']);