import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRightLeft, Bell, CalendarClock, Clock, Hourglass, LogIn, MapPin, MessageSquare, MoreHorizontal, Phone, Radio, Search, ShieldAlert, Star, StickyNote, Timer, User, UserCheck, UserX, X,
  type LucideIcon,
} from 'lucide-react';
import {
  MOVIL_BORDER, MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_TEXT,
  MovilBadge, MovilCard, MovilHeader, MovilIconBox, MovilIconButton, MovilProgress, MovilTopBar, toneForGuard, toneForPct, type MovilTone,
} from './ui';
import { coveragePct, guardStatusLabel, guardTone } from '@/lib/movil/guardTone';
import { guardDetalle, proximoRelevo, type GuardDetalleShift } from '@/lib/movil/guardDetalle';
import { guardCompacto, type GuardEstadoCompacto } from '@/lib/movil/guardCompacto';
import { ALTO_HASTA_PRIMERA_TARJETA_PX, MOVIL_CONTADORES, buscarClientes, etiquetaAus, etiquetaEstado, mensajeVacio, type OpsClienteMovil, type OpsEstadoFiltro, type OpsFiltroMovil } from '@/lib/movil/operacionFiltros';
import { accionesParaTurno, avisoManualRestanteSeg, type GuardAccion, type GuardAccionId } from '@/lib/movil/guardAcciones';
import { etiquetaProximas, resumenProximas, type ProximaFranja } from '@/lib/movil/proximasFranjas';
import { OPS_NOTA_MAX } from '@/lib/operaciones/opsNota';
import { movilFechaCorta } from '@/lib/movil/fechaCorta';
import { PuntajeChip } from '@/components/desempeno/PuntajeChip';

/**
 * Botones de la hoja de acciones: primario = color de la empresa (negro por defecto),
 * el resto blancos con borde y el texto en el color del estado.
 */
const ACCION_CLS: Record<GuardAccion['tone'], string> = {
  go: `${MOVIL_BTN_SECONDARY} !text-emerald-700`,
  pri: MOVIL_BTN_PRIMARY,
  warn: `${MOVIL_BTN_SECONDARY} !text-orange-700`,
  danger: `${MOVIL_BTN_SECONDARY} !text-rose-700`,
  neutral: MOVIL_BTN_SECONDARY,
};

const BTN = 'min-h-12 rounded-lg text-sm font-semibold disabled:opacity-50 active:bg-slate-50';

/**
 * Hoja inferior de la tarjeta: acciones que corresponden al estado del turno,
 * con confirmación dentro de la hoja. Mismas callables que el escritorio.
 * Avisar por la app va primero; llamar es el último recurso.
 */
