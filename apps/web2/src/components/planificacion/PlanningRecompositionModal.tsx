import React, { useMemo, useState } from 'react';
import { X, User, Clock, Split, Unlock, AlertTriangle, CheckCircle, FileText, Bell } from 'lucide-react';
import { RRHH_ABSENCE_LABEL_TO_CODE } from '@/lib/planificacion/absenceCodes';
import type {
  AnticipatedAbsenceDecl,
  PendingAbsenceNovedad,
  RecompositionMode,
  RecompositionPackage,
  RecompositionTarget,
} from '@/lib/planificacion/planningRecomposition.types';
import {
  buildRecompositionPendingUpdates,
  collectSplitFrancoConflicts,
  defaultSplitForBand,
  listEarlyStartCandidates,
  listExtensionCandidates,
  listRecompositionTargets,
  neighborBandsForTarget,
  resolveRecompositionTargetForEmployee,
  type FrancoCoverageConflict,
} from '@/lib/planificacion/planningRecompositionApply';

const RRHH_TYPE_OPTIONS = [
  'Enfermedad',
  'Vacaciones',
  'ART',
  'Licencia Esp.',
  'PG Permiso Gremial',
  'Injustificada',
] as const;

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
  preselectedEmployeeName?: string;
  onApply: (
    updates: Record<string, any>,
    pkg: RecompositionPackage,
    novedad?: PendingAbsenceNovedad,
  ) => void;
  onRequestSupervisorAuth?: (
    conflicts: FrancoCoverageConflict[],
    onAuthorized: () => void,
  ) => void;
  onClose: () => void;
};

