import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { functions } from '@/lib/firebase';

export type GuardDeviceRequestRow = {
  uid: string;
  employeeId: string | null;
  employeeName: string;
  fileNumber: string;
  empresaId: string | null;
  platform: string | null;
  requestedDeviceId: string | null;
  previousDeviceId: string | null;
  deviceInfo?: Record<string, string>;
  createdAt?: { seconds?: number };
};

function formatCreatedAt(createdAt?: { seconds?: number }): string {
  if (!createdAt?.seconds) return '—';
  try {
    return new Date(createdAt.seconds * 1000).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

type PanelProps = {
  empresaId: string | null | undefined;
  compact?: boolean;
  className?: string;
};

export function GuardDeviceApprovalPanel({ empresaId, compact, className = '' }: PanelProps) {
  const [rows, setRows] = useState<GuardDeviceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingUid, setApprovingUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listFn = httpsCallable(functions, 'listPendingGuardDeviceRegistrations');
      const res = await listFn({ empresaId: empresaId || undefined, limit: 50 });
      const data = res.data as { requests?: GuardDeviceRequestRow[] };
      setRows(Array.isArray(data?.requests) ? data.requests : []);
    } catch (err) {
      console.error('[GuardDeviceApproval]', err);
      toast.error('No se pudieron cargar solicitudes de dispositivo.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (row: GuardDeviceRequestRow) => {
    if (!row.uid) return;
    if (
      !confirm(
        `¿Aprobar el nuevo dispositivo (${row.platform || 'web'}) para ${row.employeeName || row.employeeId || row.uid}?\n\nEl dispositivo anterior dejará de poder usar el portal.`,
      )
    ) {
      return;
    }
    setApprovingUid(row.uid);
    try {
      const approveFn = httpsCallable(functions, 'approveGuardDeviceRegistration');
      await approveFn({ targetUid: row.uid, employeeId: row.employeeId || undefined });
      toast.success('Dispositivo aprobado.');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al aprobar';
      toast.error(msg);
    } finally {
      setApprovingUid(null);
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className={`flex items-center justify-center gap-2 py-8 text-slate-500 ${className}`}>
        <Loader2 size={18} className="animate-spin text-indigo-600" />
        <span className="text-sm font-semibold">Cargando dispositivos pendientes…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-900/40 px-4 py-6 text-center ${className}`}>
        <Smartphone size={28} className="mx-auto text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Sin solicitudes de dispositivo pendientes</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-black text-indigo-600 hover:text-indigo-800"
        >
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
          {rows.length} solicitud{rows.length !== 1 ? 'es' : ''} pendiente{rows.length !== 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold text-slate-600"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>
      <div className={`grid gap-3 ${compact ? '' : 'md:grid-cols-2'}`}>
        {rows.map((row) => (
          <div
            key={row.uid}
            className="rounded-2xl border border-indigo-100 bg-white dark:bg-slate-800 shadow-sm p-4 flex flex-col gap-3"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                <Smartphone size={18} className="text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900 dark:text-white truncate">
                  {row.employeeName || 'Guardia'}
                </p>
                <p className="text-[10px] font-mono text-slate-500">
                  Legajo {row.fileNumber || '—'} · {String(row.platform || 'web').toUpperCase()}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Solicitud {formatCreatedAt(row.createdAt)}</p>
              </div>
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-300 space-y-1 font-mono break-all">
              <p>
                <span className="font-bold text-slate-500">Nuevo:</span> {row.requestedDeviceId || '—'}
              </p>
              {row.previousDeviceId ? (
                <p>
                  <span className="font-bold text-slate-500">Anterior:</span> {row.previousDeviceId}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={approvingUid === row.uid}
              onClick={() => void approve(row)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black flex items-center justify-center gap-2 shadow-sm"
            >
              {approvingUid === row.uid ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              Aprobar dispositivo
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Campana compacta para CC / RRHH header */
export function GuardDeviceApprovalBell({ empresaId }: { empresaId: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const listFn = httpsCallable(functions, 'listPendingGuardDeviceRegistrations');
      const res = await listFn({ empresaId: empresaId || undefined, limit: 50 });
      const data = res.data as { requests?: unknown[] };
      setCount(Array.isArray(data?.requests) ? data.requests.length : 0);
    } catch {
      setCount(0);
    }
  }, [empresaId]);

  useEffect(() => {
    void refreshCount();
    const t = window.setInterval(() => void refreshCount(), 60_000);
    return () => window.clearInterval(t);
  }, [refreshCount]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refreshCount();
        }}
        title="Dispositivos guardia pendientes de aprobación"
        className={`relative p-2 rounded-xl transition-colors ${
          count > 0
            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300'
            : 'bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <Smartphone size={17} className={count > 0 ? 'animate-pulse' : ''} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-indigo-600 text-white text-[8px] font-black rounded-full flex items-center justify-center">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[3000] w-[min(24rem,calc(100vw-2rem))] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3 animate-in slide-in-from-top-2">
          <p className="text-xs font-black text-slate-800 dark:text-white mb-2 flex items-center gap-2">
            <Smartphone size={14} className="text-indigo-600" />
            Dispositivos pendientes
          </p>
          <GuardDeviceApprovalPanel
            empresaId={empresaId}
            compact
            className="max-h-[min(24rem,60vh)] overflow-y-auto"
          />
        </div>
      )}
    </div>
  );
}
