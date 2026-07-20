import React from 'react';
import { GitBranch, Layers, ListOrdered } from 'lucide-react';
import type { VplanPlanningMethod } from '@/lib/vplan/vplan.types';

export function VplanPlanningMethodPanel({ method }: { method: VplanPlanningMethod }) {
  return (
    <div className="rounded-2xl bg-white border border-violet-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-violet-50 to-slate-50 px-5 py-4 border-b border-violet-100">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-600 p-2 shadow-sm">
            <GitBranch size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
              Cómo planificar (fase 4)
            </h2>
            <p className="text-sm text-violet-900 font-medium mt-1">{method.headline}</p>
            <p className="text-xs text-slate-600 mt-1">{method.summary}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ListOrdered size={14} className="text-violet-700" />
            <h3 className="text-xs font-bold uppercase text-violet-800">Mandatos (orden de prioridad)</h3>
          </div>
          <ol className="space-y-2">
            {method.mandates.map((m) => (
              <li key={m.key} className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs">
                <span className="font-black text-violet-700 mr-2">{m.order}.</span>
                <span className="font-bold text-slate-800">{m.label}</span>
                <span className="text-slate-600"> — {m.rule}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Layers size={14} className="text-violet-700" />
            <h3 className="text-xs font-bold uppercase text-violet-800">Capas de planificación</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-2">
            {method.layers.map((layer) => (
              <div key={layer.key} className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 shadow-sm">
                <p className="text-[10px] font-black uppercase text-violet-600">{layer.label}</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{layer.value}</p>
                <p className="text-[11px] text-slate-600 mt-1">{layer.notes}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Asignación por puesto</h3>
          <div className="space-y-2">
            {method.positionRules.map((rule) => (
              <div key={rule.positionName} className="rounded-xl border border-slate-200 p-3 text-xs">
                <p className="font-bold text-slate-800">
                  {rule.positionName}
                  <span className="ml-2 text-violet-700">{rule.headline}</span>
                </p>
                <p className="text-slate-600 mt-1">{rule.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Pipeline de ejecución</h3>
          <ol className="space-y-1.5">
            {method.pipelineSteps.map((s) => (
              <li key={s.step} className="flex gap-2 text-xs text-slate-700">
                <span className="font-black text-violet-600 shrink-0">{s.step}.</span>
                <span>
                  <strong>{s.title}</strong>
                  {' — '}
                  {s.description}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Escalera ante huecos</h3>
          <ol className="space-y-1 text-[11px] font-mono text-slate-700">
            {method.coverageLadder.map((step) => (
              <li key={step.key} className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
                {step.step}. {step.label}
                <span className="block text-[10px] text-slate-500 font-sans mt-0.5">{step.when}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
