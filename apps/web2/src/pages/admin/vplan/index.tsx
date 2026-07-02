import React, { useMemo, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useVplanLabObjectives } from '@/hooks/useVplanLabObjectives';
import { runVplan } from '@/lib/vplan/vplan.client';
import type {
  VplanIntent,
  VplanRunMode,
  VplanRunResponse,
  VplanScheduleDiffEntry,
} from '@/lib/vplan/vplan.types';
import {
  Brain,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  FileJson,
} from 'lucide-react';
import { toast } from 'sonner';

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

const MODES: { value: VplanRunMode; label: string }[] = [
  { value: 'GREENFIELD', label: 'GREENFIELD — desde cero' },
  { value: 'CONTINUE', label: 'CONTINUE — mes anterior' },
  { value: 'COMPLETE', label: 'COMPLETE — completar borrador' },
  { value: 'RESTORE', label: 'RESTORE — restaurar' },
  { value: 'REPLAN_ABSENCES', label: 'REPLAN_ABSENCES' },
  { value: 'REBALANCE_HOURS', label: 'REBALANCE_HOURS' },
  { value: 'MIGRATE_CYCLE', label: 'MIGRATE_CYCLE' },
];

const INTENTS: { value: VplanIntent; label: string }[] = [
  { value: 'full', label: 'Pipeline completo (0–10)' },
  { value: 'feasibility', label: 'Hasta viabilidad (0–3)' },
  { value: 'generate', label: 'Hasta generación (0–5)' },
  { value: 'verify', label: 'Hasta verificación (0–7)' },
  { value: 'intake', label: 'Solo intake' },
];

