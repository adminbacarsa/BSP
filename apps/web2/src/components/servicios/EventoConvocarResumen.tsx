/**
 * Piezas de UI puras de «Convocar guardias» (EventoDetailModal): situación del día + qué va a
 * pasar, resumen en dos grupos antes de confirmar, chip de estado y caja de error con Reintentar.
 * Sin Firestore ni contextos: se renderizan en `scripts/eval-eventos-convocar.mjs`.
 */
import React from 'react';
import { AlertTriangle, Bell, CheckCircle, Clock, FlaskConical, RotateCcw, Send, TimerOff, UserCheck, Users, XCircle } from 'lucide-react';
import {
  detalleEventualUi,
  estadoSolicitudUi,
  etiquetaAccion,
  type SolicitudEventualLike,
  type TurnoEventualLike,
  explicacionAccion,
  textoBotonPlan,
  tituloGrupoConvocar,
  tituloGrupoNotificar,
  type PersonaPlan,
  type PlanConvocatoria,
  type SituacionDia,
} from '@/lib/eventos/convocatoriaPlan';

const SITUACION_CLS: Record<string, string> = {
  libre: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  RET: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  F: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  FF: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  FP: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  ESC: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  M: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  T: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  D12: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  N: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  N12: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  REF: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  V: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  L: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  E: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  A: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  EV: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
};

export function situacionCls(code: string): string {
  return SITUACION_CLS[code] || 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
}

/** Chip «Se notifica» (verde) / «Se convoca» (ámbar). */
export function AccionChip({ accion, size = 'sm' }: { accion: SituacionDia['accion']; size?: 'sm' | 'xs' }) {
  const cls = accion === 'NOTIFICAR'
    ? 'bg-emerald-600 text-white dark:bg-emerald-500'
    : accion === 'CONVOCAR'
      ? 'bg-amber-500 text-white'
      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
  const Icon = accion === 'NOTIFICAR' ? Bell : Send;
  return (
    <span
      data-accion={accion || 'NINGUNA'}
      title={explicacionAccion(accion)}
      className={`inline-flex items-center gap-1 rounded-full font-bold shrink-0 ${size === 'xs' ? 'text-[8px] px-1.5 py-0.5' : 'text-[9px] px-2 py-0.5'} ${cls}`}
    >
      {accion && <Icon size={size === 'xs' ? 8 : 9} />}
      {etiquetaAccion(accion)}
    </span>
  );
}

/** Situación del día («Libre», «RET», «M 07–15») + qué va a pasar. */
export function SituacionAccionBadges({ situacion, yaEnviado }: { situacion: SituacionDia; yaEnviado?: 'ASIGNADO' | 'CONVOCADO' | null }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0" data-situacion={situacion.code}>
      <span title={situacion.descripcion} className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${situacionCls(situacion.code)}`}>
        {situacion.label}
      </span>
      {yaEnviado ? (
        <span className="text-[9px] text-slate-500 dark:text-slate-400 shrink-0">{yaEnviado === 'ASIGNADO' ? 'Asignado (notificado)' : 'Convocado'}</span>
      ) : (
        <AccionChip accion={situacion.accion} />
      )}
    </span>
  );
}

function FilaPersona({ p }: { p: PersonaPlan }) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs" data-plan-persona={p.id}>
      <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{p.nombre}</span>
      <span title={p.situacion.descripcion} className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${situacionCls(p.situacion.code)}`}>{p.situacion.label}</span>
    </li>
  );
}

/**
 * Paso previo a confirmar: dos grupos y un solo botón cuyo texto dice exactamente qué se envía.
 */
