import React from 'react';
import { Calculator, Target } from 'lucide-react';
import type { VplanPlanningTarget } from '@/lib/vplan/vplan.types';

function formatBandSlots(bandSlots: Record<string, number>): string {
  const entries = Object.entries(bandSlots).filter(([, n]) => n > 0);
  if (entries.length === 0) return '—';
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, n]) => `${n}×${code}`)
    .join(' + ');
}

export function VplanPlanningTargetPanel({ target }: { target: VplanPlanningTarget }) {
  return (
    <div className="rounded-2xl bg-white border border-indigo-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-50 to-slate-50 px-5 py-4 border-b border-indigo-100">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-600 p-2 shadow-sm">
            <Target size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
              Qué planificar (fase 1)
            </h2>
            <p className="text-sm text-indigo-900 font-medium mt-1">{target.headline}</p>
            <p className="text-xs text-slate-600 mt-1">{target.summary}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Calculator size={16} className="text-indigo-700" />
            <h3 className="text-xs font-bold uppercase text-indigo-800">
              Aritmética mensual (turnos/slot)
            </h3>
          </div>
          <ul className="space-y-1.5 font-mono text-[11px] text-slate-800">
            {target.slotArithmeticLines.map((line) => (
              <li key={line} className="leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 pt-3 border-t border-indigo-200 font-black text-sm text-indigo-900">
            TOTAL = {target.totalFormulaLabel}
          </p>
        </div>

        {target.monthBandRollup.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">
              Agregado por banda (suma de puestos)
            </h3>
            <ul className="space-y-1 text-xs text-slate-700 font-mono">
              {target.monthBandRollup.map((row) => (
                <li key={row.band} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  {row.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Detalle por puesto (SLA)</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Puesto</th>
                  <th className="px-3 py-2 text-left">Qty</th>
                  <th className="px-3 py-2 text-left">Días</th>
                  <th className="px-3 py-2 text-left">Por día activo</th>
                  <th className="px-3 py-2 text-left">Fórmula mes</th>
                </tr>
              </thead>
              <tbody>
                {target.positionRules.map((rule) => (
                  <tr key={rule.positionName} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-800">{rule.positionName}</td>
                    <td className="px-3 py-2">{rule.qty}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {rule.activeDayCount}
                      <span className="block text-[10px] text-slate-400">{rule.activeDaysLabel}</span>
                    </td>
                    <td className="px-3 py-2 font-medium text-indigo-800">
                      {rule.dailyBandsLabel}
                      <span className="block text-[10px] text-slate-500">
                        {rule.slotsPerActiveDay} slot/día
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {rule.monthlyFormulaLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {target.dayTypeExamples.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Ejemplos de día</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {target.dayTypeExamples.map((ex) => (
                <div
                  key={`${ex.label}_${ex.dateStr}`}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm"
                >
                  <p className="text-xs font-bold text-indigo-700">{ex.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {ex.dateStr} ({ex.dayLetter}) · {ex.totalSlots} slots · {ex.totalHours}h
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {ex.positions.map((p) => (
                      <li key={`${ex.dateStr}_${p.positionName}`}>
                        <span className="font-semibold">{p.positionName}</span>
                        {' · '}
                        {p.requirementLabel}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900">
          <strong>Fórmula:</strong> por puesto,{' '}
          <strong>días activos × bandas/día = turnos/slot del mes</strong>. Ej. Puesto 2 Qty 1 en julio:
          31 × (1M+1T+1N) = 31+31+31 = <strong>93</strong> (no 96: son 3 bandas × 31 días, no 32×3).
          VPLAN calcula esto desde el SLA para cualquier objetivo.
        </div>
      </div>
    </div>
  );
}
