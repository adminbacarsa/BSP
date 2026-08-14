import React, { useMemo, useState } from 'react';
import { X, Clock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  collectSplitFrancoConflicts,
  listEarlyStartCandidates,
  listExtensionCandidates,
  listPlannedFrancoCandidates,
  resolveEmployeeShift,
  type FrancoCoverageConflict,
  type SegmentCandidateRow,
} from '@/lib/planificacion/planningRecompositionApply';
import {
  applyFrancoTrabajadoGapCloseToChanges,
  applyOperationalGapCloseToChanges,
  applySingleWorkerFullGapCloseToChanges,
} from '@/lib/planificacion/operationalGapCoverage';
import {
  describeVacancySplitPlan,
  resolveVacancySplitSegmentTimes,
  vacancySplitUsesManualExtraHours,
  type TitularVacancyWorkShift,
} from '@/lib/planificacion/vacancyCoverage';
import { listVacancyGapBandOptions } from '@/lib/planificacion/vacancyGapBands';
import type { VacancyPositionSla } from '@/lib/planificacion/vacancySplitBands';

export type SlaGapCloseModalData = {
  dateStr: string;
  positionName: string;
  gapBand: string;
};

type Props = {
  data: SlaGapCloseModalData;
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

function titularFromGap(band: string, positionName: string, structure: VacancyPositionSla[]): TitularVacancyWorkShift {
  const opt = listVacancyGapBandOptions(structure, positionName).find((o) => o.code === band);
  return {
    code: band,
    bandLabel: band,
    positionName,
    scheduleLabel: opt?.scheduleLabel || '—',
    hours: opt?.hours || 8,
    source: 'user_selected',
    sourceLabel: 'Hueco SLA del día',
  };
}

export default function PlanningSlaGapCloseModal({
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
  const [coverMode, setCoverMode] = useState<'solo' | 'split'>('solo');
  const [extId, setExtId] = useState('');
  const [extApplyDate, setExtApplyDate] = useState('');
  const [secondId, setSecondId] = useState('');
  const [soloId, setSoloId] = useState('');
  const [soloApplyDate, setSoloApplyDate] = useState('');
  const [ftId, setFtId] = useState('');
  const [extExtraH, setExtExtraH] = useState<number | null>(null);
  const [secondExtraH, setSecondExtraH] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const titular = useMemo(
    () => titularFromGap(data.gapBand, data.positionName, positionStructure),
    [data.gapBand, data.positionName, positionStructure],
  );
  const splitPlan = useMemo(
    () => describeVacancySplitPlan(titular, positionStructure),
    [titular, positionStructure],
  );
  const listCtx = useMemo(() => ({
    positionStructure,
    preferSamePosition: false,
    gapPositionName: data.positionName,
    gapBand: data.gapBand,
  }), [positionStructure, data.positionName, data.gapBand]);
  const poolExt = useMemo(
    () => listExtensionCandidates(
      data.gapBand,
      data.dateStr,
      objectiveId,
      employees,
      shiftsMap,
      pendingChanges,
      [],
      listCtx,
    ).filter((c) => !q || c.name.toLowerCase().includes(q)),
    [data.gapBand, data.dateStr, objectiveId, employees, shiftsMap, pendingChanges, listCtx, q],
  );
  const poolSecond = useMemo(
    () => listEarlyStartCandidates(
      data.gapBand,
      data.dateStr,
      objectiveId,
      employees,
      shiftsMap,
      pendingChanges,
      [extId].filter(Boolean),
      listCtx,
    ).filter((c) => !q || c.name.toLowerCase().includes(q)),
    [data.gapBand, data.dateStr, objectiveId, employees, shiftsMap, pendingChanges, extId, listCtx, q],
  );
  const poolSolo = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<SegmentCandidateRow & { soloRole: 'ext' | 'adel' }> = [];
    for (const c of poolExt) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rows.push({ ...c, soloRole: 'ext' });
    }
    for (const c of poolSecond) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rows.push({ ...c, soloRole: 'adel' });
    }
    return rows;
  }, [poolExt, poolSecond]);
  const poolFt = useMemo(
    () => listPlannedFrancoCandidates(
      data.dateStr,
      objectiveId,
      employees,
      shiftsMap,
      pendingChanges,
      [extId, secondId].filter(Boolean),
    ).filter((c) => !q || c.name.toLowerCase().includes(q)),
    [data.dateStr, objectiveId, employees, shiftsMap, pendingChanges, extId, secondId, q],
  );

  const manual = vacancySplitUsesManualExtraHours({ extExtraHours: extExtraH, secondExtExtraHours: secondExtraH });
  const extCand = poolExt.find((c) => c.id === extId);
  const extShiftDate = extApplyDate || data.dateStr;
  const secondCand = poolSecond.find((c) => c.id === secondId);
  const preview = extId && secondId
    ? resolveVacancySplitSegmentTimes(
      positionStructure,
      data.gapBand,
      data.positionName,
      { positionName: extCand?.positionName, code: extCand?.code },
      { positionName: secondCand?.positionName, code: secondCand?.code },
      extExtraH,
      secondExtraH,
    )
    : null;

  const employeesById = useMemo(
    () => Object.fromEntries(employees.filter((e) => e.id).map((e) => [e.id!, e])),
    [employees],
  );

  const commit = (authorizeFranco: boolean) => {
    try {
      if (ftId) {
        const changes = applyFrancoTrabajadoGapCloseToChanges(pendingChanges, {
          objectiveId,
          clientId,
          dateStr: data.dateStr,
          gapPosition: data.positionName,
          gapBand: data.gapBand,
          employeeId: ftId,
          positionStructure,
          authorizeFrancoTrabajado: authorizeFranco,
        }, {
          shiftsMap,
          employeesById,
        });
        onApply(changes);
        onClose();
        return;
      }
      if (coverMode === 'solo' && soloId) {
        const changes = applySingleWorkerFullGapCloseToChanges(pendingChanges, {
          objectiveId,
          clientId,
          dateStr: data.dateStr,
          gapPosition: data.positionName,
          gapBand: data.gapBand,
          employeeId: soloId,
          applyDateStr: soloApplyDate || data.dateStr,
          positionStructure,
        }, {
          shiftsMap,
          employeesById,
        });
        onApply(changes);
        onClose();
        return;
      }
      if (!extId || !secondId) {
        toast.error('Elegí una persona para las 8 h, o un guardia por tramo, o un franco trabajado.');
        return;
      }
      if (extId === secondId) {
        toast.error('Los dos tramos deben ser guardias distintos.');
        return;
      }
      const extShift = resolveEmployeeShift(extId, extShiftDate, shiftsMap, pendingChanges);
      const secondShift = resolveEmployeeShift(secondId, data.dateStr, shiftsMap, pendingChanges);
      if (!extShift || extShift.isDeleted) {
        toast.error('El guardia del 1.er tramo no tiene turno laboral ese día.');
        return;
      }
      if (!secondShift || secondShift.isDeleted) {
        toast.error('El guardia del 2.º tramo no tiene turno laboral ese día.');
        return;
      }
      const changes = applyOperationalGapCloseToChanges(pendingChanges, {
        objectiveId,
        clientId,
        dateStr: data.dateStr,
        gapPosition: data.positionName,
        gapBand: data.gapBand,
        extEmpId: extId,
        secondEmpId: secondId,
        extHomePosition: extShift?.positionName,
        extBaseCode: extShift?.code,
        secondBaseCode: secondShift?.code,
        extExtraHours: extExtraH,
        secondExtExtraHours: secondExtraH,
        positionStructure,
        authorizeFrancoTrabajado: authorizeFranco,
        extApplyDateStr: extShiftDate !== data.dateStr ? extShiftDate : undefined,
      }, {
        shiftsMap,
        employeesById,
      });
      onApply(changes);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cerrar la banda';
      toast.error(msg);
    }
  };

  const tryApply = () => {
    if (ftId) {
      const ftShift = resolveEmployeeShift(ftId, data.dateStr, shiftsMap, pendingChanges);
      const conflicts: FrancoCoverageConflict[] = [{
        employeeId: ftId,
        employeeName: employeesById[ftId]?.name || ftId,
        dateStr: data.dateStr,
        role: 'SUBSTITUTE',
        francoCode: String(ftShift?.code || 'F').toUpperCase(),
      }];
      if (onRequestSupervisorAuth) {
        onRequestSupervisorAuth(conflicts, () => commit(true));
        return;
      }
      commit(true);
      return;
    }
    const conflicts = collectSplitFrancoConflicts(
      data.dateStr,
      extId,
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
  };

  const [, mo, dd] = data.dateStr.split('-');

    return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-violet-50 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-lg text-slate-900 flex items-center gap-2">
              <ShieldCheck className="text-rose-600" size={20} />
              Cerrar hueco SLA
            </h3>
            <p className="text-[11px] font-bold text-slate-600 mt-1">
              {dd}/{mo} · {data.positionName} · banda <span className="font-mono text-rose-700">{data.gapBand}</span>
              {titular.scheduleLabel !== '—' && <> · {titular.scheduleLabel}</>}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Una persona cubre las 8 h, o se reparte 4+4 (extensión del turno anterior + adelanto del siguiente).
            </p>
            {splitPlan && (
              <p className="text-[9px] font-bold text-rose-800 mt-1">
                Sugerido: ext banda <span className="font-mono">{splitPlan.extBand}</span> + 2.º banda <span className="font-mono">{splitPlan.adelBand}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-white/80 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar space-y-3 flex-1">
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold bg-slate-50"
            placeholder="Filtrar guardias..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-2">
            <div className="text-[10px] font-black uppercase text-violet-900 mb-1">
              Franco trabajado (FT) — cubre la banda completa
            </div>
            <p className="text-[9px] font-bold text-violet-800/80 mb-1.5">
              Último recurso CCT (costo extra). Requiere autorización de supervisor.
            </p>
            <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-violet-100 bg-white p-1">
              {poolFt.length === 0 ? (
                <p className="text-[10px] font-bold text-slate-500 px-2 py-3">
                  Nadie de este objetivo está de franco (F/FF/FP) ese día.
                </p>
              ) : poolFt.map((c) => (
                <button
                  key={`ft_${c.id}`}
                  type="button"
                  onClick={() => {
                    setFtId(c.id);
                    setSoloId('');
                    setExtId('');
                    setSecondId('');
                    setExtApplyDate('');
                  }}
                  className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border ${ftId === c.id ? 'bg-violet-600 text-white border-violet-700' : 'bg-white border-slate-200 text-slate-800'}`}
                >
                  {c.name} · {c.code} · Franco
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCoverMode('solo');
                setExtId('');
                setSecondId('');
                setExtApplyDate('');
              }}
              className={`flex-1 py-2 rounded-xl text-[10px] font-black border ${coverMode === 'solo' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 text-slate-600'}`}
            >
              Una persona · 8 h
            </button>
            <button
              type="button"
              onClick={() => {
                setCoverMode('split');
                setSoloId('');
              }}
              className={`flex-1 py-2 rounded-xl text-[10px] font-black border ${coverMode === 'split' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 text-slate-600'}`}
            >
              Repartir 4+4
            </button>
          </div>

          {coverMode === 'solo' && (
          <div>
            <div className="text-[10px] font-black uppercase text-slate-500 mb-1">
              Cubre {titular.scheduleLabel !== '—' ? titular.scheduleLabel : 'las 8 h'}
            </div>
            <p className="text-[9px] font-bold text-slate-500 mb-1.5">
              Solo banda anterior ({splitPlan?.extBand || 'M'}) o siguiente ({splitPlan?.adelBand || 'N'}). No se adelanta un turno ya pasado.
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto rounded-xl border border-slate-100 p-1">
              {poolSolo.length === 0 ? (
                <p className="text-[10px] font-bold text-amber-800 px-2 py-3">
                  No hay guardia en la banda anterior o siguiente para cubrir las 8 h.
                </p>
              ) : poolSolo.map((c) => (
                <button
                  key={`solo_${c.id}_${c.extensionApplyDate || data.dateStr}`}
                  type="button"
                  onClick={() => {
                    setFtId('');
                    setSoloId(c.id);
                    setSoloApplyDate(c.extensionApplyDate || data.dateStr);
                  }}
                  className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border ${soloId === c.id ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200'}`}
                >
                  {c.name} · {c.code} · {c.positionName}
                  <span className="block text-[9px] font-bold text-slate-500">
                    {c.soloRole === 'ext' ? 'Extiende' : 'Adelanta'} {titular.scheduleLabel !== '—' ? titular.scheduleLabel : '8 h'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}

          {coverMode === 'split' && (
          <>
          <div>
            <div className="text-[10px] font-black uppercase text-slate-500 mb-1">
              1.er tramo {preview ? `(${preview.first.from}–${preview.first.to})` : splitPlan ? `(${splitPlan.extSegment})` : ''}
              {splitPlan?.extBand && <span className="font-mono text-slate-400"> · solo {splitPlan.extBand}</span>}
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-slate-100 p-1">
              {poolExt.length === 0 ? (
                <p className="text-[10px] font-bold text-amber-800 px-2 py-3">No hay guardias con turno ese día para el 1.er tramo.</p>
              ) : poolExt.map((c: SegmentCandidateRow) => (
                <button
                  key={`${c.id}_${c.extensionApplyDate || data.dateStr}`}
                  type="button"
                  onClick={() => {
                    setFtId('');
                    setSoloId('');
                    setExtId(c.id);
                    setExtApplyDate(c.extensionApplyDate || data.dateStr);
                  }}
                  className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border ${extId === c.id ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200'}`}
                >
                  {c.name} · {c.code} · {c.positionName}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-black uppercase text-slate-500 mb-1">
              2.º tramo {preview ? `(${preview.second.from}–${preview.second.to})` : splitPlan ? `(${splitPlan.adelSegment})` : ''}
              {splitPlan?.adelBand && <span className="font-mono text-slate-400"> · solo {splitPlan.adelBand}</span>}
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-slate-100 p-1">
              {poolSecond.length === 0 ? (
                <p className="text-[10px] font-bold text-amber-800 px-2 py-3">
                  No hay guardia en la banda siguiente ({splitPlan?.adelBand || 'N'}) para adelantar.
                </p>
              ) : poolSecond.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setFtId('');
                    setSoloId('');
                    setSecondId(c.id);
                  }}
                  className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border ${secondId === c.id ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200'}`}
                >
                  {c.name} · {c.code} · {c.positionName}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2.5 space-y-2">
            <div className="text-[10px] font-black uppercase text-violet-900 flex items-center gap-1">
              <Clock size={11} /> Horas de extensión
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => { setExtExtraH(null); setSecondExtraH(null); }}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${!manual ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200'}`}
              >
                Auto SLA
              </button>
              <button
                type="button"
                onClick={() => { setExtExtraH(2); setSecondExtraH(4); }}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${manual && extExtraH === 2 && secondExtraH === 4 ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-200'}`}
              >
                +2h / +4h
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] font-bold text-slate-600">
                1.er (+h)
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                  placeholder="Auto"
                  value={extExtraH ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setExtExtraH(raw ? Number(raw) : null);
                  }}
                />
              </label>
              <label className="text-[9px] font-bold text-slate-600">
                2.º (+h)
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                  placeholder="Auto"
                  value={secondExtraH ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setSecondExtraH(raw ? Number(raw) : null);
                  }}
                />
              </label>
            </div>
            {preview && (
              <p className="text-[9px] font-bold text-violet-900 border-t border-violet-200/80 pt-1">
                Hueco {preview.gap.from}–{preview.gap.to} · 1.º {preview.first.from}–{preview.first.to} · 2.º {preview.second.from}–{preview.second.to}
              </p>
            )}
          </div>
          </>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-slate-500 bg-slate-100">
            Cancelar
          </button>
          <button
            type="button"
            disabled={ftId ? false : coverMode === 'solo' ? !soloId : (!extId || !secondId || extId === secondId)}
            onClick={tryApply}
            className="flex-1 py-3 rounded-xl font-black text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-lg shadow-rose-200"
          >
            {ftId ? 'Aplicar franco trabajado' : coverMode === 'solo' ? 'Aplicar 8 h' : 'Aplicar y cerrar banda'}
          </button>
        </div>
      </div>
    </div>
  );
}
