import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRightLeft, Bell, CalendarClock, Clock, Hourglass, LogIn, MapPin, MessageCircle, MoreHorizontal, Phone, Radio, Search, ShieldAlert, User, UserCheck, UserX, X,
  type LucideIcon,
} from 'lucide-react';
import { MOVIL_PILL, MOVIL_RING, MovilBadge, MovilCard, MovilHeader, MovilIconBox, MovilIconButton, MovilProgress, MovilTopBar, toneForGuard, toneForPct, type MovilTone } from './ui';
import { coveragePct, guardStatusLabel, guardTone } from '@/lib/movil/guardTone';
import { guardDetalle, proximoRelevo, type GuardDetalleShift } from '@/lib/movil/guardDetalle';
import { guardCompacto, type GuardEstadoCompacto } from '@/lib/movil/guardCompacto';
import { normalizeArgPhone } from '@/lib/whatsapp';
import { MOVIL_CONTADORES, buscarClientes, etiquetaEstado, type OpsClienteMovil, type OpsEstadoFiltro, type OpsFiltroMovil } from '@/lib/movil/operacionFiltros';
import { accionesParaTurno, type GuardAccion, type GuardAccionId } from '@/lib/movil/guardAcciones';

const ACCION_CLS: Record<GuardAccion['tone'], string> = {
  go: 'bg-emerald-600 text-white',
  pri: 'bg-indigo-600 text-white',
  warn: 'border border-orange-200 bg-orange-50 text-orange-800',
  danger: 'border border-rose-200 bg-rose-50 text-rose-800',
  neutral: 'border border-slate-200 bg-white text-slate-800',
};

/**
 * Hoja inferior de la tarjeta: acciones que corresponden al estado del turno,
 * con confirmación dentro de la hoja. Mismas callables que el escritorio.
 */
