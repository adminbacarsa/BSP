import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import type { VplanCoverageManifest, VplanScheduleDraft } from '@/lib/vplan/vplan.types';

export function VplanSlotCoveragePanel({
  manifest,
  slotCoverage,
}: {
  manifest?: VplanCoverageManifest;
  slotCoverage?: NonNullable<VplanScheduleDraft['stats']>['slotCoverage'];
}) {
  if (!manifest) return null;

  const filled = slotCoverage?.filledSlots ?? 0;
  const required = manifest.totalRequiredSlots;
  const pct = required > 0 ? Math.round((filled / required) * 1000) / 10 : 0;
  const ok = slotCoverage?.ok ?? false;
  const byPosition = slotCoverage?.byPosition ?? manifest.byPosition;

  return (
    <div className="rounded-2xl bg-white border border-emerald-200 shadow-sm overflow-hidden">
      <div className={`px-5 py-4 border-b ${ok ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-xl p-2 shadow-sm ${ok ? 'bg-emerald-600' : 'bg-amber-500'}`}>
            {ok ? <ShieldCheck size={18} className="text-white" /> : <ShieldAlert size={18} className="text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
              Cobertura — turnos/slot
            </h2>
            {slotCoverage ? (
              <>
                <p className={`text-lg font-black mt-1 ${ok ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {filled}/{required} ({pct}%)
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{slotCoverage.summaryLabel}</p>
              </>
            ) : (
              <p className="text-sm text-slate-600 mt-1">
                Manifiesto: {manifest.summaryLabel}. Ejecutá intent <strong>Cobertura</strong> o <strong>Full</strong>.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Puesto</th>
                <th className="px-3 py-2 text-left">Requerido</th>
                <th className="px-3 py-2 text-left">Cubiertos</th>
                <th className="px-3 py-2 text-left">Faltan</th>
                <th className="px-3 py-2 text-left">Por día</th>
              </tr>
            </thead>
            <tbody>
              {byPosition.map((row) => {
                const rowOk = row.missingSlots === 0;
                return (
                  <tr key={row.positionName} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-800">{row.positionName}</td>
                    <td className="px-3 py-2">{row.requiredSlots}</td>
                    <td className={`px-3 py-2 font-bold ${rowOk ? 'text-emerald-700' : 'text-amber-800'}`}>
                      {row.filledSlots}
                    </td>
                    <td className={`px-3 py-2 ${row.missingSlots > 0 ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>
                      {row.missingSlots > 0 ? row.missingSlots : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.dailyBandsLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
