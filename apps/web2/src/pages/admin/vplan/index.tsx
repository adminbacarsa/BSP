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
} from '@/lib/vplan/vplan.types';
import {
  buildEmployeeNameMap,
  DiffTable,
  VplanCoveragePanels,
} from '@/components/vplan/VplanCoveragePanels';
import { VplanPlanningTargetPanel } from '@/components/vplan/VplanPlanningTargetPanel';
import { VplanSlotCoveragePanel } from '@/components/vplan/VplanSlotCoveragePanel';
import { VplanCycleSemanticsPanel } from '@/components/vplan/VplanCycleSemanticsPanel';
import { VplanPlanningMethodPanel } from '@/components/vplan/VplanPlanningMethodPanel';
import {
  VPLAN_STAGE_BY_INTENT,
  VPLAN_STAGES,
  VPLAN_VALIDATION_PLAYBOOK,
} from '@/lib/vplan/vplan-stages';
import {
  downloadVplanEvalReport,
  downloadVplanFullJson,
  downloadVplanScheduleCsv,
} from '@/lib/vplan/vplan-export';
import {
  Brain,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FlaskConical,
  FileJson,
  ListChecks,
  ChevronRight,
  Download,
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

function statusBadge(status: VplanRunResponse['status']) {
  if (status === 'ok') return { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-800 border-emerald-200', label: 'OK' };
  if (status === 'verification_failed') return { icon: AlertTriangle, className: 'bg-amber-50 text-amber-900 border-amber-200', label: 'Gaps verificación' };
  if (status === 'feasibility_failed') return { icon: XCircle, className: 'bg-red-50 text-red-800 border-red-200', label: 'No viable' };
  return { icon: XCircle, className: 'bg-red-50 text-red-800 border-red-200', label: 'Error' };
}

export default function VplanLabPage() {
  const { isSuperAdmin, canReadModule } = useAuth();
  const { empresaId } = useEmpresa();
  const { objectives, loading: loadingObjs } = useVplanLabObjectives(empresaId);

  const now = new Date();
  const [objectiveId, setObjectiveId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [mode, setMode] = useState<VplanRunMode>('CONTINUE');
  const [intent, setIntent] = useState<VplanIntent>('demand');
  const [preferredCycle, setPreferredCycle] = useState<'6+2' | '4+2'>('6+2');
  const [runOptimization, setRunOptimization] = useState(false);
  const [supplyScope, setSupplyScope] = useState<'objective' | 'empresa'>('objective');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VplanRunResponse | null>(null);
  const [showJson, setShowJson] = useState(false);

  const canAccess = IS_EMULATOR || isSuperAdmin;
  const canPlan = canReadModule('PLANNING');

  const selectedObj = useMemo(
    () => objectives.find((o) => o.objectiveId === objectiveId),
    [objectives, objectiveId],
  );

  const selectedStage = VPLAN_STAGE_BY_INTENT[intent];

  const employeeNameMap = useMemo(
    () => buildEmployeeNameMap(result?.context.supply),
    [result?.context.supply],
  );

  const applyPlaybookStep = (stepIntent: VplanIntent, stepMode: VplanRunMode) => {
    setIntent(stepIntent);
    setMode(stepMode);
    toast.info(`Etapa ${VPLAN_STAGE_BY_INTENT[stepIntent]?.shortLabel ?? stepIntent} · modo ${stepMode}`);
  };

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
        supplyScope,
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
      <div className="max-w-[1400px] mx-auto space-y-6">
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

        <div className="rounded-2xl border border-amber-300 bg-amber-50 shadow-sm p-5 space-y-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-amber-950 space-y-2">
              <p className="font-black">Estado actual — madurez por fases</p>
              <ul className="space-y-1 text-xs list-none">
                <li>
                  <strong className="text-emerald-800">✓ Fase 1 (demanda):</strong> lee SLA, calcula qué planificar
                  (418 turnos/slot, reglas por puesto). <strong>Confiable.</strong>
                </li>
                <li>
                  <strong className="text-amber-900">⚠ Fases 4–7 (cómo + cronograma):</strong> la lógica está documentada
                  pero la ejecución <strong>no respeta rachas, 6+2 ni apertura de mes</strong> de forma consistente.
                  Los números 418/418 pueden cerrar con swaps que rompen el cronograma visible.
                </li>
              </ul>
              <p className="text-[11px] text-amber-800">
                Recomendado: intent <strong>1 · Demanda</strong> para validar servicios. No usar el cronograma generado
                hasta corregir motor + continuidad.
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
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
              Intent (etapa hasta)
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
                value={intent}
                onChange={(e) => {
                  const next = e.target.value as VplanIntent;
                  setIntent(next);
                  const stage = VPLAN_STAGE_BY_INTENT[next];
                  if (stage && next !== 'full') {
                    setMode(stage.recommendedMode);
                  }
                }}
              >
                {VPLAN_STAGES.map((s) => (
                  <option key={s.intent} value={s.intent}>
                    {s.shortLabel} — {s.title}
                  </option>
                ))}
              </select>
            </label>

            {selectedStage && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
                  <ListChecks size={12} />
                  Verificar antes de avanzar
                </p>
                {selectedStage.prerequisite && (
                  <p className="text-[11px] text-indigo-800/80">
                    Requiere etapa anterior:{' '}
                    <strong>{VPLAN_STAGE_BY_INTENT[selectedStage.prerequisite]?.shortLabel}</strong>
                  </p>
                )}
                <ul className="text-[11px] text-slate-700 space-y-1 list-disc pl-4">
                  {selectedStage.checks.slice(0, 4).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="text-[10px] text-slate-500 font-mono truncate" title={selectedStage.output}>
                  → {selectedStage.output}
                </p>
              </div>
            )}

            <label className="block text-xs font-bold text-slate-600 uppercase">
              Dotación (oferta)
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={supplyScope}
                onChange={(e) => setSupplyScope(e.target.value as 'objective' | 'empresa')}
              >
                <option value="objective">Solo objetivo (preferido + flotantes + planif.)</option>
                <option value="empresa">Toda la plantilla activa de la empresa</option>
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

                {result.context.intake?.prevMonthPreview && (
                  <div className="text-xs rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                    <p className="font-bold text-indigo-900">
                      Mes anterior ({result.context.intake.prevMonthPreview.prevMonth}/{result.context.intake.prevMonthPreview.prevYear})
                    </p>
                    <p className="text-indigo-800">
                      {result.context.intake.prevMonthPreview.assignmentCount} turnos leídos ·{' '}
                      {result.context.intake.prevMonthPreview.employeesWithTrailing} guardia(s) con racha · zona AR/Córdoba
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-indigo-100 bg-white">
                      <table className="w-full text-[10px] border-collapse min-w-[640px]">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600">
                            <th className="text-left p-1.5 sticky left-0 bg-slate-50">Guardia</th>
                            <th className="p-1">Último</th>
                            <th className="p-1">Racha</th>
                            {result.context.intake.prevMonthPreview.tailDateStrs.map((d) => (
                              <th key={d} className="p-1 font-mono">{d.slice(8)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.context.intake.prevMonthPreview.rows.map((row) => (
                            <tr key={row.employeeId} className="border-t border-slate-100">
                              <td className="p-1.5 font-medium text-slate-800 sticky left-0 bg-white max-w-[140px] truncate" title={row.displayName}>
                                {row.displayName.split(',')[0]}
                              </td>
                              <td className="p-1 text-center font-mono">
                                {row.lastDate ? `${row.lastDate.slice(8)}=${row.lastCode ?? '—'}` : '—'}
                              </td>
                              <td className="p-1 text-center text-slate-600">
                                {row.trailingWork != null ? `W×${row.trailingWork}` : row.trailingRest != null ? `F×${row.trailingRest}` : '—'}
                              </td>
                              {row.tailDays.map((cell) => (
                                <td key={cell.dateStr} className={`p-1 text-center font-bold ${cell.code ? 'text-indigo-900' : 'text-slate-300'}`}>
                                  {cell.code || '·'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {result.context.feasibility && (
                  <div className="text-xs rounded-xl border border-slate-200 p-3 space-y-1">
                    <p className="font-bold text-slate-800">Viabilidad</p>
                    <p>Ciclo sugerido: {result.context.feasibility.suggestedCycle} · plantilla ~{result.context.feasibility.suggestedHeadcount}</p>
                    <p>Oferta ~{result.context.feasibility.offerHours}h vs objetivo {result.context.feasibility.effectiveTargetHours}h</p>
                    {result.status === 'feasibility_failed' && (
                      <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                        El SLA pide ~{result.context.feasibility.suggestedHeadcount} guardias y la oferta cargada no alcanza.
                        Probá <strong>Dotación → Toda la plantilla</strong> para simular con toda la empresa, o asigná más legajos al objetivo en RRHH/Planificador.
                      </p>
                    )}
                  </div>
                )}

                {result.context.verification && (
                  <div className="text-xs rounded-xl border border-slate-200 p-3 space-y-1">
                    <p className="font-bold text-slate-800">Verificación</p>
                    <p>
                      {result.context.verification.billableHours}h facturables · gap {result.context.verification.hoursGap}h
                      {result.context.verification.coverage && (
                        <> · cobertura {result.context.verification.coverage.coverageRatio}%</>
                      )}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      downloadVplanEvalReport(result, employeeNameMap);
                      toast.success('Informe de evaluación descargado');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-sm hover:bg-indigo-700 active:scale-95"
                  >
                    <Download size={14} />
                    Informe evaluación (.json)
                  </button>
                  {result.context.verification?.coverage?.schedulePreview?.rows.length ? (
                    <button
                      type="button"
                      onClick={() => {
                        downloadVplanScheduleCsv(result, employeeNameMap);
                        toast.success('Cronograma CSV descargado');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95"
                    >
                      <Download size={14} />
                      Cronograma (.csv)
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      downloadVplanFullJson(result);
                      toast.success('JSON completo descargado');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95"
                  >
                    <FileJson size={14} />
                    JSON completo
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJson((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                  >
                    {showJson ? 'Ocultar vista' : 'Vista previa'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Para revisión con el asistente: descargá <strong>Informe evaluación</strong> y pegá el archivo en el chat.
                </p>
                {showJson && (
                  <pre className="text-[10px] bg-slate-900 text-slate-100 p-3 rounded-xl overflow-auto max-h-64">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>

        {result?.context.demand?.planningTarget && (
          <VplanPlanningTargetPanel target={result.context.demand.planningTarget} />
        )}

        {result?.context.strategy?.cycleSemantics && (
          <VplanCycleSemanticsPanel semantics={result.context.strategy.cycleSemantics} />
        )}

        {result?.context.strategy?.planningMethod && intent !== 'demand' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-2 text-xs text-amber-900">
            El panel &quot;Cómo planificar&quot; describe el diseño objetivo. La grilla generada puede no cumplirlo
            (rachas junio → julio, bloques 6+2, transiciones M/T/N).
          </div>
        )}

        {result?.context.strategy?.planningMethod && intent !== 'demand' && (
          <VplanPlanningMethodPanel method={result.context.strategy.planningMethod} />
        )}

        {result?.context.demand?.coverageManifest && result.context.draft?.stats?.slotCoverage && intent !== 'demand' && (
          <VplanSlotCoveragePanel
            manifest={result.context.demand.coverageManifest}
            slotCoverage={result.context.draft.stats.slotCoverage}
          />
        )}

        {result?.context.verification?.coverage && intent !== 'demand' && (
          <VplanCoveragePanels verification={result.context.verification} />
        )}

        {result?.context.deliverable && (
          <DiffTable rows={result.context.deliverable.diff} nameMap={employeeNameMap} />
        )}

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-4">
          <h2 className="font-black text-slate-800 flex items-center gap-2">
            <ListChecks size={18} className="text-indigo-600" />
            Playbook de validación (etapa por etapa)
          </h2>
          <p className="text-sm text-slate-600 max-w-3xl">
            Ejecutá cada paso en orden. Si una etapa falla, <strong>no avances</strong> — corregí esa fase antes de seguir.
            El pipeline completo (full) solo tiene sentido cuando las etapas 3–7 pasan individualmente.
          </p>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {VPLAN_VALIDATION_PLAYBOOK.map((pb) => {
              const stage = VPLAN_STAGE_BY_INTENT[pb.intent];
              const lastStep = result?.context.steps.find((s) => s.phase === stage?.phase);
              const done = lastStep?.ok === true;
              return (
                <button
                  key={pb.step}
                  type="button"
                  onClick={() => applyPlaybookStep(pb.intent, pb.mode)}
                  className="text-left rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition-all active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      Paso {pb.step}
                    </span>
                    {done && (
                      <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-0.5">
                        <CheckCircle2 size={11} /> OK
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-800">{stage?.shortLabel}</p>
                  <p className="text-[11px] text-slate-500">{pb.mode} · {pb.note}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 mt-2">
                    Cargar parámetros <ChevronRight size={12} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2 font-black">Fase</th>
                  <th className="px-3 py-2 font-black">Qué produce</th>
                  <th className="px-3 py-2 font-black">Criterio de paso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {VPLAN_STAGES.filter((s) => s.intent !== 'full').map((s) => (
                  <tr key={s.intent} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-bold text-slate-800 whitespace-nowrap">{s.shortLabel}</td>
                    <td className="px-3 py-2 text-slate-600">{s.output}</td>
                    <td className="px-3 py-2 text-slate-700">{s.checks[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
