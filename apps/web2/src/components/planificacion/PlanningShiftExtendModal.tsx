import React, { useMemo, useState } from 'react';
import { X, Clock, Timer } from 'lucide-react';
import {
  collectSplitFrancoConflicts,
  listVacancySplitWorkersForDay,
  resolveEmployeeShift,
  type FrancoCoverageConflict,
} from '@/lib/planificacion/planningRecompositionApply';
import {
  applyShiftExtensionFromCell,
  endTimeAfterExtraHours,
  isShiftEligibleForExtension,
  slaEndForShift,
} from '@/lib/planificacion/shiftExtensionApply';
import { listVacancyGapBandOptions } from '@/lib/planificacion/vacancyGapBands';
import { describeVacancySplitPlan } from '@/lib/planificacion/vacancyCoverage';
import type { VacancyPositionSla } from '@/lib/planificacion/vacancySplitBands';
import type { TitularVacancyWorkShift } from '@/lib/planificacion/vacancyCoverage';

export type ShiftExtendModalData = {
  empId: string;
  empName: string;
  dateStr: string;
  /** Banda SLA faltante (ej. E3) inferida del pie de cobertura */
  suggestedGapBand?: string;
};

type Props = {
  data: ShiftExtendModalData;
  objectiveId: string;
  clientId?: string;
  employees: { id: string; name?: string }[];
  shiftsMap: Record<string, any>;
  pendingChanges: Record<string, any>;
  positionStructure: VacancyPositionSla[];
  onApply: (changes: Record<string, any>) => void;
  onClose: () => void;
  onRequestSupervisorAuth?: (
    conflicts: FrancoCoverageConflict[],
    onAuthorized: () => void,
  ) => void;
};

