import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  GraduationCap, ChevronRight, ChevronLeft, X, ExternalLink,
  CheckCircle2, Lightbulb, ArrowRight, Maximize2, Minimize2, Trophy,
} from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { getActiveCoachStep, COACH_STEPS } from '@/lib/training/coachContent';
import { TRAINABLE_MODULES } from '@/lib/training/trainingSession';
import { completeStep, uncompleteStep } from '@/lib/training/trainingSession';
import { TrainingSpotlight } from './TrainingSpotlight';

const STORAGE_KEY = 'training-coach-pos';
const BUBBLE_W = 320;

type CoachMode = 'expanded' | 'compact' | 'side';

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
  const [mode, setMode] = useState<CoachMode>('expanded');
  const [completing, setCompleting] = useState(false);
  const [chainIdx, setChainIdx] = useState(0);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragData = useRef<{ startMX: number; startMY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    setPos(loadPos() ?? defaultPos());
  }, []);

  // Auto-expandir cuando cambia el módulo O el paso activo
  const prevStepKey = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.currentModuleKey) return;
    const mod = TRAINABLE_MODULES.find(m => m.key === session.currentModuleKey);
    if (!mod) return;
    const completed = session.progress[session.currentModuleKey]?.stepsCompleted ?? [];
    const activeStep = mod.steps.find(s => !completed.includes(s.id));
    const key = `${session.currentModuleKey}::${activeStep?.id ?? 'done'}`;
    if (key !== prevStepKey.current) {
      prevStepKey.current = key;
      setMode('expanded');
      setChainIdx(0);
    }
  }, [session?.currentModuleKey, session?.progress]);

  // Auto-minimizar al clic del botón principal y luego avanzar la cadena de highlights
  useEffect(() => {
    if (!session) return;
    const step = getActiveCoachStep(session.currentModuleKey, session.progress);
    if (!step?.highlightSelector || step.isPractice) return;

    const chain = step.highlightChain ?? [];

    const t = setTimeout(() => {
      if (chainIdx === 0) {
        // Escuchar el botón principal → compactar + avanzar cadena
        const el = document.querySelector(step.highlightSelector!);
        if (!el) return;
        const handler = () => { setMode('compact'); if (chain.length > 0) setChainIdx(1); };
        el.addEventListener('click', handler, { once: true });
      } else {
        // Escuchar el elemento actual de la cadena → avanzar al siguiente
        const chainEl = chain[chainIdx - 1];
        if (!chainEl) return;
        const el = document.querySelector(chainEl.selector);
        if (!el) return;
        const handler = () => {
          const nextIdx = chainIdx + 1;
          if (nextIdx <= chain.length) setChainIdx(nextIdx);
        };
        el.addEventListener('click', handler, { once: true });
      }
    }, 150);
    return () => clearTimeout(t);
  }, [session, router.pathname, chainIdx]);

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

  const coachStep = session
    ? getActiveCoachStep(session.currentModuleKey, session.progress)
    : null;

  const allStepsForModule = coachStep
    ? COACH_STEPS.filter(s => s.moduleKey === coachStep.moduleKey).map(s => s.stepId)
    : [];

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

  // Recorrido terminado
  if (!coachStep) {
    return (
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 900, width: 288 }}>
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
  const modCoachSteps = COACH_STEPS.filter(s => s.moduleKey === coachStep.moduleKey);
  const completedSteps = session.progress[coachStep.moduleKey]?.stepsCompleted ?? [];
  const completedCount = completedSteps.length;
  const isPractice = !!coachStep.isPractice;

  // Spotlight: usa la cadena si está activa, sino el selector principal
  const chain = coachStep.highlightChain ?? [];
  const activeSelector = !isPractice && isOnTargetRoute
    ? (chainIdx > 0 && chain[chainIdx - 1] ? chain[chainIdx - 1].selector : coachStep.highlightSelector)
    : undefined;
  const spotlight = activeSelector ? <TrainingSpotlight selector={activeSelector} /> : null;

  // ── MODO TAB LATERAL ──────────────────────────────────────────────────────
  if (mode === 'side') {
    return (
      <>
        {spotlight}
        <button
          onClick={() => setMode('compact')}
          title={`Coach: ${coachStep.title}`}
          style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 900 }}
          className={`flex flex-col items-center gap-1 text-white shadow-lg rounded-l-xl px-2 py-4 transition-colors ${isPractice ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-amber-400 hover:bg-amber-500'}`}
        >
          {isPractice ? <Trophy size={16} /> : <GraduationCap size={16} />}
          <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {isPractice ? 'Práctica' : 'Coach'}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.85 }}>{completedCount}/{modCoachSteps.length}</span>
          <div className="flex flex-col gap-0.5 mt-0.5">
            {modCoachSteps.map(s => {
              const done = completedSteps.includes(s.stepId);
              const active = s.stepId === coachStep.stepId;
              return (
                <span key={s.stepId} style={{ width: 6, height: 6, borderRadius: '50%', display: 'block' }}
                  className={done ? 'bg-green-200' : active ? 'bg-white' : isPractice ? 'bg-indigo-200/60' : 'bg-amber-200/60'} />
              );
            })}
          </div>
        </button>
      </>
    );
  }

  // ── MODO COMPACTO (barra inferior) ────────────────────────────────────────
  if (mode === 'compact') {
    return (
      <>
        {spotlight}
        <div
          style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 900, width: BUBBLE_W, maxWidth: 'calc(100vw - 2rem)' }}
          className="rounded-2xl shadow-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 overflow-hidden"
        >
          {/* Barra compacta */}
          <div className={`flex items-center gap-2 px-3 py-2 text-white ${isPractice ? 'bg-indigo-500' : 'bg-amber-400'}`}>
            {isPractice ? <Trophy size={14} className="shrink-0" /> : <GraduationCap size={14} className="shrink-0" />}

            {/* Dots de progreso */}
            <div className="flex items-center gap-0.5">
              {modCoachSteps.map(s => {
                const done = completedSteps.includes(s.stepId);
                const active = s.stepId === coachStep.stepId;
                return (
                  <span key={s.stepId}
                    className={['w-2 h-2 rounded-full flex-shrink-0', done ? 'bg-green-200' : active ? 'bg-white' : 'bg-amber-200/60'].join(' ')}
                  />
                );
              })}
            </div>

            {/* Título del paso actual truncado */}
            <span className="flex-1 text-[11px] font-bold truncate">{coachStep.title}</span>

            {/* Expandir */}
            <button onClick={() => setMode('expanded')} className={`p-1 rounded transition-colors ${isPractice ? 'hover:bg-indigo-600' : 'hover:bg-amber-500'}`} title="Ver instrucciones completas">
              <Maximize2 size={13} />
            </button>
            {/* Ocultar al lateral */}
            <button onClick={() => setMode('side')} className={`p-1 rounded transition-colors ${isPractice ? 'hover:bg-indigo-600' : 'hover:bg-amber-500'}`} title="Ocultar coach">
              <X size={13} />
            </button>
          </div>

          {/* Siguiente acción: hint de cadena o primera línea de instrucción */}
          <div className="px-3 py-2 flex items-center gap-2">
            <ChevronRight size={12} className="text-amber-500 shrink-0" />
            <p className="text-[12px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-snug flex-1">
              {chainIdx > 0 && chain[chainIdx - 1]
                ? chain[chainIdx - 1].hint
                : coachStep.instruction.split('\n')[0]}
            </p>
            {!isOnTargetRoute && (
              <Link href={coachStep.targetRoute} className="shrink-0 text-[11px] font-semibold text-blue-500 hover:underline flex items-center gap-1">
                Ir <ArrowRight size={10} />
              </Link>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── MODO EXPANDIDO (completo) ─────────────────────────────────────────────
  const bubbleStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', zIndex: 900, width: BUBBLE_W, maxWidth: 'calc(100vw - 2rem)' }
    : { position: 'fixed', bottom: '6rem', right: '1rem', zIndex: 900, width: BUBBLE_W, maxWidth: 'calc(100vw - 2rem)' };

  return (
    <>
    {spotlight}
    <div style={bubbleStyle}>
      <div className="rounded-2xl shadow-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 overflow-hidden">

        {/* Header — arrastrable */}
        <div
          className={`flex items-center gap-2 px-4 py-3 text-white cursor-grab active:cursor-grabbing select-none ${isPractice ? 'bg-indigo-500' : 'bg-amber-400'}`}
          onMouseDown={onHeaderMouseDown}
        >
          {isPractice ? <Trophy size={16} className="shrink-0" /> : <GraduationCap size={16} className="shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-black uppercase tracking-wide opacity-80">{isPractice ? '🎯 Práctica libre' : 'Coach'}</div>
            <div className="text-sm font-bold truncate">{mod?.icon} {mod?.label}</div>
          </div>
          {/* Compactar */}
          <button
            onClick={() => setMode('compact')}
            className={`p-1 rounded-lg transition-colors opacity-80 hover:opacity-100 ${isPractice ? 'hover:bg-indigo-600' : 'hover:bg-amber-500'}`}
            aria-label="Modo compacto"
            title="Minimizar (seguir trabajando)"
          >
            <Minimize2 size={14} />
          </button>
          {/* Ocultar al lateral */}
          <button
            onClick={() => setMode('side')}
            className={`p-1 rounded-lg transition-colors opacity-80 hover:opacity-100 ${isPractice ? 'hover:bg-indigo-600' : 'hover:bg-amber-500'}`}
            aria-label="Ocultar al costado"
            title="Ocultar al costado"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progreso del módulo — tildes */}
        <div className="px-4 pt-3 pb-1 flex items-center gap-1 flex-wrap">
          {modCoachSteps.map((s, i) => {
            const isDone = completedSteps.includes(s.stepId);
            const isActive = s.stepId === coachStep.stepId;
            return (
              <React.Fragment key={s.stepId}>
                {i > 0 && <span className="text-slate-300 dark:text-slate-600 text-[9px]">—</span>}
                <span
                  title={s.title}
                  className={[
                    'flex items-center gap-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 transition-colors',
                    isDone ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
                    : isActive && isPractice ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                    : isActive ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                    : 'text-slate-400 dark:text-slate-500',
                  ].join(' ')}
                >
                  {isDone ? '✓' : isActive ? '●' : '○'}
                </span>
              </React.Fragment>
            );
          })}
          <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
            {completedCount}/{modCoachSteps.length}
          </span>
        </div>

        {/* Paso actual */}
        <div className={`px-4 pt-1 pb-1 ${isPractice ? 'bg-indigo-50/50 dark:bg-indigo-900/10 mx-4 mb-1 rounded-xl border border-indigo-100 dark:border-indigo-800' : ''}`}>
          <div className={`flex items-center gap-1 text-xs font-bold mb-1 ${isPractice ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {isPractice ? <Trophy size={12} /> : <ChevronRight size={12} />}
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
            className={`w-full flex items-center justify-center gap-2 disabled:opacity-60 text-white text-xs font-bold py-2 px-4 rounded-xl transition-colors ${isPractice ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-green-500 hover:bg-green-600'}`}
          >
            {isPractice ? <Trophy size={13} /> : <CheckCircle2 size={13} />}
            {completing ? 'Guardando…' : isPractice ? 'Completé el ejercicio' : 'Marcar paso como listo'}
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
            {isPractice
              ? 'Hacé el ejercicio libremente y avisá cuando terminés'
              : 'También se detecta automáticamente al completar la acción'}
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
