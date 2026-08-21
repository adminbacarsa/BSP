import React, { useEffect, useMemo, useState } from 'react';
import { X, Clock, Timer } from 'lucide-react';
import { toast } from 'sonner';
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
  /** Banda SLA faltante (ej. T, E3) inferida del pie de cobertura */
  suggestedGapBand?: string;
  /** Puesto donde falta cerrar la banda (ej. 136), no el puesto “casa” del guardia */
  gapPositionName?: string;
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
  const [gapHoursSynced, setGapHoursSynced] = useState(false);

  const shift = resolveEmployeeShift(data.empId, data.dateStr, shiftsMap, pendingChanges);
  const homePosition = String(shift?.positionName || positionStructure[0]?.positionName || 'General');
  const gapPositionName = String(data.gapPositionName || homePosition);
  const gapOptions = listVacancyGapBandOptions(positionStructure, gapPositionName);
  /** Banda SLA a cerrar (hueco del día). No confundir con el turno base E1/E2 del guardia. */
  const slaGapBand = gapBand || data.suggestedGapBand || '';
  const uiBand = slaGapBand || gapOptions[0]?.code || '';
  const selectedGapOpt = gapOptions.find((o) => o.code === uiBand);
  const gapBandHours = selectedGapOpt?.hours ?? 8;

  useEffect(() => {
    if (gapHoursSynced || !selectedGapOpt?.hours || selectedGapOpt.hours <= 0) return;
    setPrimaryExtraH(selectedGapOpt.hours);
    setGapHoursSynced(true);
  }, [selectedGapOpt?.hours, gapHoursSynced]);

  const slaEnd = slaEndForShift(shift, positionStructure);
  const primaryEnd = endTimeAfterExtraHours(slaEnd, primaryExtraH);
  const soloCoversFullBand = !secondId && primaryExtraH + 0.05 >= gapBandHours;

  const titularStub: TitularVacancyWorkShift | null = uiBand
    ? {
      code: uiBand,
      bandLabel: uiBand,
      positionName: gapPositionName,
      scheduleLabel: selectedGapOpt?.scheduleLabel || '—',
      hours: gapBandHours,
      source: 'user_selected',
      sourceLabel: 'Banda SLA',
    }
    : null;
  const splitPlan = titularStub ? describeVacancySplitPlan(titularStub, positionStructure) : null;

  const listCtx = {
    positionStructure,
    preferSamePosition: true,
    gapPositionName,
    gapBand: uiBand,
  };
  const poolSecond = useMemo(
    () => (uiBand
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
    [data.dateStr, data.empId, uiBand, employees, listCtx, pendingChanges, q, splitPlan, objectiveId, shiftsMap],
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
    const bandForMeta = secondId
      ? uiBand
      : (data.suggestedGapBand || gapBand || null);
    try {
      const changes = applyShiftExtensionFromCell(pendingChanges, {
        objectiveId,
        clientId,
        dateStr: data.dateStr,
        primaryEmpId: data.empId,
        primaryExtraHours: primaryExtraH,
        secondEmpId: secondId || null,
        secondExtraHours: secondId ? secondExtraH : null,
        gapBand: bandForMeta,
        gapPosition: gapPositionName,
        positionStructure,
        shiftsMap,
        employeesById,
        authorizeFrancoTrabajado: authorizeFranco,
      });
      onApply(changes);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo aplicar la extensión';
      toast.error(msg);
    }
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
    if (uiBand) {
      toast.message('Solo extendiste a este guardia', {
        description: `Para cerrar banda ${uiBand} en ${gapPositionName}, elegí un 2.º guardia abajo o usá «Cerrar banda» en el pie del día.`,
      });
    }
    commit(false);
  };

  const [, mo, dd] = data.dateStr.split('-');
  const code = String(shift?.code || '').toUpperCase();

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
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
              {[1, 2, 3, 4, 6, 8].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setPrimaryExtraH(h)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${primaryExtraH === h ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-200'}`}
                >
                  +{h}h
                </button>
              ))}
              <input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                className="w-16 rounded-lg border border-slate-200 px-1.5 py-1 text-[10px] font-black"
                title="Horas libres"
                value={primaryExtraH}
                onChange={(e) => setPrimaryExtraH(Math.max(0.5, Number(e.target.value) || 0.5))}
              />
            </div>
            <p className="text-[10px] font-bold text-red-800">
              Fin efectivo: <span className="font-mono">{slaEnd}</span> → <span className="font-mono">{primaryEnd}</span>
              {uiBand && (
                <span className="block text-[9px] text-red-700/80 mt-0.5">
                  Banda {uiBand}: {gapBandHours}h ({selectedGapOpt?.scheduleLabel || '—'})
                  {soloCoversFullBand ? ' · alcanza para cerrar el puesto' : ' · faltan horas para cerrar solo'}
                </span>
              )}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-2">
            <div className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
              <Clock size={11} /> Cerrar banda SLA (opcional 2.º guardia)
            </div>
            <p className="text-[9px] text-slate-500">
              Puesto a cerrar: <span className="font-black text-slate-800">{gapPositionName}</span>
              {homePosition !== gapPositionName && (
                <span className="text-amber-700"> · guardia en {homePosition}</span>
              )}
            </p>
            <p className="text-[9px] text-slate-500">
              Sin 2.º guardia: extendé al menos las <span className="font-black">{gapBandHours}h</span> de la banda para cerrar el hueco.
              Con 2.º guardia repartís el tramo (ext + adel).
            </p>
            {gapOptions.length > 0 && (
              <select
                className="w-full rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
                value={uiBand}
                onChange={(e) => {
                  setGapBand(e.target.value);
                  const hrs = gapOptions.find((o) => o.code === e.target.value)?.hours;
                  if (hrs && hrs > 0) setPrimaryExtraH(hrs);
                }}
              >
                {gapOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} · {o.scheduleLabel} · {o.hours}h
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
