import React, { useEffect, useMemo, useState } from 'react';
import { seriesReliefChoiceNotice } from '@cosp/ops-core';

type Guard = {
  id: string;
  employeeName?: string;
  code?: string;
  isRetention?: boolean;
  endDateObj?: Date;
  totalMinutesWorked?: number;
  shiftDateObj?: Date;
  startTime?: unknown;
  endTime?: unknown;
  positionName?: string;
};

/**
 * Lista del modal de ingreso. El saliente de la serie queda elegido.
 * Si el operador marca otro, el aviso aparece antes del botón de confirmar.
 */
export function SeriesReliefPicker({
  incoming,
  guards,
  onChange,
}: {
  incoming: Guard;
  guards: Guard[];
  onChange: (selectedId: string | null, message: string | null) => void;
}) {
  const seriesId = useMemo(
    () => seriesReliefChoiceNotice(incoming, null, guards).seriesOutgoingId,
    [incoming, guards],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = pickedId && guards.some((g) => g.id === pickedId) ? pickedId : seriesId;
  const chosen = guards.find((g) => g.id === selectedId) || null;
  const message = seriesReliefChoiceNotice(incoming, chosen, guards).message;

  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(selectedId, message);
  }, [selectedId, message]);

  if (!guards.length) return null;

  const ordered = [...guards].sort((a, b) => {
    if (a.id === seriesId) return -1;
    if (b.id === seriesId) return 1;
    return 0;
  });

  return (
    <div className="space-y-2 mb-3">
      <p className="text-[10px] font-black text-slate-400 uppercase">A quién releva</p>
      {message && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl">
          <p className="text-xs font-bold text-amber-900 leading-snug">{message}</p>
          <p className="text-[10px] text-amber-700 mt-1">Si confirmás igual, el ingreso releva al de la serie.</p>
        </div>
      )}
      {ordered.map((s) => {
        const selected = s.id === selectedId;
        const isSeries = s.id === seriesId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setPickedId(s.id)}
            className={`w-full p-3 border rounded-xl flex justify-between items-center text-left transition-colors ${
              selected ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div>
              <span className="text-xs font-bold text-slate-800">{s.employeeName}</span>
              {s.code && <span className="ml-1 text-[10px] font-black text-slate-500">{String(s.code).toUpperCase()}</span>}
              {s.isRetention && <span className="ml-1 text-[9px] font-black px-1 py-0.5 rounded-full bg-orange-500 text-white">RETENIDO</span>}
            </div>
            <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${isSeries ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {isSeries ? 'SERIE' : selected ? 'ELEGIDO' : 'ELEGIR'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