export function GuardAccionesSheetBody({
  shift,
  siblings = [],
  now,
  onEjecutar,
  onCerrar,
  onNota,
  confirmandoInicial = null,
  soloDetalle = false,
}: {
  shift: GuardShift;
  siblings?: readonly GuardShift[];
  now?: number;
  onEjecutar: (id: GuardAccionId, accion: GuardAccion) => void | Promise<void>;
  onCerrar: () => void;
  /** Nota rápida del operador (se guarda en el turno y en la bitácora). */
  onNota?: (texto: string) => void | Promise<void>;
  /** Tests: arrancar con una acción en confirmación. */
  confirmandoInicial?: GuardAccionId | null;
  /** Supervisión: la misma hoja, solo el detalle, sin botones sobre el turno. */
  soloDetalle?: boolean;
}) {
  const nowMs = now ?? Date.now();
  const acciones = accionesParaTurno(shift as never, nowMs, siblings as never);
  const [confirmando, setConfirmando] = useState<GuardAccionId | null>(confirmandoInicial);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState('');
  const [guardandoNota, setGuardandoNota] = useState(false);
  const telefono = String(shift.phone || '').trim() || null;
  const pendiente = acciones.find((a) => a.id === confirmando) || null;
  const detalle = guardDetalle(shift, siblings, nowMs);
  const ejecutar = async (accion: GuardAccion) => {
    setOcupado(true);
    try {
      await onEjecutar(accion.id, accion);
      onCerrar();
    } finally {
      setOcupado(false);
      setConfirmando(null);
    }
  };
  const guardarNota = async () => {
    const texto = nota.trim();
    if (!texto || !onNota) return;
    setGuardandoNota(true);
    try {
      await onNota(texto);
      setNota('');
    } finally {
      setGuardandoNota(false);
    }
  };
  const cooldownDe = (accion: GuardAccion): number => {
    if (accion.id !== 'AVISAR_ENTRANTE' && accion.id !== 'AVISAR_RETENIDO') return 0;
    const target = accion.targetShiftId === shift.id ? shift : siblings.find((s) => s.id === accion.targetShiftId) || null;
    return target ? avisoManualRestanteSeg({ opsAvisoManualAt: target.opsAvisoManualAt }, nowMs) : 0;
  };
  const visual = toneForGuard(guardTone(shift));
  return (
    <div data-movil-sheet={soloDetalle ? 'detalle' : 'acciones'} data-movil-acciones-shift={shift.id}>
      <div className={`relative mb-3 ${MOVIL_CARD} p-3 pl-4`}>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${MOVIL_FILETE[visual]}`} />
        <div className="flex items-center gap-2">
          <MovilIconBox icon={shift.isUnassigned ? ShieldAlert : User} tone={visual} size="sm" />
          <strong className={`truncate text-sm font-semibold ${shift.isUnassigned ? 'text-rose-700' : 'text-slate-900'}`}>
            {shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Sin nombre'}
          </strong>
          {!shift.isUnassigned && <PuntajeChip sujetoId={String((shift as { bolsaCuil?: string }).bolsaCuil || shift.employeeId || '')} />}
          <MovilBadge tone={visual} className="ml-auto">{guardStatusLabel(shift)}</MovilBadge>
        </div>
        <GuardDetalleLines shift={shift} siblings={siblings} now={nowMs} />
      </div>
      {soloDetalle ? null : pendiente ? (
        <div className={`${MOVIL_CARD} p-3`} data-movil-confirmar={pendiente.id}>
          <p className="text-sm font-semibold text-slate-900">{pendiente.label}</p>
          <p className="mt-1 text-[12px] font-medium text-slate-700">{pendiente.confirm}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void ejecutar(pendiente); }} className={`${BTN} flex-1 ${MOVIL_BTN_PRIMARY}`} data-movil-confirmar-ok="1">
              {ocupado ? 'Enviando…' : 'Confirmar'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className={`${BTN} flex-1 ${MOVIL_BTN_SECONDARY}`}>Volver</button>
          </div>
        </div>
      ) : (
        <>
          {acciones.map((accion, index) => {
            const cooldown = cooldownDe(accion);
            return (
              <button
                key={`${accion.id}-${accion.targetShiftId || index}`}
                type="button"
                data-movil-accion={accion.id}
                data-movil-accion-target={accion.targetShiftId}
                disabled={cooldown > 0}
                onClick={() => (accion.confirm ? setConfirmando(accion.id) : void ejecutar(accion))}
                className={`mb-2 flex min-h-14 w-full items-center justify-between rounded-lg px-3 text-left disabled:opacity-50 ${ACCION_CLS[accion.tone]}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{accion.label}</span>
                  <span className="block truncate text-[11px] font-medium opacity-75" data-movil-accion-hint={accion.id}>
                    {cooldown > 0 ? `Ya se le avisó · reintentá en ${Math.ceil(cooldown / 60)} min` : accion.hint}
                  </span>
                </span>
                <span aria-hidden="true" className="ml-2 shrink-0 text-lg">›</span>
              </button>
            );
          })}
          {acciones.length === 0 && <p className={`${MOVIL_CARD} p-3 text-sm font-medium text-slate-500`} data-movil-acciones-vacio="1">Sin acciones para este estado.</p>}
          {onNota && !shift.isUnassigned && (
            <div className={`mt-1 ${MOVIL_CARD} p-3`} data-movil-nota="1">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500" htmlFor={`nota-${shift.id}`}>
                <StickyNote size={12} strokeWidth={1.75} aria-hidden="true" /> Nota rápida
              </label>
              {detalle.nota && <p className="mt-1 text-[12px] font-medium text-slate-700" data-movil-nota-actual="1">{detalle.nota}</p>}
              <div className="mt-2 flex gap-2">
                <input
                  id={`nota-${shift.id}`}
                  type="text"
                  value={nota}
                  maxLength={OPS_NOTA_MAX}
                  onChange={(event) => setNota(event.target.value)}
                  placeholder="Ej.: sin llaves del portón"
                  data-movil-nota-input="1"
                  className={`min-h-11 min-w-0 flex-1 rounded-lg border ${MOVIL_BORDER} bg-white px-3 text-base text-slate-900 outline-none focus:border-[var(--movil-primary,#111827)]`}
                />
                <button type="button" disabled={guardandoNota || !nota.trim()} onClick={() => { void guardarNota(); }} className={`${BTN} px-3 ${MOVIL_BTN_PRIMARY}`} data-movil-nota-guardar="1">
                  {guardandoNota ? '…' : 'Guardar'}
                </button>
              </div>
              <p className="mt-1 text-[10px] font-medium text-slate-400">La ve el escritorio en la tarjeta y la bitácora, con tu nombre y la hora. Sin señal queda pendiente.</p>
            </div>
          )}
          {!shift.isUnassigned && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Último recurso</p>
              <LlamarButton telefono={telefono} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Hoja «Próximas 3 horas»: franjas que entran, confirmados / sin confirmar / sin nadie → Cubrir. */
export function ProximasSheetBody({ franjas, readOnly = false, now, onCubrir, onAbrirObjetivo }: {
  franjas: readonly ProximaFranja[];
  readOnly?: boolean;
  now?: number;
  onCubrir?: (shift: GuardShift) => void;
  onAbrirObjetivo?: (objectiveId: string) => void;
}) {
  void now;
  const resumen = resumenProximas(franjas);
  const ESTADO: Record<string, { cls: string; texto: string }> = {
    CONFIRMADO: { cls: 'text-emerald-600', texto: 'confirmó' },
    SIN_CONFIRMAR: { cls: 'text-amber-600', texto: 'sin confirmar' },
    AUSENTE: { cls: 'text-rose-600', texto: 'ausente' },
  };
  return (
    <div data-movil-sheet="proximas">
      <p className="mb-2 text-[11px] font-medium text-slate-500" data-movil-proximas-resumen="1">{etiquetaProximas(resumen)}</p>
      {franjas.map((f) => {
        const tone: MovilTone = f.sinNadie ? 'rose' : f.sinConfirmar > 0 ? 'amber' : 'emerald';
        return (
          <article key={f.key} className={`relative mb-2 ${MOVIL_CARD} p-3 pl-4`} data-movil-franja={f.key} data-movil-franja-estado={f.sinNadie ? 'sin-nadie' : f.sinConfirmar > 0 ? 'sin-confirmar' : 'ok'}>
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${MOVIL_FILETE[tone]}`} />
            <div className="flex items-center gap-2">
              <b className="text-[15px] font-semibold tabular-nums text-slate-900">{f.hora}</b>
              {f.code && <span className="rounded border border-slate-300 px-1.5 text-[10px] font-bold leading-5 text-slate-700">{f.code}</span>}
              <span className="ml-auto text-[11px] font-medium tabular-nums text-slate-500">en {f.enMin} min</span>
            </div>
            <button type="button" onClick={onAbrirObjetivo ? () => onAbrirObjetivo(f.objectiveId) : undefined} className="mt-0.5 block max-w-full truncate text-left text-[12px] font-medium text-slate-700">
              {f.objetivo} · {f.puesto}
            </button>
            <ul className="mt-1.5 space-y-0.5">
              {f.guardias.map((g) => (
                <li key={g.shiftId} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate font-medium text-slate-800">{g.nombre}</span>
                  <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${ESTADO[g.estado].cls}`}>
                    {ESTADO[g.estado].texto}{g.hora ? ` ${g.hora}` : ''}
                  </span>
                </li>
              ))}
              {f.guardias.length === 0 && <li className="text-[12px] font-semibold text-rose-600">Franja sin nadie asignado</li>}
            </ul>
            {f.sinNadie && !readOnly && f.cubrirShift && onCubrir && (
              <button type="button" onClick={() => onCubrir(f.cubrirShift as GuardShift)} className={`${BTN} mt-2 w-full ${MOVIL_BTN_PRIMARY}`} data-movil-franja-cubrir={f.key}>
                Cubrir · protocolo
              </button>
            )}
          </article>
        );
      })}
      {franjas.length === 0 && <p className={`${MOVIL_CARD} p-3 text-sm font-medium text-slate-500`} data-movil-proximas-vacio="1">No entra ninguna franja en las próximas 3 horas.</p>}
    </div>
  );
}

export interface SalaSheetProps {
  modeLabel: string;
  isPilot: boolean;
  inRoom: boolean;
  pilotName?: string;
  apoyo?: string;
  pendingPilotName?: string;
  /** Piloto de otro operador sin heartbeat hace >= 5 min. */
  pilotInactive?: boolean;
  pilotInactiveMin?: number;
  steps: readonly string[];
  onTomarMando: () => Promise<void> | void;
  onTakeOver: () => Promise<void> | void;
  onRequestPilot: () => Promise<void> | void;
  onAcceptPilot: () => Promise<void> | void;
  onRejectPilot: () => Promise<void> | void;
  onPasarAuto: () => Promise<void> | void;
  onSalir: () => Promise<void> | void;
  /** Tests: arrancar con una confirmación abierta. */
  confirmandoInicial?: 'AUTO' | 'TOMAR' | null;
}