export function GuardAccionesSheetBody({
  shift,
  siblings = [],
  now,
  onEjecutar,
  onCerrar,
  confirmandoInicial = null,
}: {
  shift: GuardShift;
  siblings?: readonly GuardShift[];
  now?: number;
  onEjecutar: (id: GuardAccionId) => void | Promise<void>;
  onCerrar: () => void;
  /** Tests: arrancar con una acción en confirmación. */
  confirmandoInicial?: GuardAccionId | null;
}) {
  const nowMs = now ?? Date.now();
  const acciones = accionesParaTurno(shift as never, nowMs);
  const [confirmando, setConfirmando] = useState<GuardAccionId | null>(confirmandoInicial);
  const [ocupado, setOcupado] = useState(false);
  const telefono = String(shift.phone || '').trim() || null;
  const pendiente = acciones.find((a) => a.id === confirmando) || null;
  const ejecutar = async (accion: GuardAccion) => {
    setOcupado(true);
    try {
      await onEjecutar(accion.id);
      onCerrar();
    } finally {
      setOcupado(false);
      setConfirmando(null);
    }
  };
  return (
    <div data-movil-sheet="acciones" data-movil-acciones-shift={shift.id}>
      <div className="mb-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <MovilIconBox icon={shift.isUnassigned ? ShieldAlert : User} tone={toneForGuard(guardTone(shift))} size="sm" />
          <strong className={`truncate text-sm ${shift.isUnassigned ? 'text-rose-700' : 'text-slate-900'}`}>
            {shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Sin nombre'}
          </strong>
          <MovilBadge tone={toneForGuard(guardTone(shift))} className="ml-auto">{guardStatusLabel(shift)}</MovilBadge>
        </div>
        <GuardDetalleLines shift={shift} siblings={siblings} now={nowMs} />
      </div>
      {pendiente ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3" data-movil-confirmar={pendiente.id}>
          <p className="text-sm font-black text-slate-900">{pendiente.label}</p>
          <p className="mt-1 text-[12px] font-semibold text-slate-700">{pendiente.confirm}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void ejecutar(pendiente); }} className={`min-h-12 flex-1 rounded-2xl text-sm font-black ${ACCION_CLS[pendiente.tone]} disabled:opacity-50`} data-movil-confirmar-ok="1">
              {ocupado ? 'Enviando…' : 'Confirmar'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700">Volver</button>
          </div>
        </div>
      ) : (
        <>
          {acciones.map((accion) => (
            <button
              key={accion.id}
              type="button"
              data-movil-accion={accion.id}
              onClick={() => (accion.confirm ? setConfirmando(accion.id) : void ejecutar(accion))}
              className={`mb-2 flex min-h-14 w-full items-center justify-between rounded-2xl px-3 text-left ${ACCION_CLS[accion.tone]}`}
            >
              <span>
                <span className="block text-sm font-black">{accion.label}</span>
                <span className="block text-[11px] font-semibold opacity-80">{accion.hint}</span>
              </span>
              <span aria-hidden="true" className="text-lg font-black">›</span>
            </button>
          ))}
          {acciones.length === 0 && <p className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-500" data-movil-acciones-vacio="1">Sin acciones para este estado.</p>}
          {!shift.isUnassigned && (
            <div className="mt-1 flex gap-2">
              <LlamarButton telefono={telefono} />
              <WhatsAppButton telefono={telefono} />
            </div>
          )}
        </>
      )}
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
  const btn = 'mb-2 min-h-12 w-full rounded-2xl text-sm font-black disabled:opacity-50';
  return (
    <div data-movil-sheet="sala" data-movil-sala-rol={props.isPilot ? 'piloto' : props.inRoom ? 'copiloto' : 'fuera'}>
      <div className={`mb-3 rounded-2xl border p-3 ${props.pilotInactive ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-center gap-2">
          <MovilIconBox icon={Radio} tone={props.pilotInactive ? 'rose' : 'emerald'} size="sm" />
          <p className={`text-[10px] font-black uppercase tracking-wide ${props.pilotInactive ? 'text-rose-800' : 'text-emerald-800'}`}>Modo {props.modeLabel}</p>
        </div>
        <p className="mt-1 text-sm font-bold">A mando: {props.pilotName || '—'}{props.isPilot ? ' (vos)' : ''}</p>
        {otroPiloto && props.pilotInactive && (
          <p className="text-[12px] font-black text-rose-700" data-movil-piloto-inactivo="1">Sin actividad hace {props.pilotInactiveMin ?? 0} min · podés tomar el mando</p>
        )}
        <p className="text-xs font-semibold text-slate-500">Apoyo: {props.apoyo || 'nadie'}</p>
      </div>
      {confirmando === 'AUTO' && (
        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 p-3" data-movil-confirmar="AUTO">
          <p className="text-sm font-black text-slate-900">Pasar a Auto</p>
          <p className="mt-1 text-[12px] font-semibold text-slate-700">Se cierra la sala para todos y el Centro de Control queda automático. ¿Confirmás?</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void run(props.onPasarAuto); }} className="min-h-12 flex-1 rounded-2xl bg-rose-600 text-sm font-black text-white disabled:opacity-50" data-movil-confirmar-ok="1">{ocupado ? 'Enviando…' : 'Sí, pasar a Auto'}</button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-white text-sm font-black">Volver</button>
          </div>
        </div>
      )}
      {confirmando === 'TOMAR' && (
        <div className="mb-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3" data-movil-confirmar="TOMAR">
          <p className="text-sm font-black text-slate-900">Tomar el mando</p>
          <p className="mt-1 text-[12px] font-semibold text-slate-700">{props.pilotName || 'El piloto'} no da señales hace {props.pilotInactiveMin ?? 0} min. Tomás el mando desde este celular sin su aceptación; queda registrado en la bitácora (quién, dispositivo, motivo).</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { void run(props.onTakeOver); }} className="min-h-12 flex-1 rounded-2xl bg-indigo-600 text-sm font-black text-white disabled:opacity-50" data-movil-confirmar-ok="1">{ocupado ? 'Enviando…' : 'Sí, tomar el mando'}</button>
            <button type="button" disabled={ocupado} onClick={() => setConfirmando(null)} className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-white text-sm font-black">Volver</button>
          </div>
        </div>
      )}
      {!confirmando && (
        <>
          {props.isPilot && props.pendingPilotName && (
            <div className="mb-3 rounded-2xl border border-indigo-200 p-3" data-movil-pedido-mando="1">
              <p className="text-sm font-black">{props.pendingPilotName} pide el mando</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={ocupado} className="min-h-12 flex-1 rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => { void run(props.onAcceptPilot); }}>Aceptar</button>
                <button type="button" disabled={ocupado} className="min-h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-black" onClick={() => { void run(props.onRejectPilot); }}>No</button>
              </div>
            </div>
          )}
          {otroPiloto && props.pilotInactive && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="TOMAR_INACTIVO" className={`${btn} bg-indigo-600 text-white`} onClick={() => setConfirmando('TOMAR')}>Tomar el mando ahora · piloto sin actividad</button>
          )}
          {otroPiloto && !props.pilotInactive && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="PEDIR" className={`${btn} bg-indigo-600 text-white`} onClick={() => { void run(props.inRoom ? props.onRequestPilot : props.onTomarMando); }}>
              {props.inRoom ? 'Pedir mando' : 'Entrar como apoyo y pedir mando'}
            </button>
          )}
          {!hayPiloto && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="TOMAR" className={`${btn} border border-emerald-300 bg-white text-emerald-800`} onClick={() => { void run(props.onTomarMando); }}>Tomar mando · pasar a Manual</button>
          )}
          {props.isPilot && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="AUTO" className={`${btn} bg-rose-50 text-rose-700`} onClick={() => setConfirmando('AUTO')}>Pasar a Auto</button>
          )}
          {props.inRoom && !props.isPilot && (
            <button type="button" disabled={ocupado} data-movil-sala-accion="SALIR" className={`${btn} border border-slate-200 bg-white text-slate-700`} onClick={() => { void run(props.onSalir); }}>Salir de la sala</button>
          )}
          <p className="mt-2 text-[11px] font-bold text-slate-500">Protocolo vigente: {props.steps.join(' → ')}. Los candidatos y Convocar abren la hoja del protocolo.</p>
        </>
      )}
    </div>
  );
}

/** Hoja «Cliente → objetivos» con buscador. */
export function AmbitoSheetBody({ clientes, filtro, onElegir }: {
  clientes: readonly OpsClienteMovil[];
  filtro: OpsFiltroMovil;
  onElegir: (clientId: string | null, objectiveId: string | null) => void;
}) {
  const [texto, setTexto] = useState('');
  const [clienteAbierto, setClienteAbierto] = useState<string | null>(filtro.clientId);
  const lista = buscarClientes(clientes, texto);
  const abierto = lista.find((c) => c.id === clienteAbierto) || (lista.length === 1 ? lista[0] : null);
  return (
    <div data-movil-sheet="ambito">
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="Buscar cliente u objetivo"
          aria-label="Buscar cliente u objetivo"
          className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold"
        />
      </div>
      <button
        type="button"
        onClick={() => onElegir(null, null)}
        className={`mb-2 min-h-12 w-full rounded-2xl text-sm font-black ${!filtro.clientId && !filtro.objectiveId ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
      >
        Todos los clientes
      </button>
      {!abierto && lista.map((c) => (
        <button
          key={c.id}
          type="button"
          data-movil-cliente={c.id}
          onClick={() => setClienteAbierto(c.id)}
          className="mb-1.5 flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 text-left"
        >
          <span className="truncate text-sm font-black text-slate-800">{c.name}</span>
          <span className="shrink-0 text-[11px] font-bold text-slate-500">{c.objetivos.length} obj · {c.turnos}</span>
        </button>
      ))}
      {abierto && (
        <>
          <div className="mb-1.5 flex items-center gap-2">
            {lista.length > 1 && (
              <button type="button" onClick={() => setClienteAbierto(null)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black">←</button>
            )}
            <p className="truncate text-sm font-black text-slate-800">{abierto.name}</p>
          </div>
          <button
            type="button"
            data-movil-cliente-todo={abierto.id}
            onClick={() => onElegir(abierto.id, null)}
            className={`mb-1.5 min-h-12 w-full rounded-2xl text-sm font-black ${filtro.clientId === abierto.id && !filtro.objectiveId ? 'bg-indigo-600 text-white' : 'border border-indigo-200 bg-indigo-50 text-indigo-800'}`}
          >
            Todo {abierto.name} · {abierto.turnos}
          </button>
          {abierto.objetivos.map((o) => (
            <button
              key={o.id}
              type="button"
              data-movil-objetivo={o.id}
              onClick={() => onElegir(abierto.id, o.id)}
              className={`mb-1.5 flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left ${filtro.objectiveId === o.id ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-800'}`}
            >
              <span className="truncate text-sm font-bold">{o.name}</span>
              <span className="shrink-0 text-[11px] font-bold opacity-70">{o.turnos}</span>
            </button>
          ))}
        </>
      )}
      {lista.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Nada coincide con «{texto}».</p>}
    </div>
  );
}

export interface MovilObjective {
  objectiveId: string;
  name: string;
  client?: string;
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

const TONE_TEXT: Record<string, string> = {
  ok: 'text-emerald-700',
  ret: 'text-orange-700',
  aus: 'text-slate-800',
  late: 'text-amber-800',
  vac: 'text-rose-700',
  plan: 'text-indigo-700',
};

/** «jueves 1 de octubre» para el subtítulo del encabezado. */
function movilFechaCorta(ms: number): string {
  return new Date(ms).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Ícono y tono de cada contador del encabezado (mismo criterio que el escritorio). */
const CONTADOR_UI: Record<Exclude<OpsEstadoFiltro, 'TODOS'>, { icon: LucideIcon; tone: MovilTone }> = {
  ACTIVOS: { icon: UserCheck, tone: 'emerald' },
  PLAN: { icon: CalendarClock, tone: 'indigo' },
  NO_LLEGO: { icon: Clock, tone: 'amber' },
  AUSENTES: { icon: UserX, tone: 'slate' },
  VACANTES: { icon: AlertTriangle, tone: 'rose' },
  RETENIDOS: { icon: Hourglass, tone: 'orange' },
};

function BigButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone?: 'go' | 'pri' | 'warn';
  onClick: () => void;
}) {
  const cls = tone === 'go'
    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
    : tone === 'pri'
      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
      : tone === 'warn'
        ? 'bg-orange-50 text-orange-800 border border-orange-100'
        : 'bg-slate-50 text-slate-700 border border-slate-100';
  return (
    <button type="button" onClick={onClick} className={`min-h-12 flex-1 rounded-xl text-[11px] font-black active:scale-95 ${cls}`}>
      {label}
    </button>
  );
}

/** Botón LLAMAR con el teléfono del legajo. Sin teléfono queda deshabilitado. */
export function LlamarButton({ telefono, compact = false }: { telefono: string | null; compact?: boolean }) {
  const cls = telefono
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-slate-200 bg-slate-50 text-slate-400';
  return (
    <a
      href={telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : undefined}
      aria-disabled={telefono ? undefined : 'true'}
      aria-label={telefono ? `Llamar a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-llamar={telefono ? '1' : '0'}
      className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-[11px] font-black shadow-sm ${compact ? 'w-12' : 'px-3'} ${cls}`}
      onClick={telefono ? undefined : (event) => event.preventDefault()}
    >
      <Phone size={16} strokeWidth={2.2} aria-hidden="true" />
      {!compact && (telefono ? 'Llamar' : 'Sin tel.')}
    </a>
  );
}

/** Botón WhatsApp (wa.me) con el teléfono del legajo normalizado a +549. */
export function WhatsAppButton({ telefono }: { telefono: string | null }) {
  const numero = telefono ? normalizeArgPhone(telefono) : '';
  const cls = numero
    ? 'border-emerald-200 bg-emerald-600 text-white'
    : 'border-slate-200 bg-slate-50 text-slate-400';
  return (
    <a
      href={numero ? `https://wa.me/${numero}` : undefined}
      target={numero ? '_blank' : undefined}
      rel={numero ? 'noopener noreferrer' : undefined}
      aria-disabled={numero ? undefined : 'true'}
      aria-label={numero ? `WhatsApp a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-whatsapp={numero ? '1' : '0'}
      className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-black shadow-sm ${cls}`}
      onClick={numero ? undefined : (event) => event.preventDefault()}
    >
      <MessageCircle size={16} strokeWidth={2.2} aria-hidden="true" />
      WhatsApp
    </a>
  );
}

/**
 * Detalle compacto del guardia: horario planificado + código, puesto y objetivo,
 * ingreso real o estado con minutos, relevo, convocatoria/cobertura.
 */
export function GuardDetalleLines({ shift, siblings = [], now, showObjective = true }: { shift: GuardShift; siblings?: readonly GuardShift[]; now?: number; showObjective?: boolean }) {
  const tone = guardTone(shift);
  const d = guardDetalle(shift, siblings, now ?? Date.now());
  return (
    <div data-movil-detalle={shift.id} className="min-w-0">
      <p className="truncate text-[11px] font-semibold text-slate-500">
        <span className="font-black uppercase text-indigo-700">{d.puesto}</span>
        {showObjective && d.objetivo ? ` · ${d.objetivo}` : ''}
      </p>
      <p className="text-[12px] font-black tabular-nums text-slate-800">
        {d.horario}
        <span className="ml-1 text-[10px] font-bold text-slate-500">· {d.code}</span>
      </p>
      {d.ingreso && <p className="truncate text-[11px] font-bold text-emerald-700">{d.ingreso}</p>}
      {d.estado && <p className={`truncate text-[11px] font-bold ${TONE_TEXT[tone]}`}>{d.estado}</p>}
      {d.relevaA && <p className="truncate text-[11px] font-semibold text-slate-600">{d.relevaA}</p>}
      {d.loReleva && <p className="truncate text-[11px] font-semibold text-slate-600">{d.loReleva}</p>}
      {d.convocatoria && <p className="truncate text-[11px] font-bold text-indigo-700">{d.convocatoria}</p>}
      {d.cobertura && <p className="truncate text-[11px] font-bold text-violet-700">{d.cobertura}</p>}
    </div>
  );
}

/** Barra de color del borde izquierdo de la tarjeta compacta, por estado. */
const BAR_CLS: Record<string, string> = {
  ok: 'bg-emerald-500',
  ret: 'bg-orange-500',
  aus: 'bg-slate-500',
  late: 'bg-amber-500',
  vac: 'bg-rose-500',
  plan: 'bg-indigo-400',
};

/** Ícono del chip de estado (fila 1, derecha). */
const ESTADO_ICON: Record<GuardEstadoCompacto, LucideIcon> = {
  activo: Clock,
  retenido: Hourglass,
  tarde: Clock,
  ausente: UserX,
  cubierto: UserCheck,
  vacante: AlertTriangle,
  plan: CalendarClock,
};

/** Ítem de la fila 2: ícono lucide + texto corto. */
function MiniItem({ icon: Icon, children, className = '', attr }: { icon: LucideIcon; children: ReactNode; className?: string; attr?: string }) {
  return (
    <span className={`flex shrink-0 items-center gap-0.5 ${className}`} data-movil-mini={attr}>
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Teléfono: ícono solo (36 px). Sin teléfono queda deshabilitado. */
function LlamarIcon({ telefono }: { telefono: string | null }) {
  return (
    <a
      href={telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : undefined}
      aria-disabled={telefono ? undefined : 'true'}
      aria-label={telefono ? `Llamar a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-llamar={telefono ? '1' : '0'}
      onClick={(event) => { event.stopPropagation(); if (!telefono) event.preventDefault(); }}
      className={`my-auto mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${telefono ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-300'}`}
    >
      <Phone size={15} strokeWidth={2.2} aria-hidden="true" />
    </a>
  );
}

/**
 * Tarjeta compacta del guardia (2 filas, ~56 px): fila 1 nombre + código + chip de estado;
 * fila 2 íconos (puesto, horario, ingreso, tope, relevo). Tocar la tarjeta abre la hoja de
 * acciones; el detalle largo (retención, relevo, cobertura) vive en la hoja.
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
  /** Abre la hoja de acciones del turno (ingreso, salida, ausente, llegó, liberar, protocolo, llamar). */
  onAcciones?: (shift: GuardShift) => void;
}) {
  const c = guardCompacto(shift, siblings, now ?? Date.now());
  const visual = toneForGuard(c.tone);
  const EstadoIcon = ESTADO_ICON[c.estado.kind];
  const abrir = readOnly ? null : (onAcciones ?? onProtocolo ?? null);
  const Fila = abrir ? 'button' : 'div';
  return (
    <article
      className={`mb-1.5 flex items-stretch overflow-hidden rounded-2xl border bg-white shadow-sm ${c.tone === 'vac' ? 'border-rose-200' : 'border-slate-100'}`}
      data-movil-tone={c.tone}
      data-movil-card="compacta"
    >
      <span aria-hidden="true" className={`w-1 shrink-0 ${BAR_CLS[c.tone]}`} />
      <Fila
        {...(abrir ? { type: 'button' as const, onClick: () => abrir(shift), 'aria-label': `Acciones de ${c.nombre}` } : {})}
        data-movil-tap={abrir ? shift.id : undefined}
        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left ${abrir ? 'active:bg-slate-50' : ''}`}
      >
        <span className="flex items-center gap-1.5">
          <strong className={`truncate text-[13px] leading-5 ${c.esVacante ? 'text-rose-700' : 'text-slate-900'}`}>{c.nombre}</strong>
          <span className="shrink-0 rounded-md bg-slate-900 px-1 text-[10px] font-black leading-4 text-white">{c.code}</span>
          <span className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-black leading-4 tabular-nums ${MOVIL_PILL[visual]}`} data-movil-estado={c.estado.kind}>
            <EstadoIcon size={11} strokeWidth={2.4} aria-hidden="true" />
            {c.estado.texto}
          </span>
        </span>
        <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[10px] font-bold leading-4 tabular-nums text-slate-500" data-movil-detalle={shift.id}>
          <MiniItem icon={MapPin} attr="puesto">{c.puesto}</MiniItem>
          <MiniItem icon={Clock} attr="horario">{c.horario}</MiniItem>
          {c.ingreso && (
            <MiniItem icon={LogIn} attr="ingreso" className={c.ingreso.tardeMin > 0 ? 'text-amber-700' : 'text-emerald-700'}>
              {c.ingreso.hhmm}{c.ingreso.tardeMin > 0 ? ` +${c.ingreso.tardeMin}′` : ''}
            </MiniItem>
          )}
          {c.tope && <MiniItem icon={Hourglass} attr="tope" className="text-orange-700">{c.tope}</MiniItem>}
          {c.relevo && <MiniItem icon={ArrowRightLeft} attr="relevo" className="text-slate-600">{c.relevo.apellido} {c.relevo.hhmm}</MiniItem>}
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
  ambitoLabel = null,
  grupos = [],
  vacioLabel = 'Sin guardias',
  onAmbito,
  onQuitarAmbito,
  onAcciones,
}: {
  empresa: string;
  modeLabel: string;
  online: boolean;
  pendingLabel: string | null;
  /** Compatibilidad: si no vienen `contadores`, se muestran estos números. */
  stats?: MovilStats;
  notices?: string[];
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
  /** Chip del cliente/objetivo elegido. */
  ambitoLabel?: string | null;
  /** Tarjetas agrupadas por objetivo cuando hay un estado activo. */
  grupos?: MovilObjective[];
  vacioLabel?: string;
  onAmbito?: () => void;
  onQuitarAmbito?: () => void;
  /** Hoja de acciones de la tarjeta. */
  onAcciones?: (shift: GuardShift) => void;
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
  const cardProps = { now: nowMs, readOnly, onLlego, onRevertir, onSalida, onProtocolo, onRetencion, onAcciones };
  const moduloLabel = readOnly ? 'Supervisión' : 'Operación';
  const vacio = 'rounded-2xl border border-slate-100 bg-white p-4 text-sm font-semibold text-slate-500 shadow-sm';
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-100 pb-24" data-movil-screen={panel} data-movil-readonly={readOnly ? '1' : undefined}>
      <MovilTopBar
        modulo={moduloLabel}
        empresa={empresa}
        online={online}
        pendingLabel={pendingLabel}
        right={readOnly ? (
          <MovilBadge tone="slate" size="md" className="bg-white/10 text-slate-200">Solo lectura</MovilBadge>
        ) : (
          <button
            type="button"
            onClick={onSala}
            aria-label={`Sala · ${modeLabel}`}
            className="flex min-h-10 items-center gap-1.5 rounded-full bg-emerald-500 pl-2.5 pr-3 text-[11px] font-black uppercase text-white shadow-sm shadow-emerald-500/30 active:scale-95"
          >
            <Radio size={14} strokeWidth={2.4} />
            {modeLabel}
          </button>
        )}
      />
      <div className="px-3 pt-3">
        {panel === 'home' && (
          <MovilHeader icon={Radio} title="Centro de Control" subtitle={online ? `${movilFechaCorta(nowMs)} · ${modeLabel}` : movilFechaCorta(nowMs)} className="mb-3" />
        )}
        {panel === 'objetivo' && (
          <div className="mb-2 flex min-h-9 items-center gap-1.5" data-movil-objetivo-header="fino">
            <button type="button" onClick={onBack} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-white text-slate-700 shadow-sm active:scale-95">
              <ArrowLeft size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <MapPin size={13} className="shrink-0 text-indigo-600" aria-hidden="true" />
            <h2 className="truncate text-[13px] font-black uppercase tracking-wide text-slate-900">{objective?.name || 'Objetivo'}</h2>
            {objective?.client && <span className="hidden min-[360px]:inline truncate text-[10px] font-bold text-slate-400">· {objective.client}</span>}
            <span className="ml-auto shrink-0 rounded-full bg-slate-900 px-2 text-[10px] font-black leading-5 text-white tabular-nums">{objective?.shifts.length ?? 0}</span>
          </div>
        )}
        {panel === 'alertas' && (
          <MovilHeader
            icon={Bell}
            title="Alertas"
            subtitle={readOnly ? 'Prioridad primero · las acciones las toma el CC' : 'Prioridad primero · la acción grande bajo el pulgar'}
            right={<MovilBadge tone={alerts.length > 0 ? 'rose' : 'emerald'} size="md">{alerts.length}</MovilBadge>}
            className="mb-3"
          />
        )}
        {panel === 'home' && (
          <>
            {notices.map((text) => (
              <p key={text} className="mb-2 flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 shadow-sm">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{text}</span>
              </p>
            ))}
            {onAmbito && (
              <div className="mb-2 flex items-center gap-1.5" data-movil-ambito={filtro.objectiveId ? 'objetivo' : filtro.clientId ? 'cliente' : 'todos'}>
                <button
                  type="button"
                  onClick={onAmbito}
                  aria-label="Filtrar por cliente u objetivo"
                  className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 text-left text-[12px] font-bold text-slate-600 shadow-sm active:bg-slate-50"
                >
                  <Search size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="truncate">{ambitoLabel ? 'Cambiar cliente u objetivo' : 'Todos los clientes y objetivos'}</span>
                </button>
                {ambitoLabel && (
                  <span className="flex min-h-12 max-w-[55%] items-center gap-1 rounded-full bg-indigo-600 pl-3 pr-1 text-[11px] font-black text-white shadow-sm shadow-indigo-600/30" data-movil-chip="ambito">
                    <span className="truncate">{ambitoLabel}</span>
                    <button type="button" onClick={onQuitarAmbito} aria-label={`Quitar filtro ${ambitoLabel}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-indigo-500">
                      <X size={15} strokeWidth={2.6} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por estado" data-movil-contadores="fila">
              {counters.map((item) => {
                const activo = filtro.estado === item.id;
                const ui = CONTADOR_UI[item.id];
                const Icon = ui.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onCounter(item.id)}
                    aria-pressed={activo}
                    aria-label={`${item.label}: ${item.value}`}
                    data-movil-contador={item.id}
                    data-movil-filtro-activo={activo ? '1' : undefined}
                    className={`flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-black tabular-nums shadow-sm active:scale-95 ${activo ? `border-transparent ring-2 ${MOVIL_RING[ui.tone]} text-slate-900` : 'border-slate-100 bg-white text-slate-600'}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${MOVIL_PILL[ui.tone]}`}>
                      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{item.corto}</span>
                    <b className="text-[13px]">{item.value}</b>
                  </button>
                );
              })}
            </div>
            {filtrando && (
              <p className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span>Mostrando <b className="text-slate-800">{etiquetaEstado(filtro.estado)}</b>{ambitoLabel ? ` · ${ambitoLabel}` : ''} · {grupos.reduce((acc, g) => acc + g.shifts.length, 0)}</span>
                <button type="button" onClick={() => onCounter(filtro.estado)} className="min-h-9 rounded-xl px-2 font-black text-indigo-700">Ver todos</button>
              </p>
            )}
            {filtrando && grupos.map((grupo) => (
              <section key={grupo.objectiveId} className="mb-3" data-movil-grupo={grupo.objectiveId}>
                <button type="button" onClick={() => onOpen(grupo.objectiveId)} className="mb-1.5 flex w-full items-center gap-2 px-1 text-left">
                  <MapPin size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="truncate text-[11px] font-black uppercase tracking-wide text-slate-600">{grupo.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-400">{grupo.client ? `${grupo.client} · ` : ''}{grupo.shifts.length}</span>
                </button>
                {grupo.shifts.map((shift) => (
                  <GuardCard key={shift.id} shift={shift} siblings={siblingsOf(shift)} {...cardProps} />
                ))}
              </section>
            ))}
            {filtrando && grupos.length === 0 && (
              <p className={vacio} data-movil-vacio="1">{vacioLabel}</p>
            )}
            {!filtrando && objectives.map((item) => {
              const pct = coveragePct(item);
              const pctTone = toneForPct(pct);
              const relevo = proximoRelevo(item.shifts, nowMs);
              return (
                <MovilCard
                  key={item.objectiveId}
                  className="mb-2"
                  icon={MapPin}
                  tone={pctTone}
                  title={item.name}
                  subtitle={item.client || 'Objetivo'}
                  badge={<MovilBadge tone={pctTone} size="md">{pct}%</MovilBadge>}
                  onClick={() => onOpen(item.objectiveId)}
                  attrs={{ 'data-movil-objetivo-card': item.objectiveId }}
                >
                  <MovilProgress pct={pct} tone={pctTone} className="mt-2.5" />
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {item.active > 0 && <MovilBadge tone="emerald">ACT {item.active}</MovilBadge>}
                    {item.retention > 0 && <MovilBadge tone="orange">RET {item.retention}</MovilBadge>}
                    {item.absent > 0 && <MovilBadge tone="slate" className="bg-slate-100 text-slate-700">AUS {item.absent}</MovilBadge>}
                    {item.vacant > 0 && <MovilBadge tone="rose">VAC {item.vacant}</MovilBadge>}
                  </div>
                  {relevo && <p className="mt-1.5 text-[11px] font-bold text-indigo-700">{relevo}</p>}
                </MovilCard>
              );
            })}
            {!filtrando && objectives.length === 0 && (
              <p className={vacio} data-movil-vacio="1">{ambitoLabel ? vacioLabel : 'Sincronizando objetivos…'}</p>
            )}
          </>
        )}
        {panel === 'objetivo' && objective && (
          objective.shifts.map((shift) => (
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
          ))
        )}
        {panel === 'alertas' && (
          <>
            {alerts.map((shift, index) => {
              const tone = guardTone(shift);
              const visual = toneForGuard(tone);
              return (
                <MovilCard key={shift.id} className="mb-2 overflow-hidden !p-0" ring={index === 0 ? visual : null} attrs={{ 'data-movil-alerta': shift.id }}>
                  <div className="flex">
                    {index === 0 && !readOnly && (
                      <button type="button" onClick={() => (tone === 'vac' ? onProtocolo(shift) : onLlego(shift))} className="flex w-[92px] shrink-0 flex-col items-center justify-center gap-1 bg-emerald-600 text-[11px] font-black text-white active:bg-emerald-700">
                        <UserCheck size={20} strokeWidth={2.4} aria-hidden="true" />
                        {tone === 'vac' ? 'Cubrir' : 'Llegó'}
                      </button>
                    )}
                    <div className="min-w-0 flex-1 p-3">
                      <div className="flex items-start gap-2.5">
                        <MovilIconBox icon={shift.isUnassigned ? ShieldAlert : UserX} tone={visual} size="sm" />
                        <div className="min-w-0 flex-1">
                          <MovilBadge tone={visual}>{guardStatusLabel(shift)}</MovilBadge>
                          <h3 className="mt-0.5 truncate text-[15px] font-black leading-tight text-slate-900">{shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Vacante'}</h3>
                        </div>
                      </div>
                      <GuardDetalleLines shift={shift} siblings={siblingsOf(shift)} now={nowMs} />
                      <div className="mt-2 flex gap-1.5">
                        {!shift.isUnassigned && <LlamarButton telefono={String(shift.phone || '').trim() || null} compact={!readOnly} />}
                        {!readOnly && (
                          <>
                            {!shift.isUnassigned && <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />}
                            <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />
                            {onAcciones && <MovilIconButton icon={MoreHorizontal} label="Más acciones" attrs={{ 'data-movil-mas-acciones': shift.id }} onClick={() => onAcciones(shift)} />}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </MovilCard>
              );
            })}
            {alerts.length === 0 && (
              <MovilCard icon={UserCheck} tone="emerald" title="Sin alertas en este momento." subtitle="Todo el plantel en orden." />
            )}
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
