import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingDashboard } from '@/hooks/useTrainingDashboard';
import { TRAINABLE_MODULES, TrainingSession, resetSession } from '@/lib/training/trainingSession';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
  GraduationCap, RefreshCw, CheckCircle2, Clock, Circle,
  Users, Award, TrendingUp, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Tipos auxiliares ──────────────────────────────────────────────────────────

type ModKey = string;

const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  TRAINABLE_MODULES.map(m => [m.key, m.label]),
);
const MODULE_ICONS: Record<string, string> = Object.fromEntries(
  TRAINABLE_MODULES.map(m => [m.key, m.icon]),
);

// ── Componente chip de módulo ─────────────────────────────────────────────────

function ModuleChip({ modKey, session }: { modKey: ModKey; session: TrainingSession }) {
  const prog = session.progress[modKey];
  const status = prog?.status ?? 'pending';
  const score = prog?.score;

  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
        <CheckCircle2 size={10} />
        {MODULE_ICONS[modKey]} {score != null ? `${score}/100` : '✓'}
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse">
        <Clock size={10} />
        {MODULE_ICONS[modKey]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600">
      <Circle size={10} />
      {MODULE_ICONS[modKey]}
    </span>
  );
}

// ── Fila de alumno ────────────────────────────────────────────────────────────

function StudentRow({ session, onReset }: { session: TrainingSession; onReset: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [resetting, setResetting] = useState(false);

  const totalSteps = session.modulePlan.reduce((acc, k) => {
    const mod = TRAINABLE_MODULES.find(m => m.key === k);
    return acc + (mod?.steps.length ?? 0);
  }, 0);
  const completedSteps = session.modulePlan.reduce((acc, k) => {
    return acc + (session.progress[k]?.stepsCompleted.length ?? 0);
  }, 0);
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const avgScore = (() => {
    const scores = session.modulePlan
      .map(k => session.progress[k]?.score)
      .filter((s): s is number => s != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  })();

  const handleReset = async () => {
    if (!confirm(`¿Reiniciar sesión de ${session.userEmail}? Se perderá el progreso actual.`)) return;
    setResetting(true);
    try {
      await resetSession(session.id, session.modulePlan);
      toast.success(`Sesión de ${session.userEmail} reiniciada`);
      onReset();
    } catch (e) {
      toast.error('Error al reiniciar la sesión');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
        {/* Alumno */}
        <td className="px-4 py-3">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{session.userEmail}</div>
          <div className="text-[11px] text-gray-400">{session.roleId || 'sin rol'}</div>
        </td>

        {/* Módulos */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {session.modulePlan.map(k => (
              <ModuleChip key={k} modKey={k} session={session} />
            ))}
          </div>
        </td>

        {/* Progreso */}
        <td className="px-4 py-3 w-32">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: pct === 100 ? '#22c55e' : '#f59e0b',
                }}
              />
            </div>
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 w-8 text-right">{pct}%</span>
          </div>
        </td>

        {/* Score promedio */}
        <td className="px-4 py-3 text-center">
          {avgScore != null ? (
            <span className={`text-sm font-bold ${avgScore >= 80 ? 'text-green-600' : avgScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
              {avgScore}
            </span>
          ) : (
            <span className="text-gray-300 dark:text-gray-700">—</span>
          )}
        </td>

        {/* Estado */}
        <td className="px-4 py-3 text-center">
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
            session.status === 'completed'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          }`}>
            {session.status === 'completed' ? 'completo' : 'en curso'}
          </span>
        </td>

        {/* Acciones */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
              title="Ver detalle"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
              title="Reiniciar sesión"
            >
              <RefreshCw size={14} className={resetting ? 'animate-spin' : ''} />
            </button>
          </div>
        </td>
      </tr>

      {/* Fila expandida: detalle por módulo */}
      {expanded && (
        <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {session.modulePlan.map(k => {
                const prog = session.progress[k];
                const mod = TRAINABLE_MODULES.find(m => m.key === k)!;
                const stepsCompleted = prog?.stepsCompleted ?? [];
                const status = prog?.status ?? 'pending';
                return (
                  <div key={k} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                      <span>{MODULE_ICONS[k]}</span>
                      <span className="truncate">{MODULE_LABELS[k]}</span>
                    </div>
                    <div className="space-y-0.5">
                      {mod.steps.map(s => (
                        <div key={s.id} className="flex items-center gap-1 text-[10px]">
                          {stepsCompleted.includes(s.id)
                            ? <CheckCircle2 size={10} className="text-green-500 shrink-0" />
                            : <Circle size={10} className="text-gray-300 shrink-0" />}
                          <span className={stepsCompleted.includes(s.id) ? 'line-through text-gray-400' : 'text-gray-600 dark:text-gray-400'}>
                            {s.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    {prog?.score != null && (
                      <div className="mt-1.5 text-[11px] font-bold text-center text-green-600 dark:text-green-400">
                        Score: {prog.score}/100
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function CapacitacionPage() {
  const router = useRouter();
  const { empresa } = useEmpresa();
  const { sessions, loading } = useTrainingDashboard();
  const [roleFilter, setRoleFilter] = useState<string>('');

  // Redirigir si no es empresa de training
  useEffect(() => {
    if (empresa && !empresa.isTrainingEmpresa) {
      router.replace('/admin/dashboard');
    }
  }, [empresa, router]);

  if (!empresa?.isTrainingEmpresa) return null;

  // Roles únicos para el filtro
  const roles = Array.from(new Set(sessions.map(s => s.roleId).filter(Boolean)));

  const filtered = roleFilter
    ? sessions.filter(s => s.roleId === roleFilter)
    : sessions;

  // Stats
  const completados = sessions.filter(s => s.status === 'completed').length;
  const enCurso = sessions.filter(s => s.status === 'active').length;
  const avgGlobal = (() => {
    const all: number[] = [];
    sessions.forEach(s => {
      s.modulePlan.forEach(k => {
        const sc = s.progress[k]?.score;
        if (sc != null) all.push(sc);
      });
    });
    if (!all.length) return null;
    return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
  })();

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <GraduationCap size={22} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Vista Instructor</h1>
            <p className="text-sm text-gray-500">Progreso de alumnos en Modo Capacitación</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Alumnos', value: sessions.length, icon: Users, color: 'text-blue-500' },
            { label: 'En curso', value: enCurso, icon: TrendingUp, color: 'text-amber-500' },
            { label: 'Completaron', value: completados, icon: CheckCircle2, color: 'text-green-500' },
            { label: 'Score prom.', value: avgGlobal != null ? `${avgGlobal}/100` : '—', icon: Award, color: 'text-purple-500' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-3">
              <Icon size={20} className={`shrink-0 ${color}`} />
              <div>
                <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filtro por rol */}
        {roles.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Filtrar por rol:</span>
            <button
              onClick={() => setRoleFilter('')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${!roleFilter ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              Todos
            </button>
            {roles.map(r => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${roleFilter === r ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {/* Tabla de alumnos */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Cargando sesiones…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              {sessions.length === 0
                ? 'Todavía no hay alumnos con sesión iniciada. Ejecutá npm run seed:capacitacion y logueate como alumno.'
                : 'No hay alumnos con ese rol.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/80">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Alumno</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Módulos</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Progreso</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Score</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Estado</th>
                  <th className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-400" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <StudentRow key={s.id} session={s} onReset={() => {}} />
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
