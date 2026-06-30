import React, { useMemo, useState } from 'react';
import { X, ArrowRight, User, Clock, Split, Unlock, AlertTriangle, CheckCircle } from 'lucide-react';
import type { RecompositionMode, RecompositionPackage, RecompositionTarget } from '@/lib/planificacion/planningRecomposition.types';
import {
  buildRecompositionPendingUpdates,
  defaultSplitForBand,
  listEarlyStartCandidates,
  listExtensionCandidates,
  listRecompositionTargets,
  neighborBandsForTarget,
} from '@/lib/planificacion/planningRecompositionApply';

type Props = {
  dateStr: string;
  objectiveId: string;
  objectiveName: string;
  clientId?: string;
  employees: { id: string; name?: string }[];
  shiftsMap: Record<string, any>;
  pendingChanges: Record<string, any>;
  absencesMap: Record<string, any>;
  preselectedEmpId?: string | null;
  onApply: (updates: Record<string, any>, pkg: RecompositionPackage) => void;
  onClose: () => void;
};

export default function PlanningRecompositionModal({
  dateStr,
  objectiveId,
  objectiveName,
  clientId,
  employees,
  shiftsMap,
  pendingChanges,
  absencesMap,
  preselectedEmpId,
  onApply,
  onClose,
}: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<RecompositionMode>('liberation');
  const [targetId, setTargetId] = useState<string>(preselectedEmpId || '');
  const [extEmpId, setExtEmpId] = useState('');
  const [adelEmpId, setAdelEmpId] = useState('');
  const [gapPos, setGapPos] = useState('');
  const [extFrom, setExtFrom] = useState('15:00');
  const [extTo, setExtTo] = useState('19:00');
  const [adelFrom, setAdelFrom] = useState('19:00');
  const [adelTo, setAdelTo] = useState('23:00');
  const [redeployNote, setRedeployNote] = useState('');
  const [error, setError] = useState('');

  const employeesById = useMemo(() => {
    const m: Record<string, any> = {};
    employees.forEach(e => { m[e.id] = e; });
    return m;
  }, [employees]);

  const targets = useMemo(
    () => listRecompositionTargets(dateStr, objectiveId, employees, shiftsMap, pendingChanges, absencesMap),
    [dateStr, objectiveId, employees, shiftsMap, pendingChanges, absencesMap],
  );

  const selectedTarget: RecompositionTarget | undefined = targets.find(t => t.employeeId === targetId);

  const bandNeighbors = useMemo(
    () => (selectedTarget ? neighborBandsForTarget(selectedTarget.code) : null),
    [selectedTarget?.code],
  );

  const extCandidates = useMemo(
    () => selectedTarget
      ? listExtensionCandidates(selectedTarget.code, dateStr, objectiveId, employees, shiftsMap, pendingChanges, [targetId])
      : [],
    [selectedTarget, dateStr, objectiveId, employees, shiftsMap, pendingChanges, targetId],
  );

  const adelCandidates = useMemo(
    () => selectedTarget
      ? listEarlyStartCandidates(selectedTarget.code, dateStr, objectiveId, employees, shiftsMap, pendingChanges, [targetId, extEmpId].filter(Boolean))
      : [],
    [selectedTarget, dateStr, objectiveId, employees, shiftsMap, pendingChanges, targetId, extEmpId],
  );

  const pickTarget = (t: RecompositionTarget) => {
    setTargetId(t.employeeId);
    setGapPos(t.positionName);
    const split = defaultSplitForBand(t.code);
    setExtFrom(split.ext.from);
    setExtTo(split.ext.to);
    setAdelFrom(split.adel.from);
    setAdelTo(split.adel.to);
    setExtEmpId('');
    setAdelEmpId('');
    if (t.kind === 'absence') setMode('absence');
    else setMode('liberation');
    setStep(2);
  };

  const handleConfirm = () => {
    setError('');
    if (!selectedTarget || !extEmpId || !adelEmpId) {
      setError('Completá guardia extensión, adelanto y objetivo.');
      return;
    }
    if (extEmpId === adelEmpId) {
      setError('Extensión y adelanto deben ser guardias distintos.');
      return;
    }
    if (extTo !== adelFrom) {
      setError('Los tramos deben ser contiguos (fin ext = inicio adel).');
      return;
    }

    const pkg: RecompositionPackage = {
      id: `cov_${Date.now()}`,
      type: mode === 'liberation' ? 'LIBERATION_RECOMPOSITION' : 'ABSENCE_COVERAGE',
      mode,
      objectiveId,
      dateStr,
      target: selectedTarget,
      gapFrom: extFrom,
      gapTo: adelTo,
      gapPositionName: gapPos || selectedTarget.positionName,
      extension: {
        employeeId: extEmpId,
        role: 'EXTENSION',
        positionName: gapPos || selectedTarget.positionName,
        fromTime: extFrom,
        toTime: extTo,
        homePositionName: extCandidates.find(c => c.id === extEmpId)?.positionName,
        baseCode: extCandidates.find(c => c.id === extEmpId)?.code,
      },
      earlyStart: {
        employeeId: adelEmpId,
        role: 'EARLY_START',
        positionName: gapPos || selectedTarget.positionName,
        fromTime: adelFrom,
        toTime: adelTo,
        baseCode: adelCandidates.find(c => c.id === adelEmpId)?.code,
      },
      liberationReason: mode === 'liberation' ? 'EVENTO' : undefined,
      redeployNote: mode === 'liberation' ? redeployNote : undefined,
    };

    try {
      const updates = buildRecompositionPendingUpdates(pkg, {
        shiftsMap,
        pendingChanges,
        employeesById,
        objectiveId,
        clientId,
      });
      onApply(updates, pkg);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Error al armar el paquete');
    }
  };

  const fmtDate = dateStr.split('-').reverse().join('/');

  return (
    <div className="fixed inset-0 z-[9200] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Cobertura / Liberación</h3>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5">{objectiveName} · {fmtDate}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {step === 1 && (
            <>
              <p className="text-xs font-bold text-slate-600">¿Qué querés hacer?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('absence')}
                  className={`p-3 rounded-xl border-2 text-left transition-colors ${mode === 'absence' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <AlertTriangle size={16} className="text-indigo-600 mb-1" />
                  <div className="text-[11px] font-black text-slate-800">Cubrir ausencia</div>
                  <div className="text-[9px] text-slate-500">Vacante / enfermedad / licencia</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('liberation')}
                  className={`p-3 rounded-xl border-2 text-left transition-colors ${mode === 'liberation' ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <Unlock size={16} className="text-violet-600 mb-1" />
                  <div className="text-[11px] font-black text-slate-800">Liberar → RET</div>
                  <div className="text-[9px] text-slate-500">Evento / otro objetivo</div>
                </button>
              </div>

              <p className="text-[10px] font-black text-slate-500 uppercase">Seleccioná turno / guardia</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {targets
                  .filter(t => (mode === 'absence' ? t.kind === 'absence' : t.kind === 'working'))
                  .map(t => (
                    <button
                      key={t.employeeId}
                      type="button"
                      onClick={() => pickTarget(t)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-left"
                    >
                      <User size={14} className="text-slate-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{t.label}</span>
                    </button>
                  ))}
                {targets.filter(t => (mode === 'absence' ? t.kind === 'absence' : t.kind === 'working')).length === 0 && (
                  <p className="text-[10px] text-slate-500 py-4 text-center leading-relaxed px-2">
                    {mode === 'absence'
                      ? 'No hay ausencias ni códigos V/L/E/A/AA/PG cargados en este día para este objetivo. Usá Ausencia/RRHH en la grilla o elegí Liberar → RET si querés liberar a un guardia con turno M/T/N.'
                      : 'No hay guardias con turno de trabajo (M/T/N…) este día en el objetivo.'}
                  </p>
                )}
              </div>
            </>
          )}

          {step >= 2 && selectedTarget && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600">
                {mode === 'liberation' ? (
                  <><Unlock size={12} className="inline mr-1 text-violet-600" />{selectedTarget.label} → <strong>RET</strong></>
                ) : (
                  <><AlertTriangle size={12} className="inline mr-1 text-indigo-600" />Cubre: {selectedTarget.label}</>
                )}
              </div>

              {mode === 'liberation' && (
                <label className="block">
                  <span className="text-[10px] font-black text-slate-500 uppercase">Destino / evento (opcional)</span>
                  <input
                    value={redeployNote}
                    onChange={e => setRedeployNote(e.target.value)}
                    placeholder="Ej. Evento Obj. B · convocable"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
                  />
                </label>
              )}

              <label className="block">
                <span className="text-[10px] font-black text-slate-500 uppercase">Puesto a recomponer</span>
                <input
                  value={gapPos}
                  onChange={e => setGapPos(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border-2 border-violet-200 bg-violet-50/50 p-3 space-y-2">
                  <div className="flex items-center gap-1 text-[10px] font-black text-violet-800 uppercase">
                    <Clock size={12} /> Extensión (+)
                  </div>
                  {bandNeighbors && (
                    <p className="text-[9px] font-bold text-violet-700/80 leading-tight">
                      Turno {bandNeighbors.extensionBand} (banda anterior) · otros puestos
                    </p>
                  )}
                  <select
                    value={extEmpId}
                    onChange={e => {
                      setExtEmpId(e.target.value);
                      if (e.target.value === adelEmpId) setAdelEmpId('');
                    }}
                    className="w-full text-[11px] font-bold border border-violet-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    <option value="">Guardia en {bandNeighbors?.extensionBand || '…'}…</option>
                    {extCandidates.map(c => (
                      <option key={c.id} value={c.id}>{c.name} · {c.positionName} · {c.code}</option>
                    ))}
                  </select>
                  {extCandidates.length === 0 && (
                    <p className="text-[9px] text-rose-600 font-bold">Sin guardias en turno {bandNeighbors?.extensionBand} este día.</p>
                  )}
                  <div className="flex gap-1">
                    <input value={extFrom} onChange={e => setExtFrom(e.target.value)} className="w-1/2 text-[10px] font-bold border rounded px-1 py-1" />
                    <input value={extTo} onChange={e => setExtTo(e.target.value)} className="w-1/2 text-[10px] font-bold border rounded px-1 py-1" />
                  </div>
                </div>

                <div className="rounded-xl border-2 border-cyan-200 bg-cyan-50/50 p-3 space-y-2">
                  <div className="flex items-center gap-1 text-[10px] font-black text-cyan-800 uppercase">
                    <Clock size={12} /> Adelanto (+)
                  </div>
                  {bandNeighbors && (
                    <p className="text-[9px] font-bold text-cyan-700/80 leading-tight">
                      Turno {bandNeighbors.earlyStartBand} (banda siguiente) · otros puestos
                    </p>
                  )}
                  <select
                    value={adelEmpId}
                    onChange={e => setAdelEmpId(e.target.value)}
                    className="w-full text-[11px] font-bold border border-cyan-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    <option value="">Guardia en {bandNeighbors?.earlyStartBand || '…'}…</option>
                    {adelCandidates.map(c => (
                      <option key={c.id} value={c.id}>{c.name} · {c.positionName} · {c.code}</option>
                    ))}
                  </select>
                  {adelCandidates.length === 0 && (
                    <p className="text-[9px] text-rose-600 font-bold">Sin guardias en turno {bandNeighbors?.earlyStartBand} este día.</p>
                  )}
                  <div className="flex gap-1">
                    <input value={adelFrom} onChange={e => setAdelFrom(e.target.value)} className="w-1/2 text-[10px] font-bold border rounded px-1 py-1" />
                    <input value={adelTo} onChange={e => setAdelTo(e.target.value)} className="w-1/2 text-[10px] font-bold border rounded px-1 py-1" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[10px] font-bold text-indigo-900 leading-relaxed">
                <Split size={12} className="inline mr-1" />
                Preview: {gapPos} · {extFrom}–{extTo} (ext) + {adelFrom}–{adelTo} (adel)
                {mode === 'liberation' && ' · titular pasa a RET'}
              </div>

              {error && (
                <p className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          {step > 1 && (
            <button type="button" onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50">
              Volver
            </button>
          )}
          {step >= 2 && (
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 flex items-center justify-center gap-1"
            >
              <CheckCircle size={14} /> Aplicar paquete
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-500">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
