import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ServiceSLA } from '@/services/slaService';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { ServiciosMovilScreens } from '@/components/movil/ServiciosMovilScreens';
import { clientHasOpenCommercialContract } from '@/lib/crm/slaBilling';
import { isObjectivePlanificacionPublished } from '@/lib/multiempresa';
import { movilCallableGate, runCallableOnline } from '@/lib/movil/callableOnline';
import { movilWriteQueue } from '@/lib/movil/writeQueue';
import { cerrarContratoSla, reabrirContratoSla } from '@/lib/servicios/contratoCierreClient';
import { REOPEN_MOTIVO_MSG, reopenMotivoError } from '@/lib/servicios/newSlaDraft';
import {
  buildServiciosMovilRows,
  serviciosMovilAcciones,
  slaMovilDetalle,
  type ServicioMovilClient,
} from '@/lib/servicios/serviciosMovil';

interface Props {
  empresa: string;
  loading: boolean;
  services: ServiceSLA[];
  clients: ServicioMovilClient[];
  publishStatusMap: Record<string, boolean>;
  isSuperAdmin: boolean;
  /** Mismo patch que aplica el escritorio tras cerrar/reabrir. */
  onSlaPatched: (slaId: string, patch: Partial<ServiceSLA> & Record<string, unknown>) => void;
}

/** Servicios en el celular: lista por objetivo, detalle simple y cerrar/reabrir con las callables del escritorio. */
export function ServiciosMovil(props: Props) {
  const online = useOnlineFlag();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientHasOpenContract, setClientHasOpenContract] = useState<boolean | undefined>(undefined);

  useEffect(() => movilWriteQueue.subscribe(() => {
    const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
    setPending(labels[0] || null);
  }), []);

  const rows = useMemo(
    () => buildServiciosMovilRows({
      services: props.services,
      clients: props.clients,
      hasPublishedPlan: (objectiveId, year, month) => isObjectivePlanificacionPublished(props.publishStatusMap, objectiveId, year, month),
    }),
    [props.services, props.clients, props.publishStatusMap],
  );
  const row = rows.find((item) => item.objectiveId === selectedId) || null;
  const sla = row?.sla || null;

  // Misma consulta que el formulario del escritorio para rotular «Auto: …».
  useEffect(() => {
    const clientId = sla?.clientId;
    if (!clientId) {
      setClientHasOpenContract(undefined);
      return;
    }
    let cancelled = false;
    setClientHasOpenContract(undefined);
    void getDocs(query(collection(db, 'contracts'), where('clientId', '==', clientId)))
      .then((snap) => {
        if (!cancelled) setClientHasOpenContract(clientHasOpenCommercialContract(snap.docs.map((d) => d.data())));
      })
      .catch(() => {
        if (!cancelled) setClientHasOpenContract(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sla?.clientId]);

  const detalle = sla ? slaMovilDetalle(sla, { clientHasOpenContract: clientHasOpenContract === true }) : null;
  const acciones = sla ? serviciosMovilAcciones(sla, props.isSuperAdmin) : { cerrar: false, reabrir: false };
  const reopenError = reopenMotivoError(reopenMotivo);

  const handleCerrar = async () => {
    if (!sla?.id || busy) return;
    if (!window.confirm('¿Cerrar este contrato? Queda sin edición y su planificación bloqueada.')) return;
    setBusy(true);
    try {
      await runCallableOnline('Cerrar contrato', () => cerrarContratoSla(sla.id!));
      props.onSlaPatched(sla.id, { closed: true, reopenedManually: false, closedReason: 'MANUAL' });
      toast.success('Contrato cerrado');
    } catch (error) {
      toast.error('No se pudo cerrar: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  const handleReabrir = async () => {
    if (!sla?.id || reopenError || busy) return;
    setBusy(true);
    try {
      const motivo = await runCallableOnline('Reabrir contrato', () => reabrirContratoSla(sla.id!, reopenMotivo));
      props.onSlaPatched(sla.id, { closed: false, reopenedManually: true, reopenReason: motivo });
      setReopenOpen(false);
      setReopenMotivo('');
      toast.success('Contrato reabierto');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(msg.includes('Escribí') ? REOPEN_MOTIVO_MSG : msg.includes('conexión') ? msg : 'No se pudo reabrir el contrato');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ServiciosMovilScreens
        empresa={props.empresa}
        online={online}
        pendingLabel={pending}
        loading={props.loading}
        rows={rows}
        row={row}
        detalle={detalle}
        acciones={acciones}
        filter={filter}
        onFilter={setFilter}
        onOpen={setSelectedId}
        onBack={() => setSelectedId(null)}
        onCerrar={() => { void handleCerrar(); }}
        onReabrir={() => { setReopenMotivo(''); setReopenOpen(true); }}
      />
      <BottomSheet open={reopenOpen} title="Reabrir contrato" onClose={() => { setReopenOpen(false); setReopenMotivo(''); }}>
        <p className="mb-2 text-[11px] font-bold text-slate-500">El motivo queda auditado.</p>
        <textarea
          value={reopenMotivo}
          onChange={(event) => setReopenMotivo(event.target.value)}
          rows={3}
          placeholder="Motivo de la reapertura"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
        />
        {reopenError && <p className="mt-2 text-[11px] font-bold text-amber-700">{reopenError}</p>}
        <button
          type="button"
          disabled={!!reopenError || busy}
          onClick={() => { void handleReabrir(); }}
          className="mt-3 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white shadow-lg disabled:opacity-40"
        >
          {busy ? 'Reabriendo…' : 'Reabrir'}
        </button>
      </BottomSheet>
      <MovilBottomNav />
    </>
  );
}
