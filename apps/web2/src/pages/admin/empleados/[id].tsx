import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { belongsToEmpresaView } from '@/lib/multiempresa';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmpleadoDoc {
  firstName?: string;
  lastName?: string;
  fileNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  laborAgreement?: string;
  category?: string;
  isAvailable?: boolean;
  startDate?: string;
  objectiveAssignments?: unknown[];
  empresaId?: string;
  status?: string;
}

interface AusenciaDoc {
  id: string;
  employeeId?: string;
  employeeName?: string;
  type?: string;
  startDate?: string | Timestamp;
  endDate?: string | Timestamp;
  status?: string;
  hasCertificate?: boolean;
  reason?: string;
  empresaId?: string;
}

interface TurnoDoc {
  id: string;
  employeeId?: string;
  employeeName?: string;
  startTime?: Timestamp;
  endTime?: Timestamp;
  status?: string;
  objectiveName?: string;
  positionName?: string;
  isPresent?: boolean;
  isAbsent?: boolean;
  isCompleted?: boolean;
  empresaId?: string;
}

interface NovedadDoc {
  id: string;
  employeeId?: string;
  type?: string;
  status?: string;
  createdAt?: Timestamp;
  description?: string;
  objectiveName?: string;
  empresaId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(val: string | Timestamp | undefined): string {
  if (!val) return '—';
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      const [y, m, d] = val.split('-');
      return `${d}/${m}/${y}`;
    }
    return val;
  }
  if (val && typeof (val as Timestamp).toDate === 'function') {
    const d = (val as Timestamp).toDate();
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return '—';
}

function avatarColor(letter: string): string {
  const colors = [
    'bg-violet-600',
    'bg-blue-600',
    'bg-emerald-600',
    'bg-amber-600',
    'bg-rose-600',
    'bg-indigo-600',
    'bg-teal-600',
    'bg-pink-600',
  ];
  const idx = (letter.toUpperCase().charCodeAt(0) - 65) % colors.length;
  return colors[Math.max(0, idx)];
}

function isActive(emp: EmpleadoDoc): boolean {
  if (emp.isAvailable === false) return false;
  const s = (emp.status || '').toLowerCase();
  if (s === 'inactive' || s === 'inactivo') return false;
  return true;
}

const ABSENCE_STATUS_STYLES: Record<string, string> = {
  Justificada: 'bg-emerald-100 text-emerald-800',
  justificada: 'bg-emerald-100 text-emerald-800',
  Injustificada: 'bg-rose-100 text-rose-800',
  injustificada: 'bg-rose-100 text-rose-800',
  Pendiente: 'bg-amber-100 text-amber-800',
  pendiente: 'bg-amber-100 text-amber-800',
  Autorizada: 'bg-blue-100 text-blue-800',
  autorizada: 'bg-blue-100 text-blue-800',
};

function absenceStatusStyle(status: string | undefined): string {
  if (!status) return 'bg-slate-100 text-slate-600';
  return ABSENCE_STATUS_STYLES[status] || 'bg-slate-100 text-slate-600';
}

// ─── Static export config ─────────────────────────────────────────────────────

export async function getStaticPaths() {
  return { paths: [], fallback: true };
}

