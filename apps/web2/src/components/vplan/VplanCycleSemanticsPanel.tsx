import React from 'react';
import { Clock, Scale, Repeat } from 'lucide-react';
import type { VplanCycleSemantics } from '@/lib/vplan/vplan.types';

export function VplanCycleSemanticsPanel({ semantics }: { semantics: VplanCycleSemantics }) {
  const def = semantics.cycleDefinition;

  return (
    <div className="rounded-2xl bg-white border-2 border-rose-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-rose-50 to-slate-50 px-5 py-4 border-b border-rose-100">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-rose-600 p-2 shadow-sm">
            <Scale size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
              Leyes del ciclo (cerebro)
            </h2>
            <p className="text-sm text-rose-900 font-medium mt-1">{semantics.headline}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <p className="text-xs font-black uppercase text-rose-800 mb-2">Inviolables</p>
          <ul className="space-y-2">
            {semantics.inviolableRules.map((r) => (
              <li key={r.id} className="text-xs text-rose-950">
                <strong>{r.label}</strong> — {r.rule}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-slate-600" />
            <p className="text-xs font-black uppercase text-slate-600">Tipos de turno</p>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {semantics.shiftTypes.map((st) => (
              <div
                key={st.group}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <p className="font-bold text-slate-800">{st.label}</p>
                <p className="font-mono text-indigo-800 mt-1">{st.codes.join(' · ')}</p>
                <p className="text-slate-600 mt-1">{st.dailyCoverageNote}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-emerald-800 mt-2 font-medium">
            {semantics.dailyCoverageEquivalence.summary}
          </p>
          <p className="text-[11px] font-mono text-slate-600 mt-1">
            {semantics.dailyCoverageEquivalence.formula8h} · {semantics.dailyCoverageEquivalence.formula12h}
          </p>
        </div>

        <div>
          <p className="text-xs font-black uppercase text-slate-600 mb-2">Patrones de bloque (horas)</p>
          <div className="space-y-2">
            {semantics.blockPatterns.map((bp) => (
              <div
                key={bp.id}
                className={`rounded-xl border p-3 text-xs ${
                  bp.valid
                    ? 'border-indigo-200 bg-indigo-50/40'
                    : 'border-red-300 bg-red-50/60'
                }`}
              >
                <p className="font-bold text-slate-800">{bp.label}</p>
                <p className="font-mono text-sm font-bold text-indigo-900 mt-1 tracking-wide">
                  {bp.pattern}
                </p>
                <p className="text-slate-700 mt-1">
                  {bp.hoursFormula} → {bp.restFrancos}F (24h c/u)
                </p>
                <p className="text-slate-600 mt-1">{bp.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Repeat size={14} className="text-indigo-700" />
            <p className="text-xs font-black uppercase text-indigo-800">
              Ciclo activo {def.cycleKey} — {def.hoursFormula}
            </p>
          </div>
          <p className="font-mono text-sm font-bold text-indigo-900 tracking-wide">
            {def.patternExample}
          </p>
          <p className="text-[11px] text-slate-600 mt-2">{def.notCalendarDays}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Estándar {def.standardBlockHours}h · Extensión hasta {def.stretchBlockHours}h · 12h entre turnos
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-bold text-slate-800 mb-1">Ciclo vs cobertura</p>
          <p>
            <strong>{semantics.cycleVsCoverage.cycleLabel}</strong>
          </p>
          <p className="mt-0.5">
            <strong>{semantics.cycleVsCoverage.coverageLabel}</strong>
          </p>
          <p className="mt-1 text-slate-600">{semantics.cycleVsCoverage.relationship}</p>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase text-slate-500 mb-1.5">Orden al planificar</p>
          <ol className="flex flex-wrap gap-2">
            {semantics.planningOrder.map((step) => (
              <li
                key={step.key}
                className="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200"
              >
                {step.order}. {step.label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