function initSplitForTarget(t: RecompositionTarget) {
  const split = defaultSplitForBand(t.code);
  return {
    gapPos: t.positionName,
    extFrom: split.ext.from,
    extTo: split.ext.to,
    adelFrom: split.adel.from,
    adelTo: split.adel.to,
  };
}

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
  preselectedEmployeeName,
  onApply,
  onRequestSupervisorAuth,
  onClose,
}: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<RecompositionMode>('anticipated_absence');
  const [targetId, setTargetId] = useState<string>(preselectedEmpId || '');
  const [extEmpId, setExtEmpId] = useState('');
  const [adelEmpId, setAdelEmpId] = useState('');
  const [gapPos, setGapPos] = useState('');
  const [extFrom, setExtFrom] = useState('15:00');
  const [extTo, setExtTo] = useState('19:00');
  const [adelFrom, setAdelFrom] = useState('19:00');
  const [adelTo, setAdelTo] = useState('23:00');
  const [redeployNote, setRedeployNote] = useState('');
  const [rrhhType, setRrhhType] = useState<string>('Enfermedad');
  const [rrhhReason, setRrhhReason] = useState('');
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

  const preselectedTarget = useMemo(
    () => (preselectedEmpId
      ? resolveRecompositionTargetForEmployee(
        preselectedEmpId,
        dateStr,
        objectiveId,
        employees,
        shiftsMap,
        pendingChanges,
        absencesMap,
      )
      : null),
    [preselectedEmpId, dateStr, objectiveId, employees, shiftsMap, pendingChanges, absencesMap],
  );

  const visibleTargets = useMemo(() => {
    if (mode === 'anticipated_absence' || mode === 'liberation') {
      const working = targets.filter(t => t.kind === 'working');
      if (!preselectedEmpId) return working;
      return working.filter(t => t.employeeId === preselectedEmpId);
    }
    const byMode = targets.filter(t => t.kind === 'absence');
    if (!preselectedEmpId) return byMode;
    return byMode.filter(t => t.employeeId === preselectedEmpId);
  }, [targets, mode, preselectedEmpId]);

  const selectedTarget: RecompositionTarget | undefined = targets.find(t => t.employeeId === targetId)
    || (preselectedTarget?.kind === 'working' && (mode === 'anticipated_absence' || mode === 'liberation') ? preselectedTarget : undefined)
    || (preselectedTarget?.kind === 'absence' && mode === 'absence' ? preselectedTarget : undefined);

  const canContinuePreselected = !!(
    preselectedTarget
    && visibleTargets.some(t => t.employeeId === preselectedTarget.employeeId)
  );

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

  const splitFrancoPreview = useMemo(() => {
    if (!extEmpId || !adelEmpId) return [];
    return collectSplitFrancoConflicts(dateStr, extEmpId, adelEmpId, employeesById, shiftsMap, pendingChanges);
  }, [dateStr, extEmpId, adelEmpId, employeesById, shiftsMap, pendingChanges]);

  const goToCoverageStep = (t: RecompositionTarget, nextMode: RecompositionMode) => {
    setTargetId(t.employeeId);
    setMode(nextMode);
    const split = initSplitForTarget(t);
    setGapPos(split.gapPos);
    setExtFrom(split.extFrom);
    setExtTo(split.extTo);
    setAdelFrom(split.adelFrom);
    setAdelTo(split.adelTo);
    setExtEmpId('');
    setAdelEmpId('');
    setError('');
    setStep(2);
  };

  const pickTarget = (t: RecompositionTarget) => {
    const nextMode: RecompositionMode = mode === 'liberation'
      ? 'liberation'
      : mode === 'absence'
        ? 'absence'
        : 'anticipated_absence';
    goToCoverageStep(t, nextMode);
  };

  const continuePreselected = () => {
    if (!preselectedTarget || !canContinuePreselected) return;
    goToCoverageStep(preselectedTarget, mode);
  };

  const applyPackage = (authorizeFrancoTrabajado: boolean) => {
    if (!selectedTarget || !extEmpId || !adelEmpId) return;

    let anticipatedAbsence: AnticipatedAbsenceDecl | undefined;
    let novedad: PendingAbsenceNovedad | undefined;

    if (mode === 'anticipated_absence') {
      const code = RRHH_ABSENCE_LABEL_TO_CODE[rrhhType] || 'AA';
      anticipatedAbsence = { type: rrhhType, code, reason: rrhhReason.trim() };
      const empName = employeesById[selectedTarget.employeeId]?.name || preselectedEmployeeName || selectedTarget.employeeId;
      novedad = {
        employeeId: selectedTarget.employeeId,
        employeeName: empName,
        startDate: dateStr,
        endDate: dateStr,
        type: rrhhType,
        reason: rrhhReason.trim(),
        status: 'APPROVED',
      };
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
      anticipatedAbsence,
    };

    const updates = buildRecompositionPendingUpdates(pkg, {
      shiftsMap,
      pendingChanges,
      employeesById,
      objectiveId,
      clientId,
      authorizeFrancoTrabajado,
    });
    onApply(updates, pkg, novedad);
    onClose();
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

    const francoConflicts = collectSplitFrancoConflicts(
      dateStr,
      extEmpId,
      adelEmpId,
      employeesById,
      shiftsMap,
      pendingChanges,
    );

    const tryApply = (authorizeFranco: boolean) => {
      try {
        applyPackage(authorizeFranco);
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (msg.startsWith('FRANCO_COVERAGE:')) {
          setError('Guardia en franco planificado — requiere PIN de supervisor o elegí RET/ESC/libre.');
        } else {
          setError(msg || 'Error al armar el paquete');
        }
      }
    };

    if (francoConflicts.length > 0) {
      if (onRequestSupervisorAuth) {
        onRequestSupervisorAuth(francoConflicts, () => tryApply(true));
        return;
      }
      setError('Los guardias seleccionados tienen franco planificado (FT). Preferí RET/ESC o guardias en servicio.');
      return;
    }

    tryApply(false);
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
              {preselectedEmpId && preselectedEmployeeName && (
                <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2 text-[10px] font-bold text-indigo-800 flex items-center gap-2">
                  <User size={14} className="shrink-0" />
                  <span>Guardia del panel: <strong>{preselectedEmployeeName}</strong></span>
                </div>
              )}
              <p className="text-xs font-bold text-slate-600">¿Qué querés hacer?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setMode('anticipated_absence')}
                  className={`p-3 rounded-xl border-2 text-left transition-colors ${mode === 'anticipated_absence' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <Bell size={16} className="text-amber-600 mb-1" />
                  <div className="text-[11px] font-black text-slate-800">Ausencia anticipada</div>
                  <div className="text-[9px] text-slate-500 leading-snug">Aviso de falta · RRHH + cobertura</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('absence')}
                  className={`p-3 rounded-xl border-2 text-left transition-colors ${mode === 'absence' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <AlertTriangle size={16} className="text-indigo-600 mb-1" />
                  <div className="text-[11px] font-black text-slate-800">Cubrir ausencia</div>
                  <div className="text-[9px] text-slate-500">Ya cargada V/L/E/A</div>
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

              <p className="text-[10px] font-black text-slate-500 uppercase">
                {preselectedEmpId ? 'Confirmá el turno a recomponer' : 'Seleccioná turno / guardia'}
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {visibleTargets.map(t => (
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
                {visibleTargets.length === 0 && (
                  <p className="text-[10px] text-slate-500 py-4 text-center leading-relaxed px-2">
                    {preselectedEmpId && preselectedEmployeeName
                      ? (mode === 'anticipated_absence'
                        ? `${preselectedEmployeeName} no tiene turno laboral (M/T/N…) este día. Asigná banda primero o usá Cubrir ausencia si ya tiene código RRHH.`
                        : mode === 'absence'
                          ? `${preselectedEmployeeName} no tiene ausencia V/L/E/A/AA/PG este día. Usá Ausencia anticipada si avisaron la falta con turno asignado.`
                          : `${preselectedEmployeeName} no tiene turno laboral para liberar a RET.`)
                      : (mode === 'anticipated_absence'
                        ? 'No hay guardias con turno M/T/N… este día. Elegí otro modo o asigná banda en la grilla.'
                        : mode === 'absence'
                          ? 'No hay ausencias cargadas este día. Usá Ausencia anticipada si avisaron la falta.'
                          : 'No hay guardias con turno laboral este día.')}
                  </p>
                )}
              </div>
            </>
          )}

          {step >= 2 && selectedTarget && (
            <>
              {preselectedTarget?.kind === 'working' && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('anticipated_absence')}
                    className={`text-[9px] font-black px-2.5 py-1 rounded-lg border ${mode === 'anticipated_absence' ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    Ausencia anticipada
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('liberation')}
                    className={`text-[9px] font-black px-2.5 py-1 rounded-lg border ${mode === 'liberation' ? 'bg-violet-100 border-violet-300 text-violet-900' : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    Liberar → RET
                  </button>
                </div>
              )}

              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600">
                {mode === 'liberation' ? (
                  <><Unlock size={12} className="inline mr-1 text-violet-600" />{selectedTarget.label} → <strong>RET</strong></>
                ) : mode === 'anticipated_absence' ? (
                  <><Bell size={12} className="inline mr-1 text-amber-600" />Ausencia anticipada: {selectedTarget.label}</>
                ) : (
                  <><AlertTriangle size={12} className="inline mr-1 text-indigo-600" />Cubre: {selectedTarget.label}</>
                )}
              </div>

              {mode === 'anticipated_absence' && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-[10px] font-black text-amber-900 uppercase">
                    <FileText size={12} /> Declarar novedad RRHH
                  </div>
                  <p className="text-[9px] font-bold text-amber-800/90 leading-snug">
                    Se registra la ausencia para RRHH al guardar la planificación. Después armás la cobertura split abajo.
                  </p>
                  <label className="block">
                    <span className="text-[10px] font-black text-slate-500 uppercase">Tipo de novedad</span>
                    <select
                      value={rrhhType}
                      onChange={e => setRrhhType(e.target.value)}
                      className="mt-1 w-full border border-amber-200 rounded-lg px-3 py-2 text-xs font-bold bg-white"
                    >
                      {RRHH_TYPE_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black text-slate-500 uppercase">Motivo / detalle</span>
                    <textarea
                      value={rrhhReason}
                      onChange={e => setRrhhReason(e.target.value)}
                      placeholder="Ej. Avisó por teléfono que no puede presentarse…"
                      className="mt-1 w-full border border-amber-200 rounded-lg px-3 py-2 text-xs font-bold bg-white h-16 resize-none"
                    />
                  </label>
                </div>
              )}

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
                {mode === 'anticipated_absence' && ` · titular pasa a ${RRHH_ABSENCE_LABEL_TO_CODE[rrhhType] || 'AA'} (RRHH)`}
              </div>

              {splitFrancoPreview.length > 0 && (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900">
                  <AlertTriangle size={12} className="inline mr-1 text-amber-700" />
                  Guardia en <strong>franco planificado</strong> — costo FT. Al confirmar se pedirá PIN de supervisor.
                  Preferí guardias en servicio o RET/ESC de otro puesto.
                </div>
              )}

              {error && (
                <p className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50"
            >
              Volver
            </button>
          )}
          {step >= 2 && (
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 flex items-center justify-center gap-1"
            >
              <CheckCircle size={14} />
              {mode === 'anticipated_absence' ? 'Declarar ausencia y cobertura' : mode === 'liberation' ? 'Liberar a RET y cobertura' : 'Aplicar paquete'}
            </button>
          )}
          {step === 1 && canContinuePreselected && (
            <button
              type="button"
              onClick={continuePreselected}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700"
            >
              Continuar
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={onClose} className={`py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-500 ${canContinuePreselected ? 'px-4' : 'flex-1'}`}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