function statusBadge(status: VplanRunResponse['status']) {
  if (status === 'ok') return { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-800 border-emerald-200', label: 'OK' };
  if (status === 'verification_failed') return { icon: AlertTriangle, className: 'bg-amber-50 text-amber-900 border-amber-200', label: 'Gaps verificación' };
  if (status === 'feasibility_failed') return { icon: XCircle, className: 'bg-red-50 text-red-800 border-red-200', label: 'No viable' };
  return { icon: XCircle, className: 'bg-red-50 text-red-800 border-red-200', label: 'Error' };
}

function DiffTable({ rows }: { rows: VplanScheduleDiffEntry[] }) {
  const [open, setOpen] = useState(false);
  const preview = rows.slice(0, 12);
  if (!rows.length) return <p className="text-sm text-slate-500">Sin operaciones en el diff.</p>;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="font-bold text-slate-800">Diff ({rows.length} ops)</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Acción</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Empleado</th>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Puesto</th>
            </tr>
          </thead>
          <tbody>
            {(open ? rows : preview).map((r, i) => (
              <tr key={`${r.employeeId}_${r.dateStr}_${i}`} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-indigo-700">{r.action}</td>
                <td className="px-3 py-1.5">{r.dateStr}</td>
                <td className="px-3 py-1.5 font-mono">{r.employeeId.slice(0, 12)}…</td>
                <td className="px-3 py-1.5 font-bold">{r.code}</td>
                <td className="px-3 py-1.5">{r.positionName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!open && rows.length > preview.length && (
        <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">
          Mostrando {preview.length} de {rows.length}. Expandir para ver todo.
        </p>
      )}
    </div>
  );
}

export default function VplanLabPage() {
  const { isSuperAdmin, canReadModule } = useAuth();
  const { empresaId } = useEmpresa();
  const { objectives, loading: loadingObjs } = useVplanLabObjectives(empresaId);

  const now = new Date();
  const [objectiveId, setObjectiveId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [mode, setMode] = useState<VplanRunMode>('GREENFIELD');
  const [intent, setIntent] = useState<VplanIntent>('full');
  const [preferredCycle, setPreferredCycle] = useState<'6+2' | '4+2'>('6+2');
  const [runOptimization, setRunOptimization] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VplanRunResponse | null>(null);
  const [showJson, setShowJson] = useState(false);

  const canAccess = IS_EMULATOR || isSuperAdmin;
  const canPlan = canReadModule('PLANNING');

  const selectedObj = useMemo(
    () => objectives.find((o) => o.objectiveId === objectiveId),
    [objectives, objectiveId],
  );

  const handleRun = async () => {
    if (!empresaId || !objectiveId) {
      toast.error('Seleccioná empresa y objetivo');
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await runVplan({
        empresaId,
        objectiveId,
        year,
        month,
        mode,
        intent,
        preferredCycle,
        budgetMode: 'cct',
        runOptimization,
      });
      setResult(res);
      if (res.status === 'ok') toast.success('VPLAN completado');
      else if (res.status === 'verification_failed') toast.warning('Pipeline con gaps de verificación');
      else if (res.status === 'feasibility_failed') toast.error('Viabilidad fallida');
      else toast.error(res.message);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al invocar vplanRun';
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  if (!canPlan) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto mt-16 p-8 rounded-3xl bg-white shadow-lg border border-slate-200 text-center">
          <XCircle className="mx-auto text-red-500 mb-3" size={40} />
          <h1 className="text-lg font-black text-slate-800">Sin permiso PLANNING</h1>
          <p className="text-sm text-slate-600 mt-2">Necesitás lectura del módulo Planificación para usar el lab VPLAN.</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto mt-16 p-8 rounded-3xl bg-white shadow-lg border border-slate-200 text-center">
          <FlaskConical className="mx-auto text-amber-500 mb-3" size={40} />
          <h1 className="text-lg font-black text-slate-800">VPLAN Lab — solo emulador</h1>
          <p className="text-sm text-slate-600 mt-2">
            Activá <code className="bg-slate-100 px-1 rounded">NEXT_PUBLIC_USE_EMULATOR=true</code> y los emuladores Firebase.
            En producción el callable está bloqueado hasta sign-off.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const badge = result ? statusBadge(result.status) : null;
  const BadgeIcon = badge?.icon;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-6 shadow-lg">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-white/15">
              <Brain size={32} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-200">Laboratorio · paralelo al planificador</p>
              <h1 className="text-2xl font-black tracking-tight">VPLAN</h1>
              <p className="text-sm text-indigo-100 mt-1 max-w-2xl">
                Cerebro experimental de planificación automática. No modifica el wizard Automatizar ni escribe turnos en Firestore.
              </p>
            </div>
          </div>
          {IS_EMULATOR && (
            <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold bg-amber-400 text-amber-950 px-3 py-1 rounded-full">
              <FlaskConical size={14} />
              Modo emulador activo
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="font-black text-slate-800 flex items-center gap-2">
              <Play size={18} className="text-indigo-600" />
              Parámetros de corrida
            </h2>

            <label className="block text-xs font-bold text-slate-600 uppercase">
              Objetivo
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium bg-slate-50"
                value={objectiveId}
                onChange={(e) => setObjectiveId(e.target.value)}
                disabled={loadingObjs}
              >
                <option value="">— Seleccionar —</option>
                {objectives.map((o) => (
                  <option key={o.objectiveId} value={o.objectiveId}>
                    {o.clientName} → {o.objectiveName}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-600 uppercase">
                Año
                <input
                  type="number"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </label>
              <label className="block text-xs font-bold text-slate-600 uppercase">
                Mes
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                />
              </label>
            </div>

            <label className="block text-xs font-bold text-slate-600 uppercase">
              Modo
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as VplanRunMode)}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-bold text-slate-600 uppercase">
              Intent (etapas)
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={intent}
                onChange={(e) => setIntent(e.target.value as VplanIntent)}
              >
                {INTENTS.map((i) => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="block text-xs font-bold text-slate-600 uppercase">
                Ciclo
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={preferredCycle}
                  onChange={(e) => setPreferredCycle(e.target.value as '6+2' | '4+2')}
                >
                  <option value="6+2">6+2</option>
                  <option value="4+2">4+2</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={runOptimization}
                  onChange={(e) => setRunOptimization(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Gemini (fase 9)
              </label>
            </div>

            <button
              type="button"
              onClick={handleRun}
              disabled={running || !objectiveId || !empresaId}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 shadow-md active:scale-[0.98] transition-all"
            >
              {running ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {running ? 'Ejecutando vplanRun…' : 'Ejecutar VPLAN'}
            </button>

            {selectedObj && (
              <p className="text-[11px] text-slate-500">
                {selectedObj.clientName} · ID <span className="font-mono">{selectedObj.objectiveId}</span>
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-4 min-h-[320px]">
            <h2 className="font-black text-slate-800">Resultado</h2>
            {!result && !running && (
              <p className="text-sm text-slate-500">Ejecutá una corrida para ver el diagnóstico del pipeline.</p>
            )}
            {running && (
              <div className="flex items-center gap-3 text-indigo-700">
                <Loader2 className="animate-spin" size={24} />
                <span className="text-sm font-medium">Procesando fases en Cloud Functions…</span>
              </div>
            )}
            {result && badge && BadgeIcon && (
              <>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-bold ${badge.className}`}>
                  <BadgeIcon size={16} />
                  {badge.label} · {result.version}
                </div>
                <p className="text-sm text-slate-700">{result.message}</p>

                <div className="space-y-1 max-h-48 overflow-y-auto rounded-xl bg-slate-50 p-3 border border-slate-100">
                  {result.context.steps.map((s) => (
                    <div key={s.phase} className="flex gap-2 text-xs">
                      <span className={s.ok ? 'text-emerald-600' : 'text-red-600'}>{s.ok ? '✓' : '✗'}</span>
                      <span className="font-mono text-slate-500 shrink-0">{s.phase}</span>
                      <span className="text-slate-700">{s.summary}</span>
                      {s.durationMs != null && (
                        <span className="text-slate-400 ml-auto shrink-0">{s.durationMs}ms</span>
                      )}
                    </div>
                  ))}
                </div>

                {result.context.feasibility && (
                  <div className="text-xs rounded-xl border border-slate-200 p-3 space-y-1">
                    <p className="font-bold text-slate-800">Viabilidad</p>
                    <p>Ciclo sugerido: {result.context.feasibility.suggestedCycle} · plantilla ~{result.context.feasibility.suggestedHeadcount}</p>
                    <p>Oferta ~{result.context.feasibility.offerHours}h vs objetivo {result.context.feasibility.effectiveTargetHours}h</p>
                  </div>
                )}

                {result.context.verification && (
                  <div className="text-xs rounded-xl border border-slate-200 p-3">
                    <p className="font-bold text-slate-800">Verificación</p>
                    <p>
                      {result.context.verification.billableHours}h facturables · gap {result.context.verification.hoursGap}h ·{' '}
                      {result.context.verification.issues.length} issue(s)
                    </p>
                  </div>
                )}

                {result.context.deliverable && (
                  <DiffTable rows={result.context.deliverable.diff} />
                )}

                <button
                  type="button"
                  onClick={() => setShowJson((v) => !v)}
                  className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:underline"
                >
                  <FileJson size={14} />
                  {showJson ? 'Ocultar JSON' : 'Ver JSON completo'}
                </button>
                {showJson && (
                  <pre className="text-[10px] bg-slate-900 text-slate-100 p-3 rounded-xl overflow-auto max-h-64">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