export async function getStaticProps() {
  return { props: {} };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmpleadoPerfilPage() {
  const router = useRouter();
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;

  const [empleado, setEmpleado] = useState<EmpleadoDoc | null>(null);
  const [ausencias, setAusencias] = useState<AusenciaDoc[]>([]);
  const [turnos, setTurnos] = useState<TurnoDoc[]>([]);
  const [novedades, setNovedades] = useState<NovedadDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const id = router.query.id as string | undefined;

  useEffect(() => {
    if (!router.isReady || !id || !empresaId || empresa === null) return;

    let cancelled = false;

    async function loadData() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        // 1. Empleado
        const empSnap = await getDoc(doc(db, 'empleados', id));
        if (!empSnap.exists()) {
          if (!cancelled) setError('Empleado no encontrado.');
          return;
        }
        const empData = empSnap.data() as EmpleadoDoc;
        if (!belongsToEmpresaView(empData, empresaId, migracionCompleta)) {
          if (!cancelled) setError('No tenés acceso a este empleado.');
          return;
        }
        if (!cancelled) setEmpleado(empData);

        // 2. Ausencias (últimas 10, ordenadas por startDate desc)
        const ausSnap = await getDocs(
          query(
            collection(db, 'ausencias'),
            where('employeeId', '==', id),
            orderBy('startDate', 'desc'),
            limit(10),
          ),
        );
        if (!cancelled) {
          setAusencias(
            ausSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<AusenciaDoc, 'id'>) }))
              .filter((a) => belongsToEmpresaView(a, empresaId, migracionCompleta)),
          );
        }

        // 3. Turnos últimos 30 días
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const turnosSnap = await getDocs(
          query(
            collection(db, 'turnos'),
            where('employeeId', '==', id),
            where('startTime', '>=', Timestamp.fromDate(thirtyDaysAgo)),
            orderBy('startTime', 'desc'),
          ),
        );
        if (!cancelled) {
          setTurnos(
            turnosSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<TurnoDoc, 'id'>) }))
              .filter((t) => belongsToEmpresaView(t, empresaId, migracionCompleta)),
          );
        }

        // 4. Novedades últimas 20
        const novSnap = await getDocs(
          query(
            collection(db, 'novedades'),
            where('employeeId', '==', id),
            orderBy('createdAt', 'desc'),
            limit(20),
          ),
        );
        if (!cancelled) {
          setNovedades(
            novSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<NovedadDoc, 'id'>) }))
              .filter((n) => belongsToEmpresaView(n, empresaId, migracionCompleta)),
          );
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar datos.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, id, empresaId, empresa, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const ausenciasCount = ausencias.length;

    const tardanzasCount =
      // Fuente principal: turnos con isLate:true (registrado por operaciones)
      turnos.filter((t: any) => t.isLate === true).length +
      // Complemento: novedades de llegada tarde (legacy / otras fuentes)
      novedades.filter(
        (n: any) => n.type === 'LLEGADA_TARDE' || n.type === 'LLEGADA_TARDE_DETECTADA' || n.type === 'Llegada Tarde',
      ).length +
      ausencias.filter((a: any) => a.type === 'Llegada Tarde').length;

    const presentes = turnos.filter((t) => t.isPresent === true).length;
    const ausentes = turnos.filter((t) => t.isAbsent === true).length;
    const presentismo =
      presentes + ausentes > 0
        ? Math.round((presentes / (presentes + ausentes)) * 100)
        : null;

    const completados = turnos.filter(
      (t) => t.status === 'COMPLETED' || t.isCompleted === true,
    ).length;

    return { ausenciasCount, tardanzasCount, presentismo, completados };
  }, [ausencias, turnos, novedades]);

  // ─── Render: fallback / loading / error ────────────────────────────────────

  if (router.isFallback) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      </DashboardLayout>
    );
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Loader2 className="animate-spin text-slate-400" size={32} />
          <p className="text-sm text-slate-500">Cargando perfil del empleado…</p>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !empleado) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="text-amber-500" size={36} />
          <p className="text-slate-700 font-medium">{error || 'Empleado no encontrado.'}</p>
          <button
            onClick={() => router.back()}
            className="text-sm text-blue-600 underline"
          >
            Volver
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const firstName = empleado.firstName || '';
  const lastName = empleado.lastName || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Sin nombre';
  const initial = (firstName || lastName || 'E')[0].toUpperCase();
  const active = isActive(empleado);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="bg-slate-900 text-white rounded-2xl px-6 py-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-slate-300 hover:text-white text-sm mb-5 transition-colors"
          >
            <ArrowLeft size={16} />
            Volver
          </button>

          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div
              className={`flex-shrink-0 w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-black shadow-lg ${avatarColor(initial)}`}
            >
              {initial}
            </div>

            {/* Info */}
            <div className="min-w-0">
              <h1 className="text-2xl font-black leading-tight truncate">{fullName}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {empleado.fileNumber && (
                  <span className="text-xs bg-slate-700 text-slate-200 rounded-full px-2.5 py-0.5 font-mono">
                    Legajo #{empleado.fileNumber}
                  </span>
                )}
                {empleado.category && (
                  <span className="text-xs bg-slate-700 text-slate-200 rounded-full px-2.5 py-0.5">
                    {empleado.category}
                  </span>
                )}
                <span
                  className={`text-xs rounded-full px-2.5 py-0.5 font-semibold ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Info Personal ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">
            Información Personal
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            <InfoRow icon={<Mail size={15} />} label="Email" value={empleado.email} />
            <InfoRow icon={<Phone size={15} />} label="Teléfono" value={empleado.phone} />
            <InfoRow icon={<MapPin size={15} />} label="Domicilio" value={empleado.address} />
            <InfoRow icon={<Briefcase size={15} />} label="Convenio laboral" value={empleado.laborAgreement} />
            <InfoRow icon={<FileText size={15} />} label="Categoría" value={empleado.category} />
            <InfoRow
              icon={<Calendar size={15} />}
              label="Fecha de ingreso"
              value={empleado.startDate ? formatDate(empleado.startDate) : undefined}
            />
            <InfoRow
              icon={active ? <CheckCircle size={15} /> : <XCircle size={15} />}
              label="Estado"
              value={
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-0.5 ${
                    active
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {active ? 'Activo' : 'Inactivo'}
                </span>
              }
            />
          </div>
        </section>

        {/* ── KPIs ── */}
        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">
            Últimos 30 días
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<XCircle className="text-rose-500" size={20} />}
              label="Ausencias"
              value={kpis.ausenciasCount}
              color="rose"
            />
            <KpiCard
              icon={<Clock className="text-amber-500" size={20} />}
              label="Tardanzas"
              value={kpis.tardanzasCount}
              color="amber"
            />
            <KpiCard
              icon={<CheckCircle className="text-emerald-500" size={20} />}
              label="Presentismo"
              value={kpis.presentismo !== null ? `${kpis.presentismo}%` : '—'}
              color="emerald"
            />
            <KpiCard
              icon={<User className="text-blue-500" size={20} />}
              label="Turnos completados"
              value={kpis.completados}
              color="blue"
            />
          </div>
        </section>

        {/* ── Ausencias ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
              Ausencias recientes
            </h2>
          </div>
          {ausencias.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">
              Sin ausencias registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Fecha inicio</th>
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Fecha fin</th>
                    <th className="px-4 py-2.5 text-left">Tipo</th>
                    <th className="px-4 py-2.5 text-left">Estado</th>
                    <th className="px-4 py-2.5 text-center">Certificado</th>
                  </tr>
                </thead>
                <tbody>
                  {ausencias.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {formatDate(a.startDate)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {formatDate(a.endDate)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{a.type || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 font-semibold ${absenceStatusStyle(
                            a.status,
                          )}`}
                        >
                          {a.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {a.hasCertificate ? (
                          <span className="text-emerald-600 font-bold">✓</span>
                        ) : (
                          <span className="text-slate-300">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Últimos turnos ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
              Últimos turnos (30 días)
            </h2>
          </div>
          {turnos.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">
              Sin turnos en los últimos 30 días
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Fecha</th>
                    <th className="px-4 py-2.5 text-left">Objetivo</th>
                    <th className="px-4 py-2.5 text-left">Posición</th>
                    <th className="px-4 py-2.5 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {turnos.slice(0, 10).map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {t.startTime ? formatDate(t.startTime) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{t.objectiveName || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-700">{t.positionName || '—'}</td>
                      <td className="px-4 py-2.5">
                        <TurnoStatusBadge turno={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | React.ReactNode;
}) {
  if (!value && typeof value !== 'object') return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="text-xs text-slate-400 block">{label}</span>
        {typeof value === 'string' ? (
          <span className="text-sm text-slate-800 font-medium break-words">{value}</span>
        ) : (
          <div className="mt-0.5">{value}</div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: 'rose' | 'amber' | 'emerald' | 'blue';
}) {
  const bg: Record<string, string> = {
    rose: 'bg-rose-50',
    amber: 'bg-amber-50',
    emerald: 'bg-emerald-50',
    blue: 'bg-blue-50',
  };
  return (
    <div className="rounded-2xl shadow-sm border border-slate-100 bg-white px-4 py-4">
      <div className={`inline-flex rounded-xl p-2 ${bg[color]} mb-2`}>{icon}</div>
      <div className="text-2xl font-black text-slate-800 leading-none mb-1">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function TurnoStatusBadge({ turno }: { turno: TurnoDoc }) {
  if (turno.isPresent === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-semibold">
        <CheckCircle size={11} />
        Presente
      </span>
    );
  }
  if (turno.isAbsent === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-rose-100 text-rose-800 font-semibold">
        <XCircle size={11} />
        Ausente
      </span>
    );
  }
  if (turno.isCompleted === true || turno.status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-blue-100 text-blue-800 font-semibold">
        <CheckCircle size={11} />
        Completado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-slate-100 text-slate-600 font-semibold">
      <Clock size={11} />
      {turno.status || 'Pendiente'}
    </span>
  );
}
