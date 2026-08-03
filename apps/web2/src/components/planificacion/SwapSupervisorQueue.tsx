import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { db, functions } from '@/lib/firebase';
import { SupervisorPinInput } from '@/components/ui/SupervisorPinInput';

type SwapRow = {
  id: string;
  requesterName?: string;
  targetName?: string;
  requesterShiftDate?: string;
  targetShiftDate?: string;
  objectiveName?: string;
  status?: string;
};

export function SwapSupervisorQueue({ empresaId }: { empresaId?: string | null }) {
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [pin, setPin] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'swap_requests'), where('status', '==', 'PENDING_SUPERVISOR'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as SwapRow[];
        if (empresaId) {
          list = list.filter((r) => (r as { empresaId?: string }).empresaId === empresaId);
        }
        setRows(list);
      },
      (err) => {
        console.error(err);
        toast.error('No se pudieron cargar permutas pendientes');
      },
    );
    return () => unsub();
  }, [empresaId]);

  const approve = async (requestId: string) => {
    setBusyId(requestId);
    try {
      const callable = httpsCallable(functions, 'approveSwapRequest');
      await callable({ requestId, supervisorPin: pin.length === 4 ? pin : undefined });
      toast.success('Permuta autorizada. Turnos actualizados.');
      setPin('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo autorizar';
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (requestId: string) => {
    setBusyId(requestId);
    try {
      const callable = httpsCallable(functions, 'rejectSwapRequestSupervisor');
      await callable({ requestId });
      toast.success('Permuta rechazada');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo rechazar';
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wide text-amber-800 mb-2">
        Permutas pendientes de supervisor ({rows.length})
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="min-w-[140px]">
          <p className="text-[10px] font-bold text-amber-900 mb-1">PIN supervisor (opcional)</p>
          <SupervisorPinInput value={pin} onChange={setPin} />
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm"
          >
            <div>
              <span className="font-bold text-slate-800">
                {r.requesterName || '—'} ⇄ {r.targetName || '—'}
              </span>
              <span className="text-slate-500 text-xs ml-2">
                {r.requesterShiftDate || '—'} / {r.targetShiftDate || '—'}
              </span>
              {r.objectiveName ? (
                <span className="text-indigo-600 text-xs ml-2">{r.objectiveName}</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => approve(r.id)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
              >
                Autorizar
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => reject(r.id)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
