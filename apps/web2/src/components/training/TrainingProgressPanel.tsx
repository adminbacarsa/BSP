import React, { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Clock } from 'lucide-react';
import { TrainingSession, TRAINABLE_MODULES } from '@/lib/training/trainingSession';

interface Props {
  session: TrainingSession;
}

export function TrainingProgressPanel({ session }: Props) {
  const [expanded, setExpanded] = useState(true);

  const totalModules    = session.modulePlan.length;
  const completedCount  = session.modulePlan.filter(k => session.progress[k]?.status === 'completed').length;
  const pct             = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;

  const planModules = session.modulePlan
    .map(key => TRAINABLE_MODULES.find(m => m.key === key))
    .filter(Boolean) as typeof TRAINABLE_MODULES;

  return (
    <div className="border-b text-sm" style={{ borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)' }}>
      {/* Header colapsable */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors"
      >
        <span className="font-semibold text-amber-700 dark:text-amber-300 text-xs uppercase tracking-wide">
          Recorrido de capacitación
        </span>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-amber-200/60 dark:bg-amber-900/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 dark:bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
            {completedCount}/{totalModules} módulos
          </span>
        </div>
        {expanded
          ? <ChevronUp size={14} className="text-amber-500 shrink-0" />
          : <ChevronDown size={14} className="text-amber-500 shrink-0" />
        }
      </button>

      {/* Lista de módulos */}
      {expanded && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {planModules.map(mod => {
            const modProgress = session.progress[mod.key];
            const status = modProgress?.status ?? 'pending';
            const isCurrent = session.currentModuleKey === mod.key;
            const stepsTotal = mod.steps.length;
            const stepsDone  = modProgress?.stepsCompleted?.length ?? 0;

            return (
              <div
                key={mod.key}
                className={
                  'flex items-start gap-2 px-3 py-2 rounded-lg border text-xs min-w-[180px] flex-1 ' +
                  (status === 'completed'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : isCurrent
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                    : 'bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700')
                }
              >
                <StatusIcon status={status} isCurrent={isCurrent} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1">
                    <span>{mod.icon}</span>
                    <span>{mod.label}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded-full">
                        Actual
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {mod.steps.map(step => {
                      const done = modProgress?.stepsCompleted?.includes(step.id) ?? false;
                      return (
                        <div key={step.id} className="flex items-center gap-1 text-[11px]">
                          {done
                            ? <CheckCircle2 size={10} className="text-green-500 shrink-0" />
                            : <Circle size={10} className="text-slate-300 dark:text-slate-600 shrink-0" />
                          }
                          <span className={done ? 'text-green-700 dark:text-green-400 line-through' : 'text-slate-500 dark:text-slate-400'}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {status !== 'pending' && stepsTotal > 0 && (
                    <div className="mt-1.5 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={'h-full rounded-full transition-all ' + (status === 'completed' ? 'bg-green-400' : 'bg-amber-400')}
                        style={{ width: `${Math.round((stepsDone / stepsTotal) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />;
  if (isCurrent || status === 'in_progress') return <Clock size={14} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />;
  return <Circle size={14} className="text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />;
}
