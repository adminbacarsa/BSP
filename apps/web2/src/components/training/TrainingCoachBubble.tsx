import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  GraduationCap, ChevronRight, ChevronLeft, X, ExternalLink,
  CheckCircle2, Lightbulb, ArrowRight,
} from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { getActiveCoachStep, COACH_STEPS } from '@/lib/training/coachContent';
import { TRAINABLE_MODULES } from '@/lib/training/trainingSession';
import { completeStep, uncompleteStep } from '@/lib/training/trainingSession';
import { TrainingSpotlight } from './TrainingSpotlight';

const STORAGE_KEY = 'training-coach-pos';
const BUBBLE_W = 320;

function loadPos(): { x: number; y: number } | null {
  try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function savePos(p: { x: number; y: number }) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
}
function defaultPos() {
  return { x: window.innerWidth - BUBBLE_W - 24, y: window.innerHeight - 420 };
}

/** Convierte **texto** en negrita y \n en saltos de línea */
function renderInstruction(text: string): React.ReactNode {
  return text.split('\n').map((line, li) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i} className="font-semibold text-slate-800 dark:text-slate-100">{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );
    return <React.Fragment key={li}>{rendered}{li < text.split('\n').length - 1 && <br />}</React.Fragment>;
  });
}

export function TrainingCoachBubble() {
  const { empresa } = useEmpresa();
  const { session } = useTrainingSession();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [completing, setCompleting] = useState(false);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragData = useRef<{ startMX: number; startMY: number; origX: number; origY: number } | null>(null);

  // Inicializar posición en el cliente
  useEffect(() => {
    setPos(loadPos() ?? defaultPos());
  }, []);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const cur = pos ?? defaultPos();
    dragData.current = { startMX: e.clientX, startMY: e.clientY, origX: cur.x, origY: cur.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragData.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - BUBBLE_W, dragData.current.origX + ev.clientX - dragData.current.startMX));
      const ny = Math.max(0, Math.min(window.innerHeight - 80, dragData.current.origY + ev.clientY - dragData.current.startMY));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragData.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setPos(prev => { if (prev) savePos(prev); return prev; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pos]);

  // Calcular coachStep antes de cualquier return condicional (reglas de hooks)
  const coachStep = session
    ? getActiveCoachStep(session.currentModuleKey, session.progress)
    : null;

  const allStepsForModule = coachStep
    ? COACH_STEPS.filter(s => s.moduleKey === coachStep.moduleKey).map(s => s.stepId)
    : [];

  // Calcula el paso anterior para permitir retroceder (incluye targetRoute para navegar)
  const prevStepInfo = session ? (() => {
    const { currentModuleKey, modulePlan, progress } = session;
    if (!currentModuleKey || !coachStep) return null;
    const modSteps = COACH_STEPS.filter(s => s.moduleKey === currentModuleKey);
    const completedInMod = progress[currentModuleKey]?.stepsCompleted ?? [];
    const activeIdx = modSteps.findIndex(s => !completedInMod.includes(s.stepId));
    if (activeIdx > 0) {
      const prevStep = modSteps[activeIdx - 1];
      return { targetModuleKey: currentModuleKey, targetStepId: prevStep.stepId, newCurrentModuleKey: currentModuleKey, targetRoute: prevStep.targetRoute };
    }
    const modIdx = modulePlan.indexOf(currentModuleKey);
    if (modIdx > 0) {
      const prevModKey = modulePlan[modIdx - 1];
      const prevModSteps = COACH_STEPS.filter(s => s.moduleKey === prevModKey);
      if (prevModSteps.length > 0) {
        const prevStep = prevModSteps[prevModSteps.length - 1];
        return { targetModuleKey: prevModKey, targetStepId: prevStep.stepId, newCurrentModuleKey: prevModKey, targetRoute: prevStep.targetRoute };
      }
    }
    return null;
  })() : null;

  const [reverting, setReverting] = useState(false);
  const handleBack = useCallback(async () => {
    if (!session || !prevStepInfo || reverting) return;
    setReverting(true);
    try {
      const { targetRoute, ...uncompleteParams } = prevStepInfo;
      await uncompleteStep({ sessionId: session.id, ...uncompleteParams });
      if (targetRoute && !router.pathname.startsWith(targetRoute)) {
        router.push(targetRoute);
      }
    } finally {
      setReverting(false);
    }
  }, [session, prevStepInfo, reverting, router]);

  const handleComplete = useCallback(async () => {
    if (!session || !coachStep || completing) return;
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

  if (!empresa?.isTrainingEmpresa || !session || session.status === 'completed') return null;

  // Si no hay paso activo, el recorrido terminó
  if (!coachStep) {
    const doneStyle: React.CSSProperties = pos
      ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', zIndex: 900, width: 288 }
      : { position: 'fixed', bottom: '6rem', right: '1rem', zIndex: 900, width: 288 };
    return (
      <div style={doneStyle}>
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

  const bubbleStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', zIndex: 900, width: BUBBLE_W, maxWidth: 'calc(100vw - 2rem)' }
    : { position: 'fixed', bottom: '6rem', right: '1rem', zIndex: 900, width: BUBBLE_W, maxWidth: 'calc(100vw - 2rem)' };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Abrir coach de capacitación"
        style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 900 }}
        className="flex flex-col items-center gap-1.5 bg-amber-400 hover:bg-amber-500 text-white shadow-lg rounded-l-xl px-2 py-4 transition-colors"
      >
        <GraduationCap size={16} />
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Coach
        </span>
      </button>
    );
  }

  return (
    <>
    {isOnTargetRoute && coachStep.highlightSelector && (
      <TrainingSpotlight selector={coachStep.highlightSelector} />
    )}
    <div style={bubbleStyle}>
      <div className="rounded-2xl shadow-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 overflow-hidden">

        {/* Header — arrastrable */}
        <div
          className="flex items-center gap-2 px-4 py-3 bg-amber-400 text-white cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onHeaderMouseDown}
        >
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

        {/* Botones acción */}
        <div className="px-4 pb-4 pt-2 flex flex-col gap-2">
          <button
            onClick={handleComplete}
            disabled={completing}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white text-xs font-bold py-2 px-4 rounded-xl transition-colors"
          >
            <CheckCircle2 size={13} />
            {completing ? 'Guardando…' : 'Marcar paso como listo'}
          </button>
          {prevStepInfo && (
            <button
              onClick={handleBack}
              disabled={reverting}
              className="w-full flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs py-1.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors disabled:opacity-50"
            >
              <ChevronLeft size={13} />
              {reverting ? 'Volviendo…' : 'Volver al paso anterior'}
            </button>
          )}
          <p className="text-center text-[10px] text-slate-400 dark:text-slate-500">
            También se detecta automáticamente al completar la acción
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