/** Sala del celular: piloto/copiloto, tomar/pedir/pasar mando, pasar a Auto. */
export function SalaSheetBody(props: SalaSheetProps) {
  const [confirmando, setConfirmando] = useState<'AUTO' | 'TOMAR' | null>(props.confirmandoInicial ?? null);
  const [ocupado, setOcupado] = useState(false);
  const hayPiloto = !!props.pilotName;
  const otroPiloto = hayPiloto && !props.isPilot;
  const run = async (fn: () => Promise<void> | void) => {
    setOcupado(true);
    try { await fn(); } finally { setOcupado(false); setConfirmando(null); }
  };
  const btn = `mb-2 w-full ${BTN}`;
  const estadoTone: MovilTone = props.pilotInactive ? 'rose' : 'emerald';
  return (
    <div data-movil-sheet="sala" data-movil-sala-rol={props.isPilot ? 'piloto' : props.inRoom ? 'copiloto' : 'fuera'}>
      <div className={`relative mb-3 ${MOVIL_CARD} p-3 pl-4`}>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${MOVIL_FILETE[estadoTone]}`} />
        <div className="flex items-center gap-2">
          <MovilIconBox icon={Radio} tone={estadoTone} size="sm" />
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${MOVIL_TEXT[estadoTone]}`}>Modo {props.modeLabel}</p>
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-900">A mando: {props.pilotName || '—'}{props.isPilot ? ' (vos)' : ''}</p>
        {otroPiloto && props.pilotInactive && (
          <p className="text-[12px] font-semibold text-rose-600" data-movil-piloto-inactivo="1">Sin actividad hace {props.pilotInactiveMin ?? 0} min · podés tomar el mando</p>
        )}
        <p className="text-xs font-medium text-slate-500">Apoyo: {props.apoyo || 'nadie'}</p>
      </div>
      {confirmando === 'AUTO' && (
        <div className={`mb-3 ${MOVIL_CARD} p-3`} data-movil-confirmar="AUTO">
          <p className="text-sm font-semibold text-slate-900">Pasar a Auto</p>
          <p className="mt-1 text-[12px] font-medium text-slate-700">Se cierra la sala para todos y el Centro de Control queda automático. ¿Confirmás?</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void run(props.onPasarAuto); }} className={`${BTN} flex-1 ${MOVIL_BTN_SECONDARY} !text-rose-700`} data-movil-confirmar-ok="1">{ocupado ? 'Enviando…' : 'Sí, pasar a Auto'}</button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className={`${BTN} flex-1 ${MOVIL_BTN_SECONDARY}`}>Volver</button>
          </div>
        </div>
      )}
      {confirmando === 'TOMAR' && (
        <div className={`mb-3 ${MOVIL_CARD} p-3`} data-movil-confirmar="TOMAR">
          <p className="text-sm font-semibold text-slate-900">Tomar el mando</p>
          <p className="mt-1 text-[12px] font-medium text-slate-700">{props.pilotName || 'El piloto'} no da señales hace {props.pilotInactiveMin ?? 0} min. Tomás el mando desde este celular sin su aceptación; queda registrado en la bitácora (quién, dispositivo, motivo).</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void run(props.onTakeOver); }} className={`${BTN} flex-1 ${MOVIL_BTN_PRIMARY}`} data-movil-confirmar-ok="1">{ocupado ? 'Enviando…' : 'Sí, tomar el mando'}</button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className={`${BTN} flex-1 ${MOVIL_BTN_SECONDARY}`}>Volver</button>
          </div>
        </div>
      )}
      {!confirmando && (
        <>
          {props.isPilot && props.pendingPilotName && (
            <div className={`mb-3 ${MOVIL_CARD} p-3`} data-movil-pedido-mando="1">
              <p className="text-sm font-semibold text-slate-900">{props.pendingPilotName} pide el mando</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={ocupado} className={`${BTN} flex-1 ${MOVIL_BTN_PRIMARY}`} onClick={() => { void run(props.onAcceptPilot); }}>Aceptar</button>
                <button type="button" disabled={ocupado} className={`${BTN} flex-1 ${MOVIL_BTN_SECONDARY}`} onClick={() => { void run(props.onRejectPilot); }}>No</button>
              </div>
            </div>
          )}
          {otroPiloto && props.pilotInactive && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="TOMAR_INACTIVO" className={`${btn} ${MOVIL_BTN_PRIMARY}`} onClick={() => setConfirmando('TOMAR')}>Tomar el mando ahora · piloto sin actividad</button>
          )}
          {otroPiloto && !props.pilotInactive && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="PEDIR" className={`${btn} ${MOVIL_BTN_PRIMARY}`} onClick={() => { void run(props.inRoom ? props.onRequestPilot : props.onTomarMando); }}>
              {props.inRoom ? 'Pedir mando' : 'Entrar como apoyo y pedir mando'}
            </button>
          )}
          {!hayPiloto && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="TOMAR" className={`${btn} ${MOVIL_BTN_PRIMARY}`} onClick={() => { void run(props.onTomarMando); }}>Tomar mando · pasar a Manual</button>
          )}
          {props.isPilot && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="AUTO" className={`${btn} ${MOVIL_BTN_SECONDARY} !text-rose-700`} onClick={() => setConfirmando('AUTO')}>Pasar a Auto</button>
          )}
          {props.inRoom && !props.isPilot && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="SALIR" className={`${btn} ${MOVIL_BTN_SECONDARY}`} onClick={() => { void run(props.onSalir); }}>Salir de la sala</button>
          )}
          <p className="mt-2 text-[11px] font-medium text-slate-500">Protocolo vigente: {props.steps.join(' → ')}. Los candidatos y Convocar abren la hoja del protocolo.</p>
        </>
      )}
    </div>
  );
}

