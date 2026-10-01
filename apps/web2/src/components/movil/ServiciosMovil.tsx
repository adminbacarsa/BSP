import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ServiceSLA } from '@/services/slaService';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { ServiciosMovilScreens, type ServiciosFiltroEstado } from '@/components/movil/ServiciosMovilScreens';
import { MOVIL_BTN_PRIMARY, MOVIL_PRIMARY_BG } from '@/components/movil/ui/tones';
import { useEmpresa } from '@/context/EmpresaContext';
import { clientHasOpenCommercialContract } from '@/lib/crm/slaBilling';
import { isObjectivePlanificacionPublished, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { movilCallableGate, runCallableOnline } from '@/lib/movil/callableOnline';
import { movilWriteQueue } from '@/lib/movil/writeQueue';
import {
  ejecutarAgregarMeses,
  finAgregandoMeses,
  proponerAgregarMeses,
  vistaPreviaAgregarMeses,
  type SlaRow,
} from '@/lib/servicios/appendMonthsClient';
import { cerrarContratoSla, reabrirContratoSla } from '@/lib/servicios/contratoCierreClient';
import { REOPEN_MOTIVO_MSG, reopenMotivoError } from '@/lib/servicios/newSlaDraft';
import { formatDmy } from '@/lib/servicios/slaMonthSplit';
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
  /** Permiso `SERVICES.update` (mismo que el botón «Agregar meses» del escritorio). */
  canUpdate?: boolean;
  /** Mismo patch que aplica el escritorio tras cerrar/reabrir/extender. */
  onSlaPatched: (slaId: string, patch: Partial<ServiceSLA> & Record<string, unknown>) => void;
  /** Docs nuevos creados por «Agregar meses» (individuales). */
  onSlaCreated?: (rows: Array<ServiceSLA & { id: string }>) => void;
}

const MESES_OPCIONES = [1, 2, 3] as const;

