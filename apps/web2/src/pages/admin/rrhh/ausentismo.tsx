import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { belongsToEmpresaView, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Users, AlertTriangle, FileX, TrendingDown, Calendar, Loader2, RefreshCw } from 'lucide-react';

// ─── TIPOS ─────────────────────────────────────────────────────────────────────

interface Absence {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string | { seconds: number };
  endDate: string | { seconds: number };
  status: string;
  hasCertificate: boolean;
  empresaId?: string;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  fileNumber?: string;
  isAvailable: boolean;
  empresaId?: string;
}

// ─── UTILIDADES ────────────────────────────────────────────────────────────────

function toCalendarStr(v: string | { seconds: number } | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'object' && 'seconds' in v) {
    const d = new Date(v.seconds * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function parseDateLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getWorkdaysInMonth(year: number, month: number): number {
  const total = new Date(year, month + 1, 0).getDate();
  let workdays = 0;
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) workdays++;
  }
  return workdays;
}

function absenceOverlapsDays(absence: Absence, year: number, month: number): number {
  const start = toCalendarStr(absence.startDate);
  const end = toCalendarStr(absence.endDate);
  if (!start || !end) return 0;

  const periodStart = new Date(year, month, 1);
  const periodEnd = new Date(year, month + 1, 0, 23, 59, 59);

  const absStart = parseDateLocal(start);
  const absEnd = parseDateLocal(end);
  if (!absStart || !absEnd) return 0;

  const overlapStart = absStart < periodStart ? periodStart : absStart;
  const overlapEnd = absEnd > periodEnd ? periodEnd : absEnd;

  if (overlapStart > overlapEnd) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((overlapEnd.getTime() - overlapStart.getTime()) / msPerDay) + 1;
}

function absenceOverlapsPeriod(absence: Absence, year: number, month: number): boolean {
  return absenceOverlapsDays(absence, year, month) > 0;
}