export function ConvocatoriaResumen({
  plan,
  servicio,
  sending,
  onCancelar,
  onConfirmar,
}: {
  plan: PlanConvocatoria;
  servicio: { nombre: string; fecha: string; horario: string };
  sending: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const total = plan.notificar.length + plan.convocar.length;
  const boton = textoBotonPlan(plan);
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-convocatoria-resumen={total}>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{servicio.nombre} · {servicio.fecha} · {servicio.horario}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
          Revisá qué pasa con cada guardia antes de enviar. Libre o RET = asignación directa; el resto tiene que aceptar.
        </p>
      </div>

      {plan.notificar.length > 0 && (
        <section className="rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden" data-grupo="notificar">
          <header className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20">
            <Bell size={12} className="text-emerald-600 shrink-0" />
            <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">{tituloGrupoNotificar(plan.notificar.length)}</p>
          </header>
          <p className="px-3 pt-1.5 text-[10px] text-emerald-700/80 dark:text-emerald-400/80">Quedan asignados al evento y reciben «Fuiste asignado a…». No tienen que responder.</p>
          <ul className="divide-y divide-emerald-100 dark:divide-emerald-900/40">{plan.notificar.map((p) => <FilaPersona key={p.id} p={p} />)}</ul>
        </section>
      )}

      {plan.convocar.length > 0 && (
        <section className="rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden" data-grupo="convocar">
          <header className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20">
            <Send size={12} className="text-amber-600 shrink-0" />
            <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">{tituloGrupoConvocar(plan.convocar.length)}</p>
          </header>
          <p className="px-3 pt-1.5 text-[10px] text-amber-700/80 dark:text-amber-400/80">Reciben la convocatoria con aceptar / rechazar. Quedan «Pendiente» hasta que respondan.</p>
          <ul className="divide-y divide-amber-100 dark:divide-amber-900/40">{plan.convocar.map((p) => <FilaPersona key={p.id} p={p} />)}</ul>
        </section>
      )}

      {plan.omitidosPorCupo.length > 0 && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-start gap-1" data-grupo="omitidos">
          <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-500" />
          {plan.omitidosPorCupo.length} seleccionado{plan.omitidosPorCupo.length === 1 ? '' : 's'} no entra{plan.omitidosPorCupo.length === 1 ? '' : 'n'} en el cupo y se omite{plan.omitidosPorCupo.length === 1 ? '' : 'n'}: {plan.omitidosPorCupo.map((p) => p.nombre).join(', ')}.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          disabled={sending}
          className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={sending || total === 0}
          data-boton-plan={boton}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-200 hover:bg-slate-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-slate-900 rounded-lg text-xs font-medium transition-colors"
        >
          <Send size={11} />
          {sending ? 'Enviando…' : boton}
        </button>
      </div>
    </div>
  );
}

/** Chip de estado de una solicitud: Asignado (notificado) / Aceptó / Pendiente / Rechazó. */
export function EstadoSolicitudChip({ sol }: { sol: { status?: string; tipo?: string; esEventual?: boolean } }) {
  const ui = estadoSolicitudUi(sol);
  const cls = ui.key === 'ASIGNADO'
    ? 'text-sky-700 dark:text-sky-400'
    : ui.key === 'ACEPTO'
      ? 'text-emerald-600 dark:text-emerald-400'
      : ui.key === 'RECHAZO'
        ? 'text-rose-500'
        : ui.key === 'VENCIO' || ui.key === 'NO_VA'
          ? 'text-amber-600 dark:text-amber-400'
          : ui.key === 'CUPO_COMPLETO'
            ? 'text-slate-500 dark:text-slate-400'
            : 'text-slate-400 dark:text-slate-500';
  const Icon = ui.key === 'ASIGNADO' ? UserCheck : ui.key === 'ACEPTO' ? CheckCircle : ui.key === 'RECHAZO' ? XCircle : ui.key === 'VENCIO' || ui.key === 'NO_VA' ? TimerOff : ui.key === 'CUPO_COMPLETO' ? Users : Clock;
  return (
    <span data-estado={ui.key} title={ui.detalle} className={`inline-flex items-center gap-1 text-[10px] shrink-0 ${cls}`}>
      <Icon size={11} />
      {ui.label}
    </span>
  );
}

const DETALLE_TONO: Record<'ok' | 'pendiente' | 'neutro', string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-400',
  pendiente: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300',
  neutro: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/** Etiqueta «Pruebas: sin exigir marco» (ficha, candidatos, convocatoria). */
export function PruebasBadge({ texto = 'Pruebas: sin exigir marco', compact }: { texto?: string; compact?: boolean }) {
  return (
    <span data-pruebas="sin-marco" className={`inline-flex items-center gap-1 rounded-full border border-fuchsia-200 bg-fuchsia-50 font-black uppercase tracking-wide text-fuchsia-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-900/20 dark:text-fuchsia-300 ${compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]'}`}>
      <FlaskConical size={compact ? 9 : 10} />
      {texto}
    </span>
  );
}

/**
 * Línea de detalle de un eventual en «Estado convocatoria»: Eventual · Pruebas · Anexo · ARCA.
 * Sin anexo/ARCA mientras no aceptó.
 */
export function EventualEstadoLinea({ sol, turno }: { sol: SolicitudEventualLike; turno?: TurnoEventualLike | null }) {
  if (!sol.esEventual) return null;
  const d = detalleEventualUi(sol, turno);
  return (
    <div data-eventual-detalle className="mt-1 flex flex-wrap items-center gap-1">
      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">Eventual</span>
      {d.pruebas && <PruebasBadge compact texto={d.pruebas} />}
      {d.anexo && <span data-anexo={d.anexo.tono} className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${DETALLE_TONO[d.anexo.tono]}`}>{d.anexo.label}</span>}
      {d.arca && <span data-arca={d.arca.tono} className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${DETALLE_TONO[d.arca.tono]}`}>{d.arca.label}</span>}
    </div>
  );
}

