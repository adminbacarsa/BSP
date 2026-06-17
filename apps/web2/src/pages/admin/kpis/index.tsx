import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { belongsToEmpresaView } from '@/lib/multiempresa';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Clock, Shield, AlertTriangle, CheckCircle,
  Activity, Loader2, RefreshCw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiData {
  cobertura: number;
  ausentismo: number;
  tardanzas: number;
  retenciones: number;
  vacantesResueltas: number;
  totalIngresos: number;
  empleadosActivos: number;
  bajasAnticipadas: number;
}

interface DailyEntry {
  date: string;
  ingresos: number;
  ausencias: number;
}

interface WeeklyTardanza {
  semana: string;
  tardanzas: number;
}

interface ObjectiveRow {
  objectiveName: string;
  presentes: number;
  ausentes: number;
  cobertura: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekKey(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diffDays = Math.floor((d.getTime() - startOfWeek1.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return `W${String(week).padStart(2, '0')}`;
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === 'string') return new Date(ts);
  return null;
}

function parseDateField(v: unknown, endOfDay: boolean): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) {
    const d = v.toDate();
    return endOfDay
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, dd] = s.split('-').map(Number);
  return endOfDay
    ? new Date(y, m - 1, dd, 23, 59, 59, 999)
    : new Date(y, m - 1, dd, 0, 0, 0, 0);
}

function absenceOverlapsPeriod(a: Record<string, unknown>, pStart: Date, pEnd: Date): boolean {
  const sd = parseDateField(a.startDate, false);
  const ed = parseDateField(a.endDate, true);
  if (!sd || !ed) return false;
  return sd <= pEnd && ed >= pStart;
}

const DAYS_OPTIONS = [7, 14, 30, 90] as const;
type DaysOption = typeof DAYS_OPTIONS[number];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: 'emerald' | 'rose' | 'blue' | 'amber';
  subtitle?: string;
}

const COLOR_MAP: Record<KpiCardProps['color'], { bg: string; icon: string; text: string }> = {
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-500', text: 'text-emerald-700' },
  rose:    { bg: 'bg-rose-50',    icon: 'text-rose-500',    text: 'text-rose-700'    },
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-500',    text: 'text-blue-700'    },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-500',   text: 'text-amber-700'   },
};

