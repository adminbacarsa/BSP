import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { AmbitoSheetBody, OperacionScreens, useOnlineFlag, type GuardShift, type MovilObjective } from '@/components/movil/OperacionScreens';
import { COVERAGE_CASCADE_ORDER } from '@cosp/ops-core';
import { guardTone } from '@/lib/movil/guardTone';
import {
  FILTRO_VACIO,
  agruparPorObjetivo,
  alternarEstado,
  clientesParaFiltro,
  contadoresMovil,
  etiquetaAmbito,
  guardarFiltro,
  leerFiltroGuardado,
  mensajeVacio,
  turnosEnAmbito,
  turnosFiltrados,
  turnosVisiblesMovil,
  type OpsEstadoFiltro,
  type OpsFiltroMovil,
  type OpsShiftMovil,
} from '@/lib/movil/operacionFiltros';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import { movilCallableGate, runCallableOnline } from '@/lib/movil/callableOnline';

const STEP_LABEL: Record<string, string> = {
  RET: 'RET',
  REF: 'REF',
  ESC: 'ESC',
  EXTEND: 'Ext+Adel',
  ADVANCE: 'Ext+Adel',
  EVENTUAL: 'Eventuales',
  FT: 'FT',
};

interface Props {
  empresa: string;
  empresaId?: string;
  logic: {
    setViewTab: (tab: string) => void;
    handleAction: (action: string, shiftId: string, payload?: unknown) => Promise<unknown> | void;
  };
  notices?: string[];
  /** Supervisión: mismo Centro de Control sin acciones ni sala. */
  readOnly?: boolean;
  /** Turnos de hoy (`isOpsShiftHoy`) del monitor; acá se aplica el mismo corte del encabezado del escritorio. */
  shifts: OpsShiftMovil[];
  publishStatusMap: Record<string, boolean>;
  /** Catálogo de objetivos (clientId, clientName, id, name) para el selector. */
  catalogo?: ReadonlyArray<{ id?: unknown; clientId?: unknown; name?: unknown; clientName?: unknown }>;
  /** Instante de referencia (tests). */
  now?: number;
  modeLabel: string;
  isPilot: boolean;
  pilotName?: string;
  apoyo?: string;
  pendingPilotName?: string;
  onTomarMando: () => Promise<void>;
  onPasarAuto: () => Promise<void>;
  onRequestPilot: () => Promise<void>;
  onAcceptPilot: () => Promise<void>;
  onRejectPilot: () => Promise<void>;
  onLlego: (shift: GuardShift) => Promise<void>;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
}

export { AmbitoSheetBody };