export type GrupoCupoUi = { grupo: string; label: string; cupo: number; ocupados: number; completo: boolean };

/**
 * Cupo por grupo (Estado convocatoria / Cronograma / encabezado): «Hombres 12/20 · Mujeres 15/15 completo»
 * con una barra por grupo. Indistinto = un solo grupo.
 */
export function CupoGruposBarra({ grupos, compact }: { grupos: GrupoCupoUi[]; compact?: boolean }) {
  if (!grupos.length) return null;
  return (
    <div className={`grid gap-1.5 ${grupos.length > 1 ? 'sm:grid-cols-2' : ''}`} data-cupo-grupos={grupos.length}>
      {grupos.map((g) => {
        const pct = g.cupo > 0 ? Math.min(100, Math.round((g.ocupados / g.cupo) * 100)) : 0;
        const label = grupos.length > 1 ? g.label : 'Cupo';
        return (
          <div key={g.grupo} data-cupo-grupo={g.grupo} data-cupo-completo={g.completo ? '1' : '0'} className="min-w-0">
            <div className={`flex items-center justify-between gap-2 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
              <span className="font-bold text-slate-600 dark:text-slate-300 truncate">{label}</span>
              <span className={`shrink-0 tabular-nums ${g.completo ? 'font-black text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {g.ocupados}/{g.cupo}{g.completo ? ' · completo' : ''}
              </span>
            </div>
            <div className={`mt-0.5 w-full ${compact ? 'h-1' : 'h-1.5'} rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden`}>
              <div className={`h-full rounded-full transition-all ${g.completo ? 'bg-emerald-500' : 'bg-yellow-400'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Encabezado de un grupo de candidatos («Hombres 12/20») en Convocar guardias. */
export function GrupoCandidatosHeader({ grupo, cantidad }: { grupo: GrupoCupoUi; cantidad: number }) {
  return (
    <div data-grupo-candidatos={grupo.grupo} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-y border-slate-200 dark:border-slate-700">
      <span className="text-[10px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1">
        <Users size={10} />
        {grupo.label} <span className="font-medium normal-case text-slate-400">({cantidad})</span>
      </span>
      <span className={`text-[10px] tabular-nums ${grupo.completo ? 'font-black text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {grupo.ocupados}/{grupo.cupo}{grupo.completo ? ' · completo' : ''}
      </span>
    </div>
  );
}

/** Aviso para los candidatos sin género cargado cuando el servicio tiene cupo por género. */
export function SinEspecificarAviso({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null;
  return (
    <div data-grupo-candidatos="SIN_ESPECIFICAR" className="flex items-start gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-y border-amber-200 dark:border-amber-800">
      <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-600" />
      <p className="text-[10px] text-amber-800 dark:text-amber-300">
        <span className="font-black">Sin especificar ({cantidad})</span> · Sin género en el legajo: no cuentan para ningún cupo hasta que se cargue. Completá el legajo para convocarlos.
      </p>
    </div>
  );
}

/** Error entendible + Reintentar (reemplaza el «INTERNAL» crudo). */
export function ErrorCallableBox({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
      <span className="flex-1">{mensaje}</span>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-slate-900 dark:border-rose-700"
        >
          <RotateCcw size={10} />
          Reintentar
        </button>
      )}
    </div>
  );
}