const TYPE_COLORS: Record<string, string> = {
  Enfermedad: '#3b82f6',
  Vacaciones: '#10b981',
  ART: '#f59e0b',
  Injustificada: '#ef4444',
  'No Presentacion': '#f97316',
  'Llegada Tarde': '#a855f7',
  'Licencia Esp.': '#06b6d4',
  'PG Permiso Gremial': '#64748b',
  Justificada: '#22c55e',
  Otras: '#94a3b8',
};

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function getLast6Months(): Array<{ year: number; month: number; label: string }> {
  const now = new Date();
  const result = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return result;
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export default function AusentismoDashboard() {
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;

  const periods = useMemo(() => getLast6Months(), []);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(periods.length - 1);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedPeriod = periods[selectedPeriodIdx];

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

      const empQuery = scopeEmpresa && empresaId
        ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
        : query(collection(db, 'empleados'));
      const empSnap = await getDocs(empQuery);
      const allEmployees: Employee[] = empSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Employee, 'id'>) }))
        .filter(e => belongsToEmpresaView(e, empresaId, migracionCompleta));
      setEmployees(allEmployees);

      const absQuery = scopeEmpresa && empresaId
        ? query(collection(db, 'ausencias'), where('empresaId', '==', empresaId))
        : query(collection(db, 'ausencias'));
      const absSnap = await getDocs(absQuery);
      const allAbsences: Absence[] = absSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Absence, 'id'>) }))
        .filter(a => belongsToEmpresaView(a, empresaId, migracionCompleta));
      setAbsences(allAbsences);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (empresaId) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, migracionCompleta]);

  const activeEmployees = useMemo(
    () => employees.filter(e => e.isAvailable !== false),
    [employees],
  );

  const periodAbsences = useMemo(
    () =>
      absences.filter(
        a =>
          a.status !== 'Rechazada' &&
          absenceOverlapsPeriod(a, selectedPeriod.year, selectedPeriod.month),
      ),
    [absences, selectedPeriod],
  );

  const kpis = useMemo(() => {
    const totalActivos = activeEmployees.length;
    const workdays = getWorkdaysInMonth(selectedPeriod.year, selectedPeriod.month);

    const employeesWithAbsence = new Set(periodAbsences.map(a => a.employeeId));
    const tasaEmpleados =
      totalActivos > 0
        ? ((employeesWithAbsence.size / totalActivos) * 100).toFixed(1)
        : '0.0';

    const totalDiasAusentes = periodAbsences.reduce(
      (sum, a) => sum + absenceOverlapsDays(a, selectedPeriod.year, selectedPeriod.month),
      0,
    );
    const tasaDias =
      totalActivos > 0 && workdays > 0
        ? ((totalDiasAusentes / (totalActivos * workdays)) * 100).toFixed(2)
        : '0.00';

    const sinCertificado = periodAbsences.filter(
      a => a.type === 'Enfermedad' && a.hasCertificate === false,
    ).length;

    const injustificadas = periodAbsences.filter(a => a.status === 'Injustificada').length;

    return { tasaEmpleados, tasaDias, totalAusencias: periodAbsences.length, sinCertificado, injustificadas, totalActivos, workdays };
  }, [periodAbsences, activeEmployees, selectedPeriod]);

  const trendData = useMemo(() => {
    return periods.map(p => {
      const periodAbs = absences.filter(
        a => a.status !== 'Rechazada' && absenceOverlapsPeriod(a, p.year, p.month),
      );
      const enfermedad = periodAbs.filter(a => a.type === 'Enfermedad').length;
      const injustificada = periodAbs.filter(a => a.status === 'Injustificada').length;
      const otras = Math.max(0, periodAbs.length - enfermedad - injustificada);
      return { name: MONTHS_SHORT[p.month], Enfermedad: enfermedad, Injustificada: injustificada, Otras: otras };
    });
  }, [absences, periods]);

  const normalizeAbsenceType = (t: string): string => {
    if (!t) return 'Sin tipo';
    // fix encoding artifacts (e.g. "No PresentaciÃ³n" → "No Presentación")
    const fixed = t.replace(/Ã³/g, 'ó').replace(/Ã©/g, 'é').replace(/Ã¡/g, 'á').replace(/Ã­/g, 'í').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ').trim();
    // unify case variants: "No Presentacion" / "NO_PRESENTACION" → "No Presentación"
    const lower = fixed.toLowerCase().replace(/_/g, ' ');
    if (lower === 'no presentacion' || lower === 'no presentación') return 'No Presentación';
    if (lower === 'llegada tarde' || lower === 'tardanza') return 'Llegada Tarde';
    if (lower === 'injustificada' || lower === 'ausencia injustificada') return 'Injustificada';
    if (lower === 'enfermedad' || lower === 'art') return 'Enfermedad';
    if (lower === 'vacaciones') return 'Vacaciones';
    if (lower === 'licencia') return 'Licencia';
    return fixed;
  };

  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of periodAbsences) {
      const t = normalizeAbsenceType(a.type);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [periodAbsences]);

  const topAbsentes = useMemo(() => {
    const map: Record<string, { name: string; count: number; types: Record<string, number> }> = {};
    for (const a of periodAbsences) {
      const key = a.employeeId;
      if (!map[key]) {
        const emp = employees.find(e => e.id === key);
        const resolved = a.employeeName
          || (emp ? `${emp.lastName || ''} ${emp.firstName || ''}`.trim() : '')
          || '—';
        map[key] = { name: resolved, count: 0, types: {} };
      }
      map[key].count++;
      const t = normalizeAbsenceType(a.type);
      map[key].types[t] = (map[key].types[t] ?? 0) + 1;
    }
    return Object.values(map)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(e => ({
        name: e.name,
        count: e.count,
        topType: Object.entries(e.types).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
      }));
  }, [periodAbsences, employees]);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 md:p-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-800">Dashboard Ausentismo</h1>
            <p className="mt-0.5 text-sm text-slate-500">Seguimiento de ausencias y tasa de ausentismo</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <Calendar size={14} className="text-slate-400" />
              <select
                className="bg-transparent text-sm font-medium text-slate-700 outline-none"
                value={selectedPeriodIdx}
                onChange={e => setSelectedPeriodIdx(Number(e.target.value))}
              >
                {periods.map((p, i) => (
                  <option key={i} value={i}>{p.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-blue-500" />
          </div>
        )}

        {!loading && (
          <>
            {/* KPI Cards */}
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tasa ausentismo</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                    <TrendingDown size={16} className="text-blue-500" />
                  </span>
                </div>
                <div className="text-3xl font-black text-slate-800">{kpis.tasaDias}%</div>
                <div className="mt-1 text-xs text-slate-400">{kpis.tasaEmpleados}% de empleados · {kpis.workdays} días hábiles</div>
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ausencias del mes</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                    <Calendar size={16} className="text-amber-500" />
                  </span>
                </div>
                <div className="text-3xl font-black text-slate-800">{kpis.totalAusencias}</div>
                <div className="mt-1 text-xs text-slate-400">sobre {kpis.totalActivos} empleados activos</div>
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sin certificado</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
                    <FileX size={16} className="text-orange-500" />
                  </span>
                </div>
                <div className="text-3xl font-black text-slate-800">{kpis.sinCertificado}</div>
                <div className="mt-1 text-xs text-slate-400">enfermedades sin documentar</div>
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Injustificadas</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
                    <AlertTriangle size={16} className="text-rose-500" />
                  </span>
                </div>
                <div className="text-3xl font-black text-rose-600">{kpis.injustificadas}</div>
                <div className="mt-1 text-xs text-slate-400">sin justificación registrada</div>
              </div>
            </div>

            {/* Gráficos */}
            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
                <h2 className="mb-4 text-sm font-bold text-slate-700">Tendencia — últimos 6 meses</h2>
                {absences.length === 0 ? (
                  <EmptyChart message="No hay ausencias registradas" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.08)', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
                      <Bar dataKey="Enfermedad" stackId="a" fill={TYPE_COLORS['Enfermedad']} />
                      <Bar dataKey="Injustificada" stackId="a" fill={TYPE_COLORS['Injustificada']} />
                      <Bar dataKey="Otras" stackId="a" fill={TYPE_COLORS['Otras']} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-bold text-slate-700">Distribución por tipo</h2>
                {pieData.length === 0 ? (
                  <EmptyChart message="Sin datos en este período" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
                          {pieData.map((entry, idx) => (
                            <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? `hsl(${(idx * 47) % 360},60%,55%)`} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.08)', fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="mt-2 space-y-1">
                      {pieData.map((entry, idx) => (
                        <li key={entry.name} className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs text-slate-600">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[entry.name] ?? `hsl(${(idx * 47) % 360},60%,55%)` }} />
                            {entry.name}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">{entry.value}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            {/* Top ausentes */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-slate-700">
                Top 5 empleados con más ausencias — {selectedPeriod.label}
              </h2>
              {topAbsentes.length === 0 ? (
                <EmptyChart message="No hay ausencias en este período" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">#</th>
                        <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Empleado</th>
                        <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Ausencias</th>
                        <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Tipo más frecuente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topAbsentes.map((emp, idx) => (
                        <tr key={emp.name + idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="py-2.5 pr-3 text-xs font-bold text-slate-400">{idx + 1}</td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                                {emp.name.charAt(0).toUpperCase()}
                              </span>
                              <span className="font-medium text-slate-700">{emp.name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="inline-flex items-center justify-center rounded-lg bg-rose-50 px-2.5 py-0.5 text-sm font-black text-rose-600">
                              {emp.count}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span
                              className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                              style={{
                                background: (TYPE_COLORS[emp.topType] ?? '#94a3b8') + '22',
                                color: TYPE_COLORS[emp.topType] ?? '#64748b',
                              }}
                            >
                              {emp.topType}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
      <Users size={32} className="mb-2 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
