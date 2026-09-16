import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  GraduationCap, ChevronRight, X, ExternalLink,
  CheckCircle2, Lightbulb, ArrowRight,
} from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { getActiveCoachStep, COACH_STEPS } from '@/lib/training/coachContent';
import { TRAINABLE_MODULES } from '@/lib/training/trainingSession';
import { completeStep } from '@/lib/training/trainingSession';

/** Convierte **texto** en negrita en JSX */
function renderInstruction(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-slate-800 dark:text-slate-100">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

export function TrainingCoachBubble() {
  const { empresa } = useEmpresa();
  const { session } = useTrainingSession();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [completing, setCompleting] = useState(false);

  if (!empresa?.isTrainingEmpresa || !session || session.status === 'completed') return null;

  const coachStep = getActiveCoachStep(session.currentModuleKey, session.progress);

  // Si no hay paso activo, el recorrido terminó
  if (!coachStep) {
    return (
      <div className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-[900] w-72">
        <div className="rounded-2xl shadow-xl border border-green-200 dark:border-green-800 bg-white dark:bg-slate-900 p-4 text-sm">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-bold mb-1">
            <CheckCircle2 size={16} />
            ¡Recorrido completado!
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs">
            Completaste todos los módulos del circuito de capacitación.
          </p>
        </div>
      </div>
    );
  }

  const mod = TRAINABLE_MODULES.find(m => m.key === coachStep.moduleKey);
  const isOnTargetRoute = router.pathname.startsWith(coachStep.targetRoute);
  const allStepsForModule = COACH_STEPS
    .filter(s => s.moduleKey === coachStep.moduleKey)
    .map(s => s.stepId);

  const handleComplete = useCallback(async () => {
    if (!session || completing) return;
    setCompleting(true);
    try {
      await completeStep({
        sessionId: session.id,
        moduleKey: coachStep.moduleKey,
        stepId: coachStep.stepId,
        allStepsForModule,
      });
    } finally {
      setCompleting(false);
    }
  }, [session, coachStep, allStepsForModule, completing]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-[900] w-12 h-12 rounded-full shadow-lg flex items-center justify-center bg-amber-400 hover:bg-amber-500 text-white transition-colors"
        title="Coach de capacitación"
      >
        <GraduationCap size={20} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-[900] w-80 max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl shadow-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-400 text-white">
          <GraduationCap size={16} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-black uppercase tracking-wide opacity-80">Coach</div>
            <div className="text-sm font-bold truncate">{mod?.icon} {mod?.label}</div>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-lg hover:bg-amber-500 transition-colors opacity-80 hover:opacity-100"
            aria-label="Minimizar coach"
          >
            <X size={14} />
          </button>
        </div>

        {/* Paso actual */}
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">
            <ChevronRight size={12} />
            {coachStep.title}
          </div>
          <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {renderInstruction(coachStep.instruction)}
          </p>
        </div>

        {/* Hint */}
        {coachStep.hint && (
          <div className="mx-4 mb-2 mt-1 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <Lightbulb size={12} className="shrink-0 mt-0.5" />
            {coachStep.hint}
          </div>
        )}

        {/* Navegación si no está en la pantalla correcta */}
        {!isOnTargetRoute && (
          <div className="mx-4 mb-2">
            <Link
              href={coachStep.targetRoute}
              className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ArrowRight size={12} />
              Ir a {coachStep.targetRouteLabel}
              <ExternalLink size={10} />
            </Link>
          </div>
        )}

        {/* Botón marcar listo */}
        <div className="px-4 pb-4 pt-2">
          <button
            onClick={handleComplete}
            disabled={completing}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white text-xs font-bold py-2 px-4 rounded-xl transition-colors"
          >
            <CheckCircle2 size={13} />
            {completing ? 'Guardando…' : 'Marcar paso como listo'}
          </button>
          <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            También se detecta automáticamente al completar la acción
          </p>
        </div>
      </div>
    </div>
  );
}