/** Hoja «Cliente → objetivos» con buscador. El elegido se rellena con el color de la empresa. */
export function AmbitoSheetBody({ clientes, filtro, onElegir }: {
  clientes: readonly OpsClienteMovil[];
  filtro: OpsFiltroMovil;
  onElegir: (clientId: string | null, objectiveId: string | null) => void;
}) {
  const [texto, setTexto] = useState('');
  const [clienteAbierto, setClienteAbierto] = useState<string | null>(filtro.clientId);
  const lista = buscarClientes(clientes, texto);
  const abierto = lista.find((c) => c.id === clienteAbierto) || (lista.length === 1 ? lista[0] : null);
  const opcion = (activo: boolean) => `${BTN} w-full ${activo ? MOVIL_PRIMARY_BG : MOVIL_BTN_SECONDARY}`;
  return (
    <div data-movil-sheet="ambito">
      <div className="relative mb-3">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="Buscar cliente u objetivo"
          aria-label="Buscar cliente u objetivo"
          className={`h-9 w-full rounded-lg border ${MOVIL_BORDER} bg-white pl-9 pr-3 text-base font-medium outline-none focus:border-[var(--movil-primary,#111827)]`}
        />
      </div>
      <button type="button" onClick={() => onElegir(null, null)} className={`mb-2 ${opcion(!filtro.clientId && !filtro.objectiveId)}`}>
        Todos los clientes
      </button>
      {!abierto && lista.map((c) => (
        <button
          key={c.id}
          type="button"
          data-movil-cliente={c.id}
          onClick={() => setClienteAbierto(c.id)}
          className={`mb-1.5 flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left ${MOVIL_BTN_SECONDARY}`}
        >
          <span className="truncate text-sm font-semibold text-slate-900">{c.name}</span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-500">{c.objetivos.length} obj · {c.turnos}</span>
        </button>
      ))}
      {abierto && (
        <>
          <div className="mb-1.5 flex items-center gap-2">
            {lista.length > 1 && (
              <button type="button" onClick={() => setClienteAbierto(null)} aria-label="Volver a clientes" className={`flex h-10 w-10 items-center justify-center rounded-lg ${MOVIL_BTN_SECONDARY}`}>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            <p className="truncate text-sm font-semibold text-slate-900">{abierto.name}</p>
          </div>
          <button type="button" data-movil-cliente-todo={abierto.id} onClick={() => onElegir(abierto.id, null)} className={`mb-1.5 ${opcion(filtro.clientId === abierto.id && !filtro.objectiveId)}`}>
            Todo {abierto.name} · {abierto.turnos}
          </button>
          {abierto.objetivos.map((o) => {
            const activo = filtro.objectiveId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                data-movil-objetivo={o.id}
                onClick={() => onElegir(abierto.id, o.id)}
                className={`mb-1.5 flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left ${activo ? MOVIL_PRIMARY_BG : MOVIL_BTN_SECONDARY}`}
              >
                <span className="truncate text-sm font-semibold">{o.name}</span>
                <span className="shrink-0 text-[11px] font-medium tabular-nums opacity-70">{o.turnos}</span>
              </button>
            );
          })}
        </>
      )}
      {lista.length === 0 && <p className={`${MOVIL_CARD} p-4 text-sm font-medium text-slate-500`}>Nada coincide con «{texto}».</p>}
    </div>
  );
}

export interface MovilObjective {
  objectiveId: string;
  name: string;
  client?: string;
  /** Grupo de evento («Evento: X · servicio»), ubicado en el lugar del evento. */
  esEvento?: boolean;
  lugar?: string | null;
  active: number;
  retention: number;
  absent: number;
  vacant: number;
  plan: number;
  shifts: GuardShift[];
}

export type GuardShift = GuardDetalleShift;

export interface MovilStats {
  activos: number;
  retenidos: number;
  ausentes: number;
  vacantes: number;
  plan: number;
}

/** Texto del estado en color (solo el estado lleva color). */
const TONE_TEXT: Record<string, string> = {
  ok: 'text-emerald-600',
  ret: 'text-orange-600',
  aus: 'text-rose-600',
  late: 'text-amber-600',
  vac: 'text-rose-600',
  plan: 'text-slate-500',
};

/** «jueves 1 de octubre» en la línea gris bajo la barra. */
function BigButton({ label, tone, onClick }: { label: string; tone?: 'go' | 'pri' | 'warn'; onClick: () => void }) {
  const cls = tone === 'pri' ? MOVIL_BTN_PRIMARY : tone === 'go' ? `${MOVIL_BTN_SECONDARY} !text-emerald-700` : tone === 'warn' ? `${MOVIL_BTN_SECONDARY} !text-orange-700` : MOVIL_BTN_SECONDARY;
  return (
    <button type="button" onClick={onClick} className={`min-h-11 flex-1 rounded-lg text-[12px] font-semibold active:bg-slate-50 ${cls}`}>
      {label}
    </button>
  );
}

/** Botón LLAMAR con el teléfono del legajo (último recurso). Sin teléfono queda deshabilitado. */
export function LlamarButton({ telefono, compact = false }: { telefono: string | null; compact?: boolean }) {
  const cls = telefono ? `${MOVIL_BTN_SECONDARY}` : 'border border-slate-200 bg-white text-slate-400';
  return (
    <a
      href={telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : undefined}
      aria-disabled={telefono ? undefined : 'true'}
      aria-label={telefono ? `Llamar a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-llamar={telefono ? '1' : '0'}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold ${compact ? 'w-11' : 'w-full px-3'} ${cls}`}
      onClick={telefono ? undefined : (event) => event.preventDefault()}
    >
      <Phone size={16} strokeWidth={1.75} aria-hidden="true" />
      {!compact && (telefono ? `Llamar · ${telefono}` : 'Sin teléfono en el legajo')}
    </a>
  );
}

/**
 * Detalle del guardia: horario planificado + código, puesto y objetivo,
 * ingreso real o estado con minutos, relevo, convocatoria/cobertura, nota.
 */
export function GuardDetalleLines({ shift, siblings = [], now, showObjective = true }: { shift: GuardShift; siblings?: readonly GuardShift[]; now?: number; showObjective?: boolean }) {
  const tone = guardTone(shift);
  const d = guardDetalle(shift, siblings, now ?? Date.now());
  return (
    <div data-movil-detalle={shift.id} className="min-w-0">
      <p className="truncate text-[11px] font-medium text-slate-500">
        <span className="font-semibold uppercase text-slate-700">{d.puesto}</span>
        {showObjective && d.objetivo ? ` · ${d.objetivo}` : ''}
      </p>
      <p className="text-[12px] font-semibold tabular-nums text-slate-900">
        {d.horario}
        <span className="ml-1 rounded border border-slate-300 px-1 text-[10px] font-bold text-slate-700">{d.code}</span>
      </p>
      {d.ingreso && <p className="truncate text-[11px] font-semibold text-emerald-600">{d.ingreso}</p>}
      {d.estado && <p className={`truncate text-[11px] font-semibold ${TONE_TEXT[tone]}`}>{d.estado}</p>}
      {d.relevaA && <p className="truncate text-[11px] font-medium text-slate-600">{d.relevaA}</p>}
      {d.loReleva && <p className="truncate text-[11px] font-medium text-slate-600">{d.loReleva}</p>}
      {d.convocatoria && <p className="truncate text-[11px] font-semibold text-slate-700">{d.convocatoria}</p>}
      {d.cobertura && <p className="truncate text-[11px] font-semibold text-slate-700">{d.cobertura}</p>}
      {d.nota && <p className="truncate text-[11px] font-medium text-slate-600" data-movil-nota-linea="1">{d.nota}</p>}
    </div>
  );
}

/** Ícono del chip de estado (fila 1, derecha). */
const ESTADO_ICON: Record<GuardEstadoCompacto, LucideIcon> = {
  activo: Clock,
  retenido: Hourglass,
  tarde: Clock,
  ausente: UserX,
  cubierto: UserCheck,
  cubriendo: Hourglass,
  parcial: UserCheck,
  vacante: AlertTriangle,
  plan: CalendarClock,
  cierra: Clock,
};

/** Color del chip y del filete: la ausencia sigue el estado único (rojo sin cubrir, verde cubierta, ámbar en curso/parcial). */
function visualDeEstado(c: ReturnType<typeof guardCompacto>): MovilTone {
  switch (c.estado.kind) {
    case 'cierra': return 'slate';
    case 'ausente': return 'rose';
    case 'cubierto': return 'emerald';
    case 'cubriendo':
    case 'parcial': return 'amber';
    default: return toneForGuard(c.tone);
  }
}

/** Ítem de la fila 2: ícono lucide + texto corto. */
function MiniItem({ icon: Icon, children, className = '', attr }: { icon: LucideIcon; children: ReactNode; className?: string; attr?: string }) {
  return (
    <span className={`flex shrink-0 items-center gap-0.5 ${className}`} data-movil-mini={attr}>
      <Icon size={11} strokeWidth={1.75} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Teléfono: ícono solo (36 px), blanco con borde. Sin teléfono queda deshabilitado. */
function LlamarIcon({ telefono }: { telefono: string | null }) {
  return (
    <a
      href={telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : undefined}
      aria-disabled={telefono ? undefined : 'true'}
      aria-label={telefono ? `Llamar a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-llamar={telefono ? '1' : '0'}
      onClick={(event) => { event.stopPropagation(); if (!telefono) event.preventDefault(); }}
      className={`my-auto mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white ${telefono ? 'border-slate-300 text-slate-700' : 'border-slate-200 text-slate-300'}`}
    >
      <Phone size={15} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}

/**
 * Tarjeta compacta del guardia (2 filas, ~56 px): fila 1 nombre + código + estado en texto;
 * fila 2 íconos (puesto, horario, ingreso, tope, relevo, respuesta, nota). Tocar la tarjeta
 * abre la hoja de acciones; el detalle largo vive en la hoja. Estado = filete de 3 px + texto en color.
 */
export function GuardCard({
  shift,
  siblings = [],
  now,
  readOnly = false,
  onProtocolo,
  onAcciones,
}: {
  shift: GuardShift;
  /** Turnos del mismo objetivo: de acá sale a quién releva / quién lo releva. */
  siblings?: readonly GuardShift[];
  now?: number;
  readOnly?: boolean;
  onLlego?: (shift: GuardShift) => void;
  onRevertir?: (shift: GuardShift) => void;
  onSalida?: (shift: GuardShift) => void;
  onProtocolo?: (shift: GuardShift) => void;
  onRetencion?: (shift: GuardShift) => void;
  /** Abre la hoja de acciones del turno (avisar, ingreso, salida, ausente, llegó, liberar, protocolo, nota, llamar). */
  onAcciones?: (shift: GuardShift) => void;
}) {
  const c = guardCompacto(shift, siblings, now ?? Date.now());
  const visual = visualDeEstado(c);
  const EstadoIcon = ESTADO_ICON[c.estado.kind];
  const abrir = onAcciones ?? (readOnly ? null : onProtocolo ?? null);
  const Fila = abrir ? 'button' : 'div';
  return (
    <article
      className={`mb-1.5 flex items-stretch overflow-hidden ${MOVIL_CARD}`}
      data-movil-tone={c.tone}
      data-movil-card="compacta"
    >
      <span aria-hidden="true" className={`w-[3px] shrink-0 ${MOVIL_FILETE[visual]}`} />
      <Fila
        {...(abrir ? { type: 'button' as const, onClick: () => abrir(shift), 'aria-label': `Acciones de ${c.nombre}` } : {})}
        data-movil-tap={abrir ? shift.id : undefined}
        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left ${abrir ? 'active:bg-slate-50' : ''}`}
      >
        <span className="flex items-center gap-1.5">
          <strong className={`truncate text-[13px] font-semibold leading-5 ${c.esVacante ? 'text-rose-600' : 'text-slate-900'}`}>{c.nombre}</strong>
          {!c.esVacante && <PuntajeChip sujetoId={String((shift as { bolsaCuil?: string }).bolsaCuil || shift.employeeId || '')} />}
          <span className="shrink-0 rounded border border-slate-300 px-1 text-[10px] font-bold leading-4 text-slate-700" data-movil-code={c.code}>{c.code}</span>
          {c.extra && <span className="shrink-0 rounded border border-slate-300 px-1 text-[10px] font-bold leading-4 text-slate-700" data-movil-extra={c.extra}>{c.extra}</span>}
          <span className={`ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold leading-4 tabular-nums ${MOVIL_TEXT[visual]}`} data-movil-estado={c.estado.kind}>
            <EstadoIcon size={11} strokeWidth={1.75} aria-hidden="true" />
            {c.estado.texto}
          </span>
        </span>
        <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[10px] font-medium leading-4 tabular-nums text-slate-500" data-movil-detalle={shift.id}>
          <MiniItem icon={MapPin} attr="puesto">{c.puesto}</MiniItem>
          <MiniItem icon={Clock} attr="horario">{c.horario}</MiniItem>
          {c.ingreso && (
            <MiniItem icon={LogIn} attr="ingreso" className={c.ingreso.tardeMin > 0 ? 'text-amber-600' : 'text-emerald-600'}>
              {c.ingreso.hhmm}{c.ingreso.tardeMin > 0 ? ` +${c.ingreso.tardeMin}′` : ''}
            </MiniItem>
          )}
          {c.tope && <MiniItem icon={Hourglass} attr="tope" className="text-orange-600">{c.tope}</MiniItem>}
          {c.cierre && <MiniItem icon={Clock} attr="cierre" className="text-slate-500">{c.cierre}</MiniItem>}
          {c.relevo && <MiniItem icon={ArrowRightLeft} attr="relevo" className="text-slate-600">{c.relevo.apellido} {c.relevo.hhmm}</MiniItem>}
          {c.avisoRelevo && <span className="truncate text-slate-600" data-relevo-ausente="1">{c.avisoRelevo}</span>}
          {c.respuesta && <MiniItem icon={MessageSquare} attr="respuesta" className="text-amber-600">resp. {c.respuesta.hhmm}{c.respuesta.eta ? ` ~${c.respuesta.eta}` : ''}</MiniItem>}
          {c.nota && <MiniItem icon={StickyNote} attr="nota" className="text-slate-600">{c.nota}</MiniItem>}
        </span>
      </Fila>
      {!c.esVacante && <LlamarIcon telefono={c.telefono} />}
    </article>
  );
}

export function OperacionScreens({
  empresa,
  modeLabel,
  online,
  pendingLabel,
  stats,
  notices = [],
  cronogramaAviso = null,
  readOnly = false,
  objectives,
  objective,
  alerts,
  panel,
  onBack,
  onOpen,
  onCounter,
  onLlego,
  onRevertir,
  onSalida,
  onProtocolo,
  onRetencion,
  onSala,
  now,
  filtro = { estado: 'TODOS', clientId: null, objectiveId: null },
  contadores,
  ausSinCubrir,
  ambitoLabel = null,
  grupos = [],
  vacioLabel,
  onAmbito,
  onQuitarAmbito,
  onAcciones,
  proximas,
  onProximas,
  pieLabel = null,
  onEmpresa,
}: {
  empresa: string;
  /** Píldora de empresa → hoja de cambio de empresa (solo si puede cambiar). */
  onEmpresa?: () => void;
  modeLabel: string;
  online: boolean;
  pendingLabel: string | null;
  /** Compatibilidad: si no vienen `contadores`, se muestran estos números. */
  stats?: MovilStats;
  notices?: string[];
  /** CRONOGRAMA_SIN_PUBLICAR: una sola línea agrupada (solo las que cortan mañana) con «Vista». */
  cronogramaAviso?: { texto: string; onVista: () => Promise<unknown> | void } | null;
  /** Supervisión: mismas pantallas sin botones de acción ni sala. */
  readOnly?: boolean;
  /** Instante de referencia (tests). Default `Date.now()`. */
  now?: number;
  /** Resumen por objetivo dentro del ámbito (estado Todos). */
  objectives: MovilObjective[];
  objective: MovilObjective | null;
  alerts: GuardShift[];
  panel: 'home' | 'objetivo' | 'alertas';
  /** Filtro activo: estado (contador) + cliente/objetivo. */
  filtro?: OpsFiltroMovil;
  /** Número de cada contador dentro del ámbito = tarjetas que aparecen al filtrar. */
  contadores?: Partial<Record<OpsEstadoFiltro, number>>;
  /** Ausencias sin cubrir dentro del ámbito: el número de AUS va en rojo solo si hay alguna. */
  ausSinCubrir?: number;
  /** Chip del cliente/objetivo elegido. */
  ambitoLabel?: string | null;
  /** Tarjetas agrupadas por objetivo cuando hay un estado activo. */
  grupos?: MovilObjective[];
  vacioLabel?: string;
  onAmbito?: () => void;
  onQuitarAmbito?: () => void;
  /** Hoja de acciones de la tarjeta. */
  onAcciones?: (shift: GuardShift) => void;
  /** Franjas que entran en las próximas 3 h (fila bajo los contadores → hoja). */
  proximas?: readonly ProximaFranja[];
  onProximas?: () => void;
  /** «Actualizado hace N min · N pendientes de enviar» al pie de la lista. */
  pieLabel?: string | null;
  onBack: () => void;
  onOpen: (id: string) => void;
  onCounter: (id: string) => void;
  onLlego: (shift: GuardShift) => void;
  onRevertir: (shift: GuardShift) => void;
  onSalida: (shift: GuardShift) => void;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
  onSala: () => void;
}) {
  const nowMs = now ?? Date.now();
  const siblingsOf = (shift: GuardShift): readonly GuardShift[] =>
    objective?.shifts
    ?? grupos.find((item) => item.shifts.some((s) => s.id === shift.id))?.shifts
    ?? objectives.find((item) => item.objectiveId === shift.objectiveId)?.shifts
    ?? [];
  const legacy: Partial<Record<OpsEstadoFiltro, number>> = stats
    ? { ACTIVOS: stats.activos, RETENIDOS: stats.retenidos, AUSENTES: stats.ausentes, VACANTES: stats.vacantes, PLAN: stats.plan }
    : {};
  const counters = MOVIL_CONTADORES
    .map((item) => ({ ...item, value: contadores?.[item.id] ?? legacy[item.id] }))
    .filter((item) => item.value !== undefined);
  const filtrando = filtro.estado !== 'TODOS';
  // El vacío siempre nombra el filtro activo («Sin guardias en ACT»), nunca «Mostrando ACT · 0».
  const vacioTexto = vacioLabel ?? mensajeVacio(filtro, []);
  const cardProps = { now: nowMs, readOnly, onLlego, onRevertir, onSalida, onProtocolo, onRetencion, onAcciones };
  const moduloLabel = readOnly ? 'Supervisión' : 'Operación';
  const vacio = 'py-6 text-center text-[13px] font-medium text-slate-400';
  const resumenProx = proximas ? resumenProximas(proximas) : null;
  const pie = pieLabel ? (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium tabular-nums text-slate-400" data-movil-pie="1">
      <Timer size={12} strokeWidth={1.75} aria-hidden="true" />
      {pieLabel}
    </p>
  ) : null;
  return (
    <div className={`mx-auto flex min-h-screen w-full max-w-[480px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`} data-movil-screen={panel} data-movil-readonly={readOnly ? '1' : undefined}>
      <MovilTopBar
        modulo={moduloLabel}
        empresa={empresa}
        onEmpresa={onEmpresa}
        online={online}
        pendingLabel={pendingLabel}
        right={readOnly ? (
          <MovilBadge tone="slate" size="md" outline className="!border-white/40 !text-white">Solo lectura</MovilBadge>
        ) : (
          <button
            type="button"
            onClick={onSala}
            aria-label={`Sala · ${modeLabel}`}
            data-movil-modo={modeLabel}
            className="flex h-6 items-center rounded border border-white/50 px-1.5 text-[10px] font-medium uppercase tracking-wide text-white/90"
          >
            {modeLabel}
          </button>
        )}
      />
      <div className="px-3 pt-1">
        {(panel === 'home' || panel === 'objetivo') && (
          <p className="h-5 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">{movilFechaCorta(nowMs)} · {modeLabel}</p>
        )}
        {panel === 'objetivo' && (
          <div className="mb-1 flex h-9 items-center gap-1.5" data-movil-objetivo-header="fino" data-movil-hasta-tarjeta={ALTO_HASTA_PRIMERA_TARJETA_PX}>
            <button type="button" onClick={onBack} aria-label="Volver" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${MOVIL_BTN_SECONDARY}`}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {objective?.esEvento
              ? <Star size={13} strokeWidth={1.75} className="shrink-0 text-amber-600" aria-hidden="true" />
              : <MapPin size={13} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden="true" />}
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-wide text-slate-900" data-movil-evento={objective?.esEvento ? '1' : undefined}>{objective?.name || 'Objetivo'}</h2>
            {(objective?.lugar || objective?.client) && <span className="hidden min-[360px]:inline truncate text-[10px] font-medium text-slate-400">· {objective?.lugar || objective?.client}</span>}
            <span className="ml-auto shrink-0 rounded border border-slate-300 px-2 text-[10px] font-bold leading-5 tabular-nums text-slate-700">{objective?.shifts.length ?? 0}</span>
          </div>
        )}
        {panel === 'alertas' && (
          <MovilHeader
            icon={Bell}
            title="Alertas"
            subtitle={readOnly ? 'Prioridad primero · las acciones las toma el CC' : 'Prioridad primero · la acción grande bajo el pulgar'}
            right={<MovilBadge tone={alerts.length > 0 ? 'rose' : 'emerald'} size="md" outline>{alerts.length}</MovilBadge>}
            className="mb-3"
          />
        )}
        {panel === 'home' && (
          <>
            {cronogramaAviso && (
              <p className={`relative mb-2 flex items-center gap-2 ${MOVIL_CARD} px-3 py-2 pl-4 text-xs font-medium text-slate-800`} data-cronograma-aviso="1">
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg bg-amber-500" />
                <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0 text-amber-600" aria-hidden="true" />
                <span className="flex-1">{cronogramaAviso.texto}</span>
                {!readOnly && (
                  <button type="button" onClick={() => { void cronogramaAviso.onVista(); }} aria-label="Marcar como vista" className={`flex h-8 shrink-0 items-center rounded-lg px-2 text-[11px] font-semibold ${MOVIL_BTN_SECONDARY}`}>
                    Vista
                  </button>
                )}
              </p>
            )}
            {notices.map((text) => (
              <p key={text} className={`relative mb-2 flex items-start gap-2 ${MOVIL_CARD} px-3 py-2 pl-4 text-xs font-medium text-slate-800`}>
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg bg-amber-500" />
                <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{text}</span>
              </p>
            ))}
            {onAmbito && (
              <div className="mb-2 flex items-center gap-1.5" data-movil-ambito={filtro.objectiveId ? 'objetivo' : filtro.clientId ? 'cliente' : 'todos'}>
                <button
                  type="button"
                  onClick={onAmbito}
                  aria-label="Filtrar por cliente u objetivo"
                  data-movil-buscar="1"
                  className={`flex h-9 flex-1 items-center gap-2 rounded-lg px-3 text-left text-[12px] font-medium ${MOVIL_BTN_SECONDARY} !text-slate-600`}
                >
                  <Search size={15} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="truncate">{ambitoLabel ? 'Cambiar cliente u objetivo' : 'Todos los clientes y objetivos'}</span>
                </button>
                {ambitoLabel && (
                  <span className={`flex h-9 max-w-[55%] items-center gap-1 rounded-lg pl-3 pr-1 text-[11px] font-semibold ${MOVIL_PRIMARY_BG}`} data-movil-chip="ambito">
                    <span className="truncate">{ambitoLabel}</span>
                    <button type="button" onClick={onQuitarAmbito} aria-label={`Quitar filtro ${ambitoLabel}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-white/10">
                      <X size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="mb-2 grid grid-cols-6 gap-1" role="group" aria-label="Filtrar por estado" data-movil-contadores="fila">
              {counters.map((item) => {
                const activo = filtro.estado === item.id;
                // AUS: el total se muestra; el rojo es solo por las sin cubrir (mismo criterio que el CC).
                const esAus = item.id === 'AUSENTES';
                const ausPendientes = esAus ? (ausSinCubrir ?? item.value ?? 0) : 0;
                const label = esAus && typeof ausSinCubrir === 'number' ? etiquetaAus(item.value ?? 0, ausSinCubrir) : `${item.label}: ${item.value}`;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onCounter(item.id)}
                    aria-pressed={activo}
                    aria-label={label}
                    title={esAus ? label : undefined}
                    data-movil-contador={item.id}
                    data-movil-aus-sin-cubrir={esAus && typeof ausSinCubrir === 'number' ? ausSinCubrir : undefined}
                    data-movil-filtro-activo={activo ? '1' : undefined}
                    className={`flex h-8 min-w-0 items-center justify-center gap-0.5 rounded border px-0.5 text-[11px] font-semibold tabular-nums ${activo ? `border-transparent ${MOVIL_PRIMARY_BG}` : `${MOVIL_BORDER} bg-white text-slate-700`}`}
                  >
                    <b className={`text-[11px] leading-none ${!activo && esAus && ausPendientes > 0 ? 'text-rose-600' : ''}`}>{item.value}</b>
                    <span className={`text-[10px] uppercase leading-none ${activo ? 'opacity-80' : 'text-slate-500'}`}>{item.corto}</span>
                  </button>
                );
              })}
            </div>
            {proximas && resumenProx && (
              <button
                type="button"
                onClick={onProximas}
                data-movil-proximas="fila"
                data-movil-proximas-sin-nadie={resumenProx.sinNadie > 0 ? '1' : undefined}
                className={`relative mb-2 flex min-h-11 w-full items-center gap-2 ${MOVIL_CARD} px-3 pl-4 text-left text-[12px] font-medium text-slate-700 active:bg-slate-50`}
              >
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${resumenProx.sinNadie > 0 ? 'bg-rose-500' : resumenProx.sinConfirmar > 0 ? 'bg-amber-500' : resumenProx.franjas > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <CalendarClock size={15} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden="true" />
                <span className="truncate">{etiquetaProximas(resumenProx)}</span>
                <span aria-hidden="true" className="ml-auto text-slate-400">›</span>
              </button>
            )}
            {filtrando && grupos.length > 0 && (
              <p className="mb-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
                <span>Mostrando <b className="font-semibold text-slate-900">{etiquetaEstado(filtro.estado)}</b>{ambitoLabel ? ` · ${ambitoLabel}` : ''} · {grupos.reduce((acc, g) => acc + g.shifts.length, 0)}</span>
                <button type="button" onClick={() => onCounter(filtro.estado)} className="min-h-9 rounded-lg px-2 font-semibold text-slate-900 underline-offset-2 active:underline">Ver todos</button>
              </p>
            )}
            {filtrando && grupos.map((grupo) => (
              <section key={grupo.objectiveId} className="mb-3" data-movil-grupo={grupo.objectiveId} data-movil-grupo-evento={grupo.esEvento ? '1' : undefined}>
                <button type="button" onClick={() => onOpen(grupo.objectiveId)} className="mb-1.5 flex w-full items-center gap-2 px-1 text-left">
                  {grupo.esEvento
                    ? <Star size={13} strokeWidth={1.75} className="shrink-0 text-amber-600" aria-hidden="true" />
                    : <MapPin size={13} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />}
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">{grupo.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-slate-400">{grupo.lugar ? `${grupo.lugar} · ` : grupo.client ? `${grupo.client} · ` : ''}{grupo.shifts.length}</span>
                </button>
                {grupo.shifts.map((shift) => (
                  <GuardCard key={shift.id} shift={shift} siblings={siblingsOf(shift)} {...cardProps} />
                ))}
              </section>
            ))}
            {filtrando && grupos.length === 0 && (
              <div className="flex flex-col items-center gap-1">
                <p className={vacio} data-movil-vacio="1">{vacioTexto}</p>
                <button type="button" onClick={() => onCounter(filtro.estado)} className="min-h-9 rounded-lg px-2 text-[12px] font-semibold text-slate-900 underline-offset-2 active:underline">Ver todos</button>
              </div>
            )}
            {!filtrando && objectives.map((item) => {
              const pct = coveragePct(item);
              const pctTone = toneForPct(pct);
              const relevo = proximoRelevo(item.shifts, nowMs);
              return (
                <MovilCard
                  key={item.objectiveId}
                  className="mb-2"
                  icon={item.esEvento ? Star : MapPin}
                  tone={item.esEvento ? 'amber' : 'slate'}
                  title={item.name}
                  subtitle={item.esEvento ? [item.client, item.lugar].filter(Boolean).join(' · ') || 'Evento' : item.client || 'Objetivo'}
                  badge={<MovilBadge tone={pctTone} size="md">{pct}%</MovilBadge>}
                  onClick={() => onOpen(item.objectiveId)}
                  attrs={{ 'data-movil-objetivo-card': item.objectiveId, ...(item.esEvento ? { 'data-movil-evento-card': '1' } : {}) }}
                >
                  <MovilProgress pct={pct} tone={pctTone} className="mt-2.5" />
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {item.active > 0 && <MovilBadge tone="emerald">ACT {item.active}</MovilBadge>}
                    {item.retention > 0 && <MovilBadge tone="orange">RET {item.retention}</MovilBadge>}
                    {item.absent > 0 && (
                      <MovilBadge tone={((item as { absentSinCubrir?: number }).absentSinCubrir ?? item.absent) > 0 ? 'rose' : 'slate'}>
                        AUS {item.absent}{((item as { absentSinCubrir?: number }).absentSinCubrir ?? item.absent) === 0 ? ' · cub.' : ''}
                      </MovilBadge>
                    )}
                    {item.vacant > 0 && <MovilBadge tone="rose">VAC {item.vacant}</MovilBadge>}
                    {item.plan > 0 && <MovilBadge tone="slate">PLA {item.plan}</MovilBadge>}
                  </div>
                  {relevo && <p className="mt-1.5 text-[11px] font-medium tabular-nums text-slate-600">{relevo}</p>}
                </MovilCard>
              );
            })}
            {!filtrando && objectives.length === 0 && (
              <p className={vacio} data-movil-vacio="1">{ambitoLabel ? vacioTexto : 'Sincronizando objetivos…'}</p>
            )}
            {pie}
          </>
        )}
        {panel === 'objetivo' && objective && (
          <>
            {objective.shifts.map((shift) => (
              <GuardCard
                key={shift.id}
                shift={shift}
                siblings={objective.shifts}
                now={nowMs}
                readOnly={readOnly}
                onLlego={onLlego}
                onRevertir={onRevertir}
                onSalida={onSalida}
                onProtocolo={onProtocolo}
                onRetencion={onRetencion}
                onAcciones={onAcciones}
              />
            ))}
            {pie}
          </>
        )}
        {panel === 'alertas' && (
          <>
            {alerts.map((shift, index) => {
              const tone = guardTone(shift);
              const visual = toneForGuard(tone);
              return (
                <MovilCard key={shift.id} className="mb-2 overflow-hidden !p-0" ring={visual} attrs={{ 'data-movil-alerta': shift.id }}>
                  <div className="flex">
                    {index === 0 && !readOnly && (
                      <button type="button" onClick={() => (tone === 'vac' ? onProtocolo(shift) : onLlego(shift))} className={`flex w-[88px] shrink-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${MOVIL_PRIMARY_BG}`}>
                        <UserCheck size={20} strokeWidth={1.75} aria-hidden="true" />
                        {tone === 'vac' ? 'Cubrir' : 'Llegó'}
                      </button>
                    )}
                    <div className="min-w-0 flex-1 p-3">
                      <div className="flex items-start gap-2.5">
                        <MovilIconBox icon={shift.isUnassigned ? ShieldAlert : UserX} tone={visual} size="sm" />
                        <div className="min-w-0 flex-1">
                          <MovilBadge tone={visual}>{guardStatusLabel(shift)}</MovilBadge>
                          <h3 className="mt-0.5 truncate text-[15px] font-semibold leading-tight text-slate-900">{shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Vacante'}</h3>
                          {!shift.isUnassigned && <PuntajeChip sujetoId={String((shift as { bolsaCuil?: string }).bolsaCuil || shift.employeeId || '')} />}
                        </div>
                      </div>
                      <GuardDetalleLines shift={shift} siblings={siblingsOf(shift)} now={nowMs} />
                      <div className="mt-2 flex gap-1.5">
                        {!readOnly && (
                          <>
                            {!shift.isUnassigned && <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />}
                            <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />
                            {onAcciones && <MovilIconButton icon={MoreHorizontal} label="Más acciones" attrs={{ 'data-movil-mas-acciones': shift.id }} onClick={() => onAcciones(shift)} />}
                          </>
                        )}
                        {!shift.isUnassigned && <LlamarButton telefono={String(shift.phone || '').trim() || null} compact={!readOnly} />}
                      </div>
                    </div>
                  </div>
                </MovilCard>
              );
            })}
            {alerts.length === 0 && (
              <MovilCard icon={UserCheck} tone="emerald" title="Sin alertas en este momento." subtitle="Todo el plantel en orden." />
            )}
            {pie}
          </>
        )}
      </div>
    </div>
  );
}

export function useOnlineFlag(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const apply = () => setOnline(typeof navigator === 'undefined' || navigator.onLine !== false);
    apply();
    window.addEventListener('online', apply);
    window.addEventListener('offline', apply);
    return () => {
      window.removeEventListener('online', apply);
      window.removeEventListener('offline', apply);
    };
  }, []);
  return online;
}
