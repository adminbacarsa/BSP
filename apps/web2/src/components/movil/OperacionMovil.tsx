import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { AmbitoSheetBody, GuardAccionesSheetBody, OperacionScreens, ProximasSheetBody, SalaSheetBody, useOnlineFlag, type GuardShift, type MovilObjective } from '@/components/movil/OperacionScreens';
import { COVERAGE_CASCADE_ORDER } from '@cosp/ops-core';
import { auth } from '@/lib/firebase';
import { guardTone } from '@/lib/movil/guardTone';
import type { GuardAccion, GuardAccionId } from '@/lib/movil/guardAcciones';
import { proximasFranjas } from '@/lib/movil/proximasFranjas';
import { piePrincipal } from '@/lib/movil/estadoLista';
import { guardarNotaOperador, invokeAvisarGuardiaOperaciones } from '@/lib/operaciones/avisarGuardiaClient';
import {
  FILTRO_VACIO,
  agruparPorObjetivo,
  alternarEstado,
  claveGrupo,
  clientesParaFiltro,
  contadoresMovil,
  ausentesSinCubrirMovil,
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
  /** Única huella de CRONOGRAMA_SIN_PUBLICAR en Operación: una línea agrupada con las que cortan mañana. */
  cronogramaAviso?: { texto: string; onVista: () => Promise<unknown> | void } | null;
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
  /** Tengo sesión en la sala (piloto o copiloto). */
  inRoom?: boolean;
  pilotName?: string;
  apoyo?: string;
  pendingPilotName?: string;
  /** Piloto de otro operador sin heartbeat hace >= 5 min. */
  pilotInactive?: boolean;
  pilotInactiveMin?: number;
  onTomarMando: () => Promise<void>;
  /** Toma de mando por piloto inactivo (callable `sesionOperador` takeOverPilot). */
  onTakeOver?: () => Promise<void>;
  onPasarAuto: () => Promise<void>;
  /** Copiloto sale de la sala sin pasar a Auto. */
  onSalirSala?: () => Promise<void>;
  onRequestPilot: () => Promise<void>;
  onAcceptPilot: () => Promise<void>;
  onRejectPilot: () => Promise<void>;
  onLlego: (shift: GuardShift) => Promise<void>;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
  /** Ingreso manual desde Operaciones (registrarPresencia, relevo de la serie). */
  onIngreso?: (shift: GuardShift) => Promise<void>;
  /** Declarar ausente (marcarAusenciaOperaciones). */
  onAusente?: (shift: GuardShift) => Promise<void>;
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
  const [accionesShiftId, setAccionesShiftId] = useState<string | null>(null);
  const [proximasOpen, setProximasOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [filtro, setFiltroState] = useState<OpsFiltroMovil>(FILTRO_VACIO);
  // «Actualizado hace N min»: último snapshot del monitor que llegó; el reloj del pie se refresca cada 30 s.
  const [lastUpdateMs, setLastUpdateMs] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => { setLastUpdateMs(Date.now()); }, [props.shifts]);
  useEffect(() => {
    if (props.now) return undefined;
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, [props.now]);

  // El último filtro de esta empresa se recuerda en la pestaña (sessionStorage).
  useEffect(() => { setFiltroState(leerFiltroGuardado(empresaKey)); }, [empresaKey]);
  const setFiltro = (next: OpsFiltroMovil) => {
    setFiltroState(next);
    guardarFiltro(empresaKey, next);
    props.logic.setViewTab(next.estado);
  };

  useEffect(() => {
    const refresh = () => {
      const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
      setPending(labels[0] || null);
      setPendingCount(labels.length);
    };
    const offA = movilWriteQueue.subscribe(refresh);
    const offB = movilCallableGate.subscribe(refresh);
    return () => { offA(); offB(); };
  }, []);

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
  const ausSinCubrir = useMemo(() => ausentesSinCubrirMovil(visibles, filtro, now), [visibles, filtro, now]);
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
  // Próximas 3 h dentro del ámbito elegido (sin consultas nuevas: mismos turnos del monitor).
  const proximas = useMemo(() => proximasFranjas(enAmbitoList as GuardShift[], now), [enAmbitoList, now]);
  // `tick` fuerza el recálculo del «hace N min» cada 30 s.
  const pieLabel = useMemo(() => piePrincipal(lastUpdateMs, pendingCount, props.now ?? Date.now()), [lastUpdateMs, pendingCount, props.now, tick]);

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

  const salida = (shift: GuardShift, nota: string) =>
    enqueueFirestoreWrite(`Salida ${shift.employeeName || ''}`.trim(), async () => {
      await props.logic.handleAction('CHECKOUT', shift.id, nota);
    }).then((result) => {
      if (result === 'queued') toast.message('Pendiente de enviar');
      else toast.success('Salida registrada');
    });

  // Hoja de acciones: el turno se busca en todo lo visible (también si cambió de grupo).
  const accionesShift = accionesShiftId ? visibles.find((s) => s.id === accionesShiftId) || props.shifts.find((s) => s.id === accionesShiftId) || null : null;
  // Hermanos = mismo grupo (objetivo o evento): el EV no mezcla relevos con el objetivo de base.
  const accionesSiblings = accionesShift ? visibles.filter((s) => claveGrupo(s) === claveGrupo(accionesShift)) : [];
  const actorName = () => auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
  const avisar = async (accion: GuardAccion) => {
    const kind = accion.id === 'AVISAR_RETENIDO' ? 'RETENIDO' : 'ENTRANTE';
    const shiftId = accion.targetShiftId;
    if (!shiftId) return;
    await call(accion.label, async () => {
      const r = await invokeAvisarGuardiaOperaciones({ shiftId, kind, relatedShiftId: accion.relatedShiftId || null, actorName: actorName(), device: 'celular' });
      toast.success(r.resent ? 'Aviso reenviado por la app' : 'Aviso enviado por la app', { description: r.body });
    });
  };
  const guardarNota = async (shift: GuardShift, texto: string) => {
    if (readOnly) return;
    const result = await enqueueFirestoreWrite(`Nota ${shift.employeeName || ''}`.trim(), async () => {
      await guardarNotaOperador({
        shift: shift as Record<string, unknown> & { id: string },
        texto,
        autor: actorName(),
        autorUid: auth.currentUser?.uid || null,
        empresaId: props.empresaId || null,
        source: 'CC_MOVIL',
      });
    });
    if (result === 'queued') toast.message('Nota pendiente de enviar');
    else toast.success('Nota guardada');
  };
  const ejecutarAccion = async (shift: GuardShift, id: GuardAccionId, accion?: GuardAccion) => {
    if (readOnly) return;
    switch (id) {
      case 'AVISAR_ENTRANTE':
      case 'AVISAR_RETENIDO':
        if (accion) await avisar(accion);
        return;
      case 'LLEGO':
        await call('Llegó · revertir', () => props.onLlego(shift));
        return;
      case 'PROTOCOLO':
        props.onProtocolo(shift);
        return;
      case 'INGRESO':
        if (!props.onIngreso) return;
        await call('Ingreso', () => props.onIngreso!(shift));
        return;
      case 'AUSENTE':
        if (!props.onAusente) return;
        await call('Marcar ausente', () => props.onAusente!(shift));
        return;
      case 'LIBERAR':
        await salida(shift, 'Liberado desde el celular');
        return;
      case 'SALIDA':
        await salida(shift, 'Salida desde el celular');
        return;
      case 'RETENCION':
        props.onRetencion(shift);
        return;
      default:
        return;
    }
  };

  // Deep-link del push: /admin/operaciones/?shiftId=… abre la tarjeta (su objetivo + hoja de acciones).
  const empresaSheet = useEmpresaSheet();
  const deepShiftId = String(router.query.shiftId || '');
  const deepAbiertoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepShiftId || deepAbiertoRef.current === deepShiftId) return;
    const shift = props.shifts.find((s) => s.id === deepShiftId);
    if (!shift) return;
    deepAbiertoRef.current = deepShiftId;
    setFiltroState((f) => (f.estado === 'TODOS' ? f : { ...f, estado: 'TODOS' }));
    setSelectedId(claveGrupo(shift));
    setAccionesShiftId(shift.id);
  }, [deepShiftId, props.shifts]);

  return (
    <>
      <OperacionScreens
        empresa={props.empresa}
        onEmpresa={empresaSheet.onEmpresa}
        modeLabel={props.modeLabel}
        online={online}
        pendingLabel={pending}
        notices={props.notices}
        cronogramaAviso={props.cronogramaAviso}
        readOnly={readOnly}
        now={nowMs}
        objectives={objectives}
        objective={objective}
        alerts={alerts}
        panel={panel === 'alertas' ? 'alertas' : panel}
        filtro={filtro}
        contadores={contadores}
        ausSinCubrir={ausSinCubrir}
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
        onSalida={readOnly ? noop : (shift) => { void salida(shift, 'Salida desde el celular'); }}
        onProtocolo={readOnly ? noop : props.onProtocolo}
        onRetencion={readOnly ? noop : props.onRetencion}
        onAcciones={(shift) => setAccionesShiftId(shift.id)}
        onSala={readOnly ? noop : () => setSalaOpen(true)}
        proximas={proximas}
        onProximas={() => setProximasOpen(true)}
        pieLabel={pieLabel}
      />
      <BottomSheet open={!!accionesShift} title={readOnly ? 'Detalle del turno' : 'Acciones del turno'} onClose={() => setAccionesShiftId(null)}>
        {accionesShift && (
          <GuardAccionesSheetBody
            shift={accionesShift}
            siblings={accionesSiblings}
            now={nowMs}
            soloDetalle={readOnly}
            onEjecutar={(id, accion) => ejecutarAccion(accionesShift, id, accion)}
            onCerrar={() => setAccionesShiftId(null)}
            onNota={readOnly ? undefined : (texto) => guardarNota(accionesShift, texto)}
          />
        )}
      </BottomSheet>
      <BottomSheet open={proximasOpen} title="Próximas 3 horas" onClose={() => setProximasOpen(false)}>
        {proximasOpen && (
          <ProximasSheetBody
            franjas={proximas}
            readOnly={readOnly}
            now={nowMs}
            onCubrir={(shift) => { setProximasOpen(false); props.onProtocolo(shift); }}
            onAbrirObjetivo={(objectiveId) => { setProximasOpen(false); setSelectedId(objectiveId); }}
          />
        )}
      </BottomSheet>
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
          {salaVisible && (
            <SalaSheetBody
              modeLabel={props.modeLabel}
              isPilot={props.isPilot}
              inRoom={props.inRoom ?? props.isPilot}
              pilotName={props.pilotName}
              apoyo={props.apoyo}
              pendingPilotName={props.pendingPilotName}
              pilotInactive={props.pilotInactive}
              pilotInactiveMin={props.pilotInactiveMin}
              steps={steps}
              onTomarMando={() => call('Tomar mando', props.onTomarMando)}
              onTakeOver={() => call('Tomar el mando', async () => {
                if (!props.onTakeOver) return;
                await props.onTakeOver();
                toast.success('Tomaste el mando del Centro de Control');
              })}
              onRequestPilot={() => call('Pedir mando', props.onRequestPilot)}
              onAcceptPilot={() => call('Aceptar mando', props.onAcceptPilot)}
              onRejectPilot={() => call('Rechazar mando', props.onRejectPilot)}
              onPasarAuto={() => call('Pasar a Auto', async () => { await props.onPasarAuto(); cerrarSala(); })}
              onSalir={() => call('Salir de la sala', async () => { await (props.onSalirSala || props.onPasarAuto)(); cerrarSala(); })}
            />
          )}
        </BottomSheet>
      )}
      {empresaSheet.sheet}
      <MovilBottomNav alertCount={alerts.length} />
    </>
  );
}