export default function PlanningShiftExtendModal({
  data,
  objectiveId,
  clientId,
  employees,
  shiftsMap,
  pendingChanges,
  positionStructure,
  onApply,
  onClose,
  onRequestSupervisorAuth,
}: Props) {
  const [primaryExtraH, setPrimaryExtraH] = useState(2);
  const [secondExtraH, setSecondExtraH] = useState<number | null>(4);
  const [secondId, setSecondId] = useState('');
  const [gapBand, setGapBand] = useState(data.suggestedGapBand || '');
  const [q, setQ] = useState('');

  const shift = resolveEmployeeShift(data.empId, data.dateStr, shiftsMap, pendingChanges);
  const positionName = String(shift?.positionName || positionStructure[0]?.positionName || 'General');
  const gapOptions = listVacancyGapBandOptions(positionStructure, positionName);
  const effectiveGapBand = gapBand || data.suggestedGapBand || gapOptions[0]?.code || '';

  const slaEnd = slaEndForShift(shift, positionStructure);
  const primaryEnd = endTimeAfterExtraHours(slaEnd, primaryExtraH);

  const titularStub: TitularVacancyWorkShift | null = effectiveGapBand
    ? {
      code: effectiveGapBand,
      bandLabel: effectiveGapBand,
      positionName,
      scheduleLabel: gapOptions.find((o) => o.code === effectiveGapBand)?.scheduleLabel || '—',
      hours: 8,
      source: 'user_selected',
      sourceLabel: 'Banda SLA',
    }
    : null;
  const splitPlan = titularStub ? describeVacancySplitPlan(titularStub, positionStructure) : null;

  const listCtx = {
    positionStructure,
    preferSamePosition: true,
    gapPositionName: positionName,
    gapBand: effectiveGapBand,
  };
  const poolSecond = useMemo(
    () => (effectiveGapBand
      ? listVacancySplitWorkersForDay(
        data.dateStr,
        objectiveId,
        employees,
        shiftsMap,
        pendingChanges,
        [data.empId],
        listCtx,
        splitPlan ? [splitPlan.adelBand] : [],
      ).filter((c) => !q || c.name.toLowerCase().includes(q))
      : []),
    [data.dateStr, data.empId, effectiveGapBand, employees, listCtx, pendingChanges, q, splitPlan, objectiveId, shiftsMap],
  );

  const employeesById = useMemo(
    () => Object.fromEntries(employees.filter((e) => e.id).map((e) => [e.id!, e])),
    [employees],
  );

  if (!isShiftEligibleForExtension(shift)) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl p-6 max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm font-bold text-slate-700">Este día no tiene turno laboral para extender.</p>
          <button type="button" onClick={onClose} className="mt-4 w-full py-2 rounded-xl bg-slate-100 font-bold">Cerrar</button>
        </div>
      </div>
    );
  }

  const commit = (authorizeFranco: boolean) => {
    const changes = applyShiftExtensionFromCell(pendingChanges, {
      objectiveId,
      clientId,
      dateStr: data.dateStr,
      primaryEmpId: data.empId,
      primaryExtraHours: primaryExtraH,
      secondEmpId: secondId || null,
      secondExtraHours: secondId ? secondExtraH : null,
      gapBand: effectiveGapBand || gapBand || null,
      gapPosition: positionName,
      positionStructure,
      shiftsMap,
      employeesById,
      authorizeFrancoTrabajado: authorizeFranco,
    });
    onApply(changes);
    onClose();
  };

  const tryApply = () => {
    if (secondId) {
      const conflicts = collectSplitFrancoConflicts(
        data.dateStr,
        data.empId,
        secondId,
        employeesById,
        shiftsMap,
        pendingChanges,
      );
      if (conflicts.length > 0 && onRequestSupervisorAuth) {
        onRequestSupervisorAuth(conflicts, () => commit(true));
        return;
      }
      commit(conflicts.length > 0);
      return;
    }
    commit(false);
  };

  const [, mo, dd] = data.dateStr.split('-');
  const code = String(shift?.code || '').toUpperCase();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b bg-gradient-to-r from-red-50 to-orange-50 flex justify-between gap-3">
          <div>
            <h3 className="font-black text-lg text-slate-900 flex items-center gap-2">
              <Timer className="text-red-600" size={20} />
              Extender jornada
            </h3>
            <p className="text-[11px] font-bold text-slate-600 mt-1">
              {dd}/{mo} · {data.empName} · <span className="font-mono">{code}</span> · fin SLA {slaEnd}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-white/80 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar space-y-3 flex-1">
          <div className="rounded-xl border border-red-200 bg-red-50/80 px-3 py-2.5">
            <div className="text-[10px] font-black uppercase text-red-900 mb-1">Este guardia (+horas)</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[1, 2, 3, 4].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setPrimaryExtraH(h)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${primaryExtraH === h ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-200'}`}
                >
                  +{h}h
                </button>
              ))}
            </div>
            <p className="text-[10px] font-bold text-red-800">
              Fin efectivo: <span className="font-mono">{slaEnd}</span> → <span className="font-mono">{primaryEnd}</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-2">
            <div className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
              <Clock size={11} /> Cerrar banda SLA (opcional 2.º guardia)
            </div>
            <p className="text-[9px] text-slate-500">Sin 2.º guardia solo extendés a este empleado. Con 2.º guardia cerrás el hueco del día (ej. E3).</p>
            {gapOptions.length > 0 && (
              <select
                className="w-full rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
                value={effectiveGapBand}
                onChange={(e) => setGapBand(e.target.value)}
              >
                {gapOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} · {o.scheduleLabel}
                  </option>
                ))}
              </select>
            )}
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold bg-white"
              placeholder="Filtrar 2.º guardia..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="space-y-1 max-h-28 overflow-y-auto rounded-lg border border-slate-100 p-1 bg-white">
              <button
                type="button"
                onClick={() => setSecondId('')}
                className={`w-full px-2 py-1.5 text-left text-[10px] font-bold rounded ${!secondId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                Solo extender a {data.empName.split(',')[0]}
              </button>
              {poolSecond.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSecondId(c.id)}
                  className={`w-full px-2 py-1.5 text-left text-xs font-bold rounded border ${secondId === c.id ? 'bg-red-100 border-red-400' : 'border-transparent hover:bg-slate-50'}`}
                >
                  {c.name} · {c.code}
                </button>
              ))}
            </div>
            {secondId && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSecondExtraH(4)}
                  className={`px-2 py-1 rounded text-[9px] font-black border ${secondExtraH === 4 ? 'bg-violet-600 text-white' : 'bg-white border-slate-200'}`}
                >
                  2.º +4h
                </button>
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  className="w-20 rounded border px-1 py-1 text-xs font-bold"
                  placeholder="+h 2.º"
                  value={secondExtraH ?? ''}
                  onChange={(e) => setSecondExtraH(e.target.value ? Number(e.target.value) : null)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl font-bold bg-slate-100 text-slate-500">
            Cancelar
          </button>
          <button
            type="button"
            onClick={tryApply}
            className="flex-1 py-3 rounded-xl font-black text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200"
          >
            {secondId ? 'Extender y cerrar banda' : 'Aplicar extensión'}
          </button>
        </div>
      </div>
    </div>
  );
}