/** Servicios en el celular: lista por objetivo, detalle simple, cerrar/reabrir y agregar meses con la misma lógica del escritorio. */
export function ServiciosMovil(props: Props) {
  const online = useOnlineFlag();
  const empresaSheet = useEmpresaSheet();
  const { empresaId, empresa } = useEmpresa();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<ServiciosFiltroEstado>('');
  const [pending, setPending] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState('');
  const [mesesOpen, setMesesOpen] = useState(false);
  const [meses, setMeses] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [clientHasOpenContract, setClientHasOpenContract] = useState<boolean | undefined>(undefined);
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;

  useEffect(() => {
    const alInicio = () => setSelectedId(null);
    window.addEventListener('cosp-modulo-inicio', alInicio);
    return () => window.removeEventListener('cosp-modulo-inicio', alInicio);
  }, []);

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
  const slaRows = useMemo(() => props.services.filter((s): s is SlaRow => !!s.id), [props.services]);

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
  const propuesta = sla?.id ? proponerAgregarMeses(slaRows, sla as SlaRow) : null;
  const puedeAgregar = !!propuesta && !propuesta.error && (props.isSuperAdmin || props.canUpdate === true);
  const acciones = sla ? { ...serviciosMovilAcciones(sla, props.isSuperAdmin), agregarMeses: puedeAgregar } : { cerrar: false, reabrir: false, agregarMeses: false };
  const reopenError = reopenMotivoError(reopenMotivo);
  const newEndDate = propuesta ? finAgregandoMeses(String(propuesta.last.endDate || ''), meses) : '';
  const vistaPrevia = propuesta && newEndDate
    ? vistaPreviaAgregarMeses({ services: slaRows, last: propuesta.last, mode: propuesta.mode, newEndDate })
    : null;

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

  const handleAgregarMeses = async () => {
    if (!propuesta || !vistaPrevia || vistaPrevia.error || busy || !empresaId) return;
    setBusy(true);
    try {
      const resultado = await runCallableOnline('Agregar meses', () => ejecutarAgregarMeses({
        services: slaRows,
        last: propuesta.last,
        plan: vistaPrevia.plan,
        newEndDate,
        empresaId,
        migracionCompleta,
        scopeEmpresa: shouldScopeQueriesToEmpresa(empresaId, migracionCompleta),
      }));
      for (const { id, patch } of resultado.patches) props.onSlaPatched(id, patch);
      if (resultado.created.length) props.onSlaCreated?.(resultado.created);
      setMesesOpen(false);
      setMeses(1);
      toast.success(resultado.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron agregar los meses');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ServiciosMovilScreens
        empresa={props.empresa}
        onEmpresa={empresaSheet.onEmpresa}
        online={online}
        pendingLabel={pending}
        loading={props.loading}
        rows={rows}
        row={row}
        detalle={detalle}
        acciones={acciones}
        filter={filter}
        onFilter={setFilter}
        estadoFiltro={estadoFiltro}
        onEstadoFiltro={setEstadoFiltro}
        onOpen={setSelectedId}
        onBack={() => setSelectedId(null)}
        onCerrar={() => { void handleCerrar(); }}
        onReabrir={() => { setReopenMotivo(''); setReopenOpen(true); }}
        onAgregarMeses={() => { setMeses(1); setMesesOpen(true); }}
      />
      <BottomSheet open={reopenOpen} title="Reabrir contrato" onClose={() => { setReopenOpen(false); setReopenMotivo(''); }}>
        <p className="mb-2 text-[12px] text-slate-500">El motivo queda auditado.</p>
        <textarea
          value={reopenMotivo}
          onChange={(event) => setReopenMotivo(event.target.value)}
          rows={3}
          placeholder="Motivo de la reapertura"
          className="w-full rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-800 outline-none focus:border-[var(--movil-primary,#111827)]"
        />
        {reopenError && <p className="mt-2 text-[12px] font-medium text-amber-600">{reopenError}</p>}
        <button
          type="button"
          disabled={!!reopenError || busy}
          onClick={() => { void handleReabrir(); }}
          className={`mt-3 min-h-12 w-full rounded-lg text-sm font-semibold disabled:opacity-40 ${MOVIL_BTN_PRIMARY}`}
        >
          {busy ? 'Reabriendo…' : 'Reabrir'}
        </button>
      </BottomSheet>
      <BottomSheet open={mesesOpen && !!propuesta} title="Agregar meses" onClose={() => setMesesOpen(false)}>
        {propuesta && (
          <div data-servicios-meses={propuesta.mode}>
            <p className="text-[13px] text-slate-700">
              Último vigente hasta <b className="font-semibold">{formatDmy(String(propuesta.last.endDate || ''))}</b> · {propuesta.mode === 'agrupados' ? 'se extiende el mismo servicio' : 'un servicio por mes, misma estructura'}.
            </p>
            <div className="mt-3 flex gap-1.5">
              {MESES_OPCIONES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={meses === n}
                  onClick={() => setMeses(n)}
                  className={`min-h-10 flex-1 rounded-md border text-[13px] font-medium ${meses === n ? `border-transparent ${MOVIL_PRIMARY_BG}` : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  +{n} {n === 1 ? 'mes' : 'meses'}
                </button>
              ))}
            </div>
            {vistaPrevia && !vistaPrevia.error && (
              <div className="mt-3 rounded-lg border border-[#eceef1] bg-white p-3 text-[13px] text-slate-700">
                <p className="font-semibold text-slate-900">{vistaPrevia.plan.summary}</p>
                <ul className="mt-1 space-y-0.5 tabular-nums">
                  {vistaPrevia.lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
            {vistaPrevia?.error && <p className="mt-3 text-[12px] font-medium text-amber-600">{vistaPrevia.error}</p>}
            <button
              type="button"
              disabled={busy || !vistaPrevia || !!vistaPrevia.error}
              onClick={() => { void handleAgregarMeses(); }}
              className={`mt-3 min-h-12 w-full rounded-lg text-sm font-semibold disabled:opacity-40 ${MOVIL_BTN_PRIMARY}`}
            >
              {busy ? 'Guardando…' : online ? 'Confirmar' : 'Agregar meses requiere conexión'}
            </button>
          </div>
        )}
      </BottomSheet>
      {empresaSheet.sheet}
      <MovilBottomNav />
    </>
  );
}