export function OperacionMovil(props: Props) {
  const router = useRouter();
  const online = useOnlineFlag();
  const readOnly = props.readOnly === true;
  const empresaKey = props.empresaId || props.empresa;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [salaOpen, setSalaOpen] = useState(false);
  const [ambitoOpen, setAmbitoOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [filtro, setFiltroState] = useState<OpsFiltroMovil>(FILTRO_VACIO);

  // El último filtro de esta empresa se recuerda en la pestaña (sessionStorage).
  useEffect(() => { setFiltroState(leerFiltroGuardado(empresaKey)); }, [empresaKey]);
  const setFiltro = (next: OpsFiltroMovil) => {
    setFiltroState(next);
    guardarFiltro(empresaKey, next);
    props.logic.setViewTab(next.estado);
  };

  useEffect(() => movilWriteQueue.subscribe(() => {
    const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
    setPending(labels[0] || null);
  }), []);

  useEffect(() => {
    const alInicio = () => setSelectedId(null);
    window.addEventListener('cosp-modulo-inicio', alInicio);
    return () => window.removeEventListener('cosp-modulo-inicio', alInicio);
  }, []);

  const nowMs = props.now ?? Date.now();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const visibles = useMemo(() => turnosVisiblesMovil(props.shifts, props.publishStatusMap), [props.shifts, props.publishStatusMap]);
  const clientes = useMemo(() => clientesParaFiltro(visibles, props.catalogo || []), [visibles, props.catalogo]);
  const contadores = useMemo(() => contadoresMovil(visibles, filtro, now), [visibles, filtro, now]);
  const enAmbitoList = useMemo(() => turnosEnAmbito(visibles, filtro), [visibles, filtro]);
  const filtrados = useMemo(() => turnosFiltrados(visibles, filtro, now), [visibles, filtro, now]);
  // Resumen por objetivo (estado Todos) y tarjetas agrupadas (estado activo).
  const objectives = useMemo(
    () => (agruparPorObjetivo(enAmbitoList, now) as MovilObjective[])
      // Igual que el escritorio: objetivos sin actividad real no se listan.
      .filter((o) => o.active + o.retention + o.absent + o.vacant + o.plan > 0),
    [enAmbitoList, now],
  );
  const grupos = useMemo(() => agruparPorObjetivo(filtrados, now) as MovilObjective[], [filtrados, now]);
  const ambitoLabel = etiquetaAmbito(filtro, clientes);

  const panelQuery = String(router.query.panel || '');
  // La barra del módulo abre la sala con ?panel=sala (contrato lib/movil/modulos.ts).
  const salaVisible = !readOnly && (salaOpen || panelQuery === 'sala');
  const cerrarSala = () => {
    setSalaOpen(false);
    if (panelQuery === 'sala') void router.push('/admin/operaciones/');
  };
  const objective = (filtro.estado === 'TODOS' ? objectives : grupos).find((item) => item.objectiveId === selectedId) || null;
  const panel = panelQuery === 'alertas' ? 'alertas' : objective ? 'objetivo' : 'home';
  const alerts = useMemo(
    () => enAmbitoList.filter((shift) => {
      const tone = guardTone(shift);
      return tone === 'aus' || tone === 'vac' || tone === 'ret' || tone === 'late';
    }),
    [enAmbitoList],
  );
  const steps = Array.from(new Set(COVERAGE_CASCADE_ORDER.map((step) => STEP_LABEL[step] || step)));

  const call = async (label: string, run: () => Promise<void>) => {
    try {
      await runCallableOnline(label, run);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Requiere conexión');
    }
  };
  const noop = () => {};

  return (
    <>
      <OperacionScreens
        empresa={props.empresa}
        modeLabel={props.modeLabel}
        online={online}
        pendingLabel={pending}
        notices={props.notices}
        readOnly={readOnly}
        now={nowMs}
        objectives={objectives}
        objective={objective}
        alerts={alerts}
        panel={panel === 'alertas' ? 'alertas' : panel}
        filtro={filtro}
        contadores={contadores}
        ambitoLabel={ambitoLabel}
        grupos={grupos}
        vacioLabel={mensajeVacio(filtro, clientes)}
        onAmbito={() => setAmbitoOpen(true)}
        onQuitarAmbito={() => setFiltro({ ...filtro, clientId: null, objectiveId: null })}
        onBack={() => setSelectedId(null)}
        onOpen={setSelectedId}
        onCounter={(id) => setFiltro(alternarEstado(filtro, id as OpsEstadoFiltro))}
        onLlego={readOnly ? noop : (shift) => { void call('Llegó?', () => props.onLlego(shift)); }}
        onRevertir={readOnly ? noop : (shift) => { void call('Revertir', () => props.onLlego(shift)); }}
        onSalida={readOnly ? noop : (shift) => {
          void enqueueFirestoreWrite(`Salida ${shift.employeeName || ''}`.trim(), async () => {
            await props.logic.handleAction('CHECKOUT', shift.id, 'Salida desde el celular');
          })
            .then((result) => {
              if (result === 'queued') toast.message('Pendiente de enviar');
              else toast.success('Salida registrada');
            });
        }}
        onProtocolo={readOnly ? noop : props.onProtocolo}
        onRetencion={readOnly ? noop : props.onRetencion}
        onSala={readOnly ? noop : () => setSalaOpen(true)}
      />
      <BottomSheet open={ambitoOpen} title="Cliente y objetivo" onClose={() => setAmbitoOpen(false)}>
        {ambitoOpen && (
          <AmbitoSheetBody
            clientes={clientes}
            filtro={filtro}
            onElegir={(clientId, objectiveId) => {
              setFiltro({ ...filtro, clientId, objectiveId });
              setSelectedId(null);
              setAmbitoOpen(false);
            }}
          />
        )}
      </BottomSheet>
      {!readOnly && (
        <BottomSheet open={salaVisible} title={`Sala · ${props.modeLabel}`} onClose={cerrarSala}>
          <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] font-black uppercase text-emerald-800">Modo {props.modeLabel}</p>
            <p className="text-sm font-bold">A mando: {props.pilotName || '—'}{props.isPilot ? ' (vos)' : ''}</p>
            <p className="text-xs font-semibold text-slate-500">Apoyo: {props.apoyo || 'nadie'}</p>
          </div>
          {props.pendingPilotName && (
            <div className="mb-3 rounded-2xl border border-indigo-200 p-3">
              <p className="text-sm font-black">{props.pendingPilotName} pide el mando</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="min-h-12 flex-1 rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => { void call('Aceptar mando', props.onAcceptPilot); }}>Aceptar</button>
                <button type="button" className="min-h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-black" onClick={() => { void call('Rechazar mando', props.onRejectPilot); }}>No</button>
              </div>
            </div>
          )}
          {!props.isPilot && (
            <button type="button" className="mb-2 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => { void call('Pedir mando', props.onRequestPilot); }}>Pedir mando</button>
          )}
          <button type="button" className="mb-2 min-h-12 w-full rounded-2xl border border-emerald-300 bg-white text-sm font-black text-emerald-800" onClick={() => { void call('Tomar mando', props.onTomarMando); }}>Tomar mando</button>
          <button type="button" className="mb-4 min-h-12 w-full rounded-2xl bg-rose-50 text-sm font-black text-rose-700" onClick={() => { void call('Pasar a Auto', props.onPasarAuto); }}>Pasar a Auto</button>
          <p className="text-[11px] font-bold text-slate-500">Protocolo vigente: {steps.join(' → ')}. Los candidatos y Convocar abren la hoja del protocolo.</p>
        </BottomSheet>
      )}
      <MovilBottomNav alertCount={alerts.length} />
    </>
  );
}
