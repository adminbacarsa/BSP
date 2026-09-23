import React, { useMemo, useState } from 'react';
import { AlertTriangle, MapPin, Shield, X } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { toast } from 'sonner';
import {
  hoursRemainingUntilEnd,
  resolveEarlyWithdrawReplacePolicy,
} from '@/lib/operaciones/earlyWithdrawPolicy';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  shift: any;
  logic?: { processedData?: any[] };
  reemplazarRetiro2a3h?: boolean | null;
  onVacancyCreated?: (vacancy: any) => void;
};

export function EarlyWithdrawModal({
  isOpen,
  onClose,
  shift,
  logic,
  reemplazarRetiro2a3h = null,
  onVacancyCreated,
}: Props) {
  const [reason, setReason] = useState<'ENFERMEDAD' | 'ABANDONO' | 'FAMILIAR' | 'OPERATIVO'>('ENFERMEDAD');
  const [loading, setLoading] = useState(false);
  const [operatorReplace, setOperatorReplace] = useState<boolean | null>(null);

  const colleagues = useMemo(() => {
    if (!shift || !logic?.processedData) return [];
    return logic.processedData.filter(
      (s: any) =>
        s.objectiveId === shift.objectiveId
        && s.id !== shift.id
        && (s.isPresent || s.status === 'PRESENT')
        && !s.isCompleted,
    );
  }, [shift, logic]);

  const hoursLeft = useMemo(() => {
    if (!shift?.endDateObj) return 0;
    const end = shift.endDateObj instanceof Date ? shift.endDateObj.getTime() : new Date(shift.endDateObj).getTime();
    return hoursRemainingUntilEnd(Date.now(), end);
  }, [shift]);

  const policy = useMemo(
    () =>
      resolveEarlyWithdrawReplacePolicy({
        hoursLeft,
        colleaguesPresent: colleagues.length,
        reemplazarRetiro2a3h,
        isAutoMode: false,
        operatorReplaceChoice: operatorReplace,
      }),
    [hoursLeft, colleagues.length, reemplazarRetiro2a3h, operatorReplace],
  );

  if (!isOpen || !shift) return null;

  const isAlone = colleagues.length === 0;

  const runCallable = async (operatorReplaceChoice?: boolean | null) => {
    setLoading(true);
    try {
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'processEarlyWithdrawalCallable');
      const res = await fn({
        shiftId: shift.id,
        reason,
        operatorReplaceChoice: operatorReplaceChoice ?? null,
      });
      const data = res.data as any;
      if (data?.needsOperatorChoice) {
        toast.info('Definí si reemplazás al guardia (ventana 2–3 h).');
        return;
      }
      if (data?.remainderShiftId && onVacancyCreated) {
        onVacancyCreated({ id: data.remainderShiftId, isUnassigned: true, objectiveId: shift.objectiveId });
      }
      toast.success(
        data?.remainderShiftId
          ? 'Baja registrada — protocolo de cobertura iniciado.'
          : 'Baja registrada (sin reemplazo).',
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Error al procesar retiro anticipado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className={`p-4 text-white flex justify-between items-start ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-lg shrink-0">
              {(shift.employeeName || '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-black text-base leading-tight">{shift.employeeName}</p>
              <p className="text-xs font-semibold opacity-80 mt-0.5">Retiro anticipado · {hoursLeft.toFixed(1)} h restantes</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
          <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
            <MapPin size={9} /> {shift.objectiveName || '—'}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
            <Shield size={9} /> {shift.positionName || '—'}
          </span>
        </div>
        <div className="px-4 pb-5 space-y-4">
          <label className="text-xs font-bold text-slate-400 uppercase block">Motivo RRHH</label>
          <select
            className="w-full p-3 border rounded-xl text-sm font-bold text-slate-700"
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
          >
            <option value="ENFERMEDAD">Enfermedad (E parcial)</option>
            <option value="ABANDONO">Abandono (AA parcial + disciplinaria)</option>
            <option value="FAMILIAR">Emergencia familiar (A parcial)</option>
            <option value="OPERATIVO">Operativo (A parcial)</option>
          </select>

          {policy === 'OPERATOR_CHOICE' && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-2">
                <AlertTriangle size={14} /> Ventana 2–3 h: ¿reemplazar remanente?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOperatorReplace(true)}
                  className={`flex-1 py-2 rounded-lg text-xs font-black ${operatorReplace === true ? 'bg-indigo-600 text-white' : 'bg-white border'}`}
                >
                  Sí, cubrir
                </button>
                <button
                  type="button"
                  onClick={() => setOperatorReplace(false)}
                  className={`flex-1 py-2 rounded-lg text-xs font-black ${operatorReplace === false ? 'bg-slate-800 text-white' : 'bg-white border'}`}
                >
                  No reemplazar
                </button>
              </div>
            </div>
          )}

          <div className={`p-3 rounded-xl border ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <p className={`font-black text-sm ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}>
              {isAlone ? 'Guardia solo en objetivo' : `${colleagues.length} compañero(s) presente(s)`}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Política: {policy === 'NO_REPLACE' ? 'Sin reemplazo' : policy === 'OPERATOR_CHOICE' ? 'Elegí arriba' : 'Cobertura del remanente (applyCoverage / cascada)'}
            </p>
          </div>

          <button
            type="button"
            disabled={loading || (policy === 'OPERATOR_CHOICE' && operatorReplace === null)}
            onClick={() => runCallable(operatorReplace)}
            className="w-full py-3.5 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            {loading ? 'PROCESANDO…' : 'CONFIRMAR RETIRO ANTICIPADO'}
          </button>
        </div>
      </div>
    </div>
  );
}