function KpiCard({ label, value, icon, color, subtitle }: KpiCardProps) {
  const c = COLOR_MAP[color];
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
        <span className={`w-9 h-9 rounded-xl ${c.bg} ${c.icon} flex items-center justify-center`}>
          {icon}
        </span>
      </div>
      <span className={`text-3xl font-black ${c.text} leading-none`}>{value}</span>
      {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KpisPage() {
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;

  const [days, setDays] = useState<DaysOption>(30);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Raw data
  const [empleadosRaw, setEmpleadosRaw] = useState<Record<string, unknown>[]>([]);
  const [turnosRaw, setTurnosRaw] = useState<Record<string, unknown>[]>([]);
  const [ausenciasRaw, setAusenciasRaw] = useState<Record<string, unknown>[]>([]);
  const [novedadesRaw, setNovedadesRaw] = useState<Record<string, unknown>[]>([]);
  const [auditLogsRaw, setAuditLogsRaw] = useState<Record<string, unknown>[]>([]);

  // ── Fetch ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!empresaId) return;

    let cancelled = false;
    setLoading(true);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const startTs = Timestamp.fromDate(startDate);

    async function fetchAll() {
      try {
        // Empleados (no date filter — count active)
        const empSnap = await getDocs(collection(db, 'empleados'));
        const emp = empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        // Turnos
        const turnosSnap = await getDocs(
          query(collection(db, 'turnos'), where('startTime', '>=', startTs))
        );
        const turnos = turnosSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        // Ausencias (overlap with period; fetch broadly then filter in memory)
        const ausSnap = await getDocs(collection(db, 'ausencias'));
        const aus = ausSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        // Novedades
        const novSnap = await getDocs(
          query(collection(db, 'novedades'), where('createdAt', '>=', startTs))
        );
        const nov = novSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        // Audit logs
        const auditSnap = await getDocs(
          query(collection(db, 'audit_logs'), where('timestamp', '>=', startTs))
        );
        const audit = auditSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        if (!cancelled) {
          setEmpleadosRaw(emp);
          setTurnosRaw(turnos);
          setAusenciasRaw(aus);
          setNovedadesRaw(nov);
          setAuditLogsRaw(audit);
          setLoading(false);
        }
      } catch (err) {
        console.error('[KPIs] fetch error', err);
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [empresaId, days, refreshKey]);

  // ── Derived KPIs ─────────────────────────────────────────────────────────

  const kpis = useMemo<KpiData>(() => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();

    const filterDoc = (d: Record<string, unknown>) =>
      belongsToEmpresaView(d as { empresaId?: unknown }, empresaId, migracionCompleta);

    // Empleados activos
    const empleados = empleadosRaw.filter(filterDoc);
    const empleadosActivos = empleados.filter(e => e.isAvailable === true).length;

    // Turnos
    const turnos = turnosRaw.filter(filterDoc);
    const turnosPresentes = turnos.filter(t => t.isPresent === true).length;
    const turnosAusentes = turnos.filter(t => t.isAbsent === true).length;
    const total = turnosPresentes + turnosAusentes;
    const cobertura = total > 0 ? Math.round((turnosPresentes / total) * 100) : 0;

    // Ausencias en período
    const ausencias = ausenciasRaw.filter(filterDoc).filter(a =>
      absenceOverlapsPeriod(a, startDate, endDate)
    );
    const ausentismo = empleadosActivos > 0
      ? Math.round((ausencias.length / empleadosActivos) * 100)
      : 0;

    // Novedades
    const novedades = novedadesRaw.filter(filterDoc);
    const vacantesResueltas = novedades.filter(n =>
      n.status === 'ATENDIDA' &&
      String(n.type ?? '').includes('VACANTE')
    ).length;

    // Audit logs
    const audit = auditLogsRaw.filter(filterDoc);
    const tardanzas = audit.filter(a => a.action === 'LLEGADA_TARDE').length;
    const retenciones = audit.filter(a => a.action === 'RETENCION').length;
    const totalIngresos = audit.filter(a => a.action === 'PRESENTE').length;
    const bajasAnticipadas = audit.filter(a =>
      a.action === 'BAJA_CUBIERTA' || a.action === 'BAJA_PROTOCOLO' || a.action === 'INTERRUPT'
    ).length;

    return {
      cobertura,
      ausentismo,
      tardanzas,
      retenciones,
      vacantesResueltas,
      totalIngresos,
      empleadosActivos,
      bajasAnticipadas,
    };
  }, [empleadosRaw, turnosRaw, ausenciasRaw, novedadesRaw, auditLogsRaw, empresaId, migracionCompleta, days]);

  // ── Daily chart data (last min(days, 14) days) ───────────────────────────

  const dailyData = useMemo<DailyEntry[]>(() => {
    const chartDays = Math.min(days, 14);
    const filterDoc = (d: Record<string, unknown>) =>
      belongsToEmpresaView(d as { empresaId?: unknown }, empresaId, migracionCompleta);

    const map: Record<string, DailyEntry> = {};
    for (let i = chartDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      map[k] = { date: k.slice(5), ingresos: 0, ausencias: 0 };
    }

    auditLogsRaw.filter(filterDoc).forEach(a => {
      const d = tsToDate(a.timestamp);
      if (!d) return;
      const k = dateKey(d);
      if (!map[k]) return;
      if (a.action === 'PRESENTE') map[k].ingresos += 1;
    });

    turnosRaw.filter(filterDoc).forEach(t => {
      const d = tsToDate(t.startTime);
      if (!d) return;
      const k = dateKey(d);
      if (!map[k]) return;
      if (t.isAbsent === true) map[k].ausencias += 1;
    });

    return Object.values(map);
  }, [turnosRaw, auditLogsRaw, empresaId, migracionCompleta, days]);

  // ── Weekly tardanzas ─────────────────────────────────────────────────────

  const weeklyTardanzas = useMemo<WeeklyTardanza[]>(() => {
    const filterDoc = (d: Record<string, unknown>) =>
      belongsToEmpresaView(d as { empresaId?: unknown }, empresaId, migracionCompleta);

    const map: Record<string, number> = {};
    auditLogsRaw.filter(filterDoc).filter(a => a.action === 'LLEGADA_TARDE').forEach(a => {
      const d = tsToDate(a.timestamp);
      if (!d) return;
      const k = weekKey(d);
      map[k] = (map[k] ?? 0) + 1;
    });

    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, tardanzas]) => ({ semana, tardanzas }));
  }, [auditLogsRaw, empresaId, migracionCompleta]);

  // ── Table by objective ───────────────────────────────────────────────────

  const objectiveRows = useMemo<ObjectiveRow[]>(() => {
    const filterDoc = (d: Record<string, unknown>) =>
      belongsToEmpresaView(d as { empresaId?: unknown }, empresaId, migracionCompleta);

    const map: Record<string, { presentes: number; ausentes: number }> = {};
    turnosRaw.filter(filterDoc).forEach(t => {
      const name = String(t.objectiveName ?? 'Sin objetivo');
      if (!map[name]) map[name] = { presentes: 0, ausentes: 0 };
      if (t.isPresent === true) map[name].presentes += 1;
      if (t.isAbsent === true) map[name].ausentes += 1;
    });

    return Object.entries(map)
      .map(([objectiveName, { presentes, ausentes }]) => {
        const tot = presentes + ausentes;
        return {
          objectiveName,
          presentes,
          ausentes,
          cobertura: tot > 0 ? Math.round((presentes / tot) * 100) : 0,
        };
      })
      .sort((a, b) => (b.presentes + b.ausentes) - (a.presentes + a.ausentes));
  }, [turnosRaw, empresaId, migracionCompleta]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">KPIs Ejecutivo</h1>
            <p className="text-sm text-slate-500 mt-0.5">Métricas clave del período seleccionado</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Days selector */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              {DAYS_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    days === d
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {/* Refresh */}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium shadow-sm disabled:opacity-50 transition-all"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-8 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
            <span className="text-sm font-medium">Cargando datos…</span>
          </div>
        )}

        {/* KPI Grid 4×2 */}
        {!loading && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Cobertura promedio"
                value={`${kpis.cobertura}%`}
                icon={<Shield size={18} />}
                color="emerald"
                subtitle="Presentes / (Presentes + Ausentes)"
              />
              <KpiCard
                label="Tasa ausentismo"
                value={`${kpis.ausentismo}%`}
                icon={<TrendingDown size={18} />}
                color="rose"
                subtitle="Ausencias / empleados activos"
              />
              <KpiCard
                label="Tardanzas"
                value={String(kpis.tardanzas)}
                icon={<Clock size={18} />}
                color="amber"
                subtitle={`En los últimos ${days} días`}
              />
              <KpiCard
                label="Retenciones"
                value={String(kpis.retenciones)}
                icon={<AlertTriangle size={18} />}
                color="rose"
                subtitle={`En los últimos ${days} días`}
              />
              <KpiCard
                label="Vacantes resueltas"
                value={String(kpis.vacantesResueltas)}
                icon={<CheckCircle size={18} />}
                color="emerald"
                subtitle="Novedades ATENDIDA de tipo VACANTE"
              />
              <KpiCard
                label="Total ingresos"
                value={String(kpis.totalIngresos)}
                icon={<TrendingUp size={18} />}
                color="emerald"
                subtitle={`Eventos PRESENTE en ${days} días`}
              />
              <KpiCard
                label="Empleados activos"
                value={String(kpis.empleadosActivos)}
                icon={<Users size={18} />}
                color="blue"
                subtitle="isAvailable = true"
              />
              <KpiCard
                label="Bajas anticipadas"
                value={String(kpis.bajasAnticipadas)}
                icon={<Activity size={18} />}
                color="rose"
                subtitle="BAJA_CUBIERTA / BAJA_PROTOCOLO / INTERRUPT"
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar chart */}
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wide">
                  Ingresos vs Ausencias por día
                  <span className="ml-2 text-xs font-normal text-slate-400 normal-case">
                    (últimos {Math.min(days, 14)} días)
                  </span>
                </h2>
                {dailyData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                    Sin datos para este período
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dailyData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: '12px',
                          border: 'none',
                          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                        }}
                        labelStyle={{ fontWeight: 700, color: '#334155' }}
                      />
                      <Bar dataKey="ingresos" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ausencias" name="Ausencias" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Line chart */}
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wide">
                  Tardanzas por semana
                </h2>
                {weeklyTardanzas.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                    Sin tardanzas registradas en este período
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weeklyTardanzas} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="semana" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: '12px',
                          border: 'none',
                          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                        }}
                        labelStyle={{ fontWeight: 700, color: '#334155' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="tardanzas"
                        name="Tardanzas"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Table by objective */}
            {objectiveRows.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wide">
                  Resumen por objetivo
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 pr-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">
                          Objetivo
                        </th>
                        <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">
                          Presentes
                        </th>
                        <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">
                          Ausentes
                        </th>
                        <th className="text-right py-2 pl-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">
                          Cobertura %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {objectiveRows.map(row => (
                        <tr
                          key={row.objectiveName}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td className="py-2.5 pr-4 font-medium text-slate-700 truncate max-w-xs">
                            {row.objectiveName}
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold text-emerald-600">
                            {row.presentes}
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold text-rose-500">
                            {row.ausentes}
                          </td>
                          <td className="py-2.5 pl-4 text-right">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${
                                row.cobertura >= 90
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : row.cobertura >= 70
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {row.cobertura}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
