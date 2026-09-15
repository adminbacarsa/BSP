import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Clock3, RefreshCw, Users, UserPlus, UserMinus } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { isSuperAdminRole } from '@/lib/roles';
import { isAllEmpresasUser } from '@/lib/systemUser';
import {
  ONBOARDING_STATUS_LABEL,
  ONBOARDING_TRACK_LABEL,
  normalizeOnboardingGuideState,
  normalizeOnboardingTrack,
  type OnboardingGuideState,
  type OnboardingTrack,
} from '@/lib/onboardingGuide';

type SystemUserRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  empresaId?: string;
  allEmpresas?: boolean;
  status?: string;
  onboardingGuide?: OnboardingGuideState | null;
};

function formatDateTime(value: unknown): string {
  if (!value) return '—';
  const anyVal = value as any;
  let d: Date | null = null;
  if (anyVal?.seconds) d = new Date(anyVal.seconds * 1000);
  else if (value instanceof Date) d = value;
  else {
    const parsed = new Date(String(value));
    d = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!d) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadgeClass(status: string): string {
  if (status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'IN_PROGRESS') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export default function OnboardingTab() {
  const { isSuperAdmin } = useAuth();
  const { empresaId: myEmpresaId, empresas } = useEmpresa();
  const [rows, setRows] = useState<SystemUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [defaultTrack, setDefaultTrack] = useState<OnboardingTrack>('OPERATIONS');

  const getEmpresaName = (id?: string) =>
    empresas.find((e) => e.id === id)?.name || id || 'Sin asignar';

  const loadRows = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'system_users'), orderBy('lastName')));
      const raw = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as SystemUserRow[];
      const activeRows = raw.filter((u) => String(u.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE');
      const visible = isSuperAdmin
        ? activeRows
        : activeRows.filter(
            (u) =>
              isSuperAdminRole(u.role) ||
              isAllEmpresasUser(u) ||
              (u.empresaId || 'bacarsa') === myEmpresaId,
          );
      setRows(
        visible.map((u) => ({
          ...u,
          onboardingGuide: normalizeOnboardingGuideState((u as any).onboardingGuide),
        })),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [isSuperAdmin, myEmpresaId]);

  const stats = useMemo(() => {
    let required = 0;
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let notRequired = 0;
    rows.forEach((u) => {
      if (u.onboardingGuide?.required !== true) {
        notRequired += 1;
        return;
      }
      required += 1;
      if (u.onboardingGuide.status === 'COMPLETED') completed += 1;
      else if (u.onboardingGuide.status === 'IN_PROGRESS') inProgress += 1;
      else notStarted += 1;
    });
    return { required, completed, inProgress, notStarted, notRequired, total: rows.length };
  }, [rows]);

  const assignGuide = async (uid: string, required: boolean, track?: OnboardingTrack) => {
    setBusyUid(uid);
    try {
      const fn = httpsCallable(functions, 'assignOnboardingGuide');
      await fn({
        uid,
        required,
        track: track || defaultTrack,
        resetProgress: required,
      });
      toast.success(required ? 'Guía obligatoria asignada' : 'Onboarding liberado');
      await loadRows();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo actualizar el onboarding');
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
            <BookOpen size={24} />
          </div>
          <div>
            <h3 className="font-black text-lg text-slate-800 dark:text-white uppercase">Onboarding obligatorio</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
              Seguimiento de guía y asignación a usuarios existentes
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
            Recorrido al exigir
            <select
              value={defaultTrack}
              onChange={(e) => setDefaultTrack(normalizeOnboardingTrack(e.target.value))}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
            >
              <option value="OPERATIONS">{ONBOARDING_TRACK_LABEL.OPERATIONS}</option>
              <option value="PLANNING">{ONBOARDING_TRACK_LABEL.PLANNING}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={loadRows}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <p className="text-[11px] uppercase font-black text-slate-500">Usuarios</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 p-4 shadow-sm">
          <p className="text-[11px] uppercase font-black text-indigo-700 dark:text-indigo-300">Requeridos</p>
          <p className="text-2xl font-black text-indigo-700 dark:text-indigo-300">{stats.required}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4 shadow-sm">
          <p className="text-[11px] uppercase font-black text-emerald-700 dark:text-emerald-300">Completados</p>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{stats.completed}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-4 shadow-sm">
          <p className="text-[11px] uppercase font-black text-amber-700 dark:text-amber-300">En curso</p>
          <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{stats.inProgress}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <p className="text-[11px] uppercase font-black text-slate-500">Sin exigir</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white">{stats.notRequired}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1040px]">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Usuario</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Rol</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Empresa</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Recorrido</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Estado</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Progreso</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Completado</th>
              <th className="p-4 text-[11px] uppercase font-black text-slate-600">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((u) => {
              const guide = u.onboardingGuide;
              const status = guide?.status || 'NOT_STARTED';
              const track = guide?.track || defaultTrack;
              const progressPct = guide?.required ? guide.progressPct : 0;
              const isBusy = busyUid === u.id;
              return (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="p-4">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </td>
                  <td className="p-4 text-xs font-bold text-slate-700 dark:text-slate-200">{u.role || '—'}</td>
                  <td className="p-4 text-xs font-bold text-slate-700 dark:text-slate-200">
                    {isAllEmpresasUser(u) ? 'Todas las empresas' : getEmpresaName(u.empresaId)}
                  </td>
                  <td className="p-4">
                    {guide?.required ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <Users size={12} />
                        {ONBOARDING_TRACK_LABEL[track]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">No requerido</span>
                    )}
                  </td>
                  <td className="p-4">
                    {guide?.required ? (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold ${statusBadgeClass(status)}`}
                      >
                        {status === 'COMPLETED' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                        {ONBOARDING_STATUS_LABEL[status]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    {guide?.required ? (
                      <div className="w-44">
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full bg-indigo-600 transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">{progressPct}%</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">—</span>
                    )}
                  </td>
                  <td className="p-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {guide?.required ? formatDateTime(guide.completedAt) : '—'}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      {!guide?.required || guide.status === 'COMPLETED' ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => assignGuide(u.id, true, defaultTrack)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 disabled:opacity-60"
                        >
                          <UserPlus size={12} />
                          Exigir guía
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => assignGuide(u.id, false, track)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-[11px] font-black hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                        >
                          <UserMinus size={12} />
                          Liberar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-slate-500 font-medium">
                  No hay usuarios para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
