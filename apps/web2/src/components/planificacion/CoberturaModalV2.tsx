/**
 * Piezas del modal de cobertura de Planificación (escritorio, v2): franja fija arriba con qué se
 * cubre, columna izquierda con los días y su estado, columna derecha con Nómina · Eventuales ·
 * Ext+Adel, una barra con texto y botón siempre rotulado, y un pie de dos botones.
 * Sin Firestore ni lógica de negocio: lo que decide quién puede cubrir sigue en la página.
 */
import React from 'react';
import { AlertTriangle, BellOff, ChevronDown, Clock, UserCheck, X } from 'lucide-react';
import { TOOLTIP_SIN_PUSH } from '@/lib/eventuales/consultaCanal.mjs';
import {
  TEXTO_CERRAR_GUARDA,
  TEXTO_NOMINA_AYUDA,
  textoAplicarMarcados,
  textoNoDisponibles,
  type AccionCobertura,
  type EstadoDiaCobertura,
  type TonoEstadoDia,
} from '@/lib/planificacion/coberturaEventualesUx';

export type CoberturaTab = 'nomina' | 'eventuales' | 'split';

const TONO_TEXTO: Record<TonoEstadoDia, string> = {
  rose: 'text-rose-700',
  emerald: 'text-emerald-700',
  violet: 'text-violet-700',
  indigo: 'text-indigo-700',
  slate: 'text-slate-400',
  amber: 'text-amber-700',
};

const TONO_PUNTO: Record<TonoEstadoDia, string> = {
  rose: 'bg-rose-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  indigo: 'bg-indigo-500',
  slate: 'bg-slate-300',
  amber: 'bg-amber-500',
};

export function CoberturaFranja(props: {
  titular: string;
  motivo: string;
  codigo: string;
  rango: string;
  diaLabel: string | null;
  cubrir: string;
  bandas?: { value: string; label: string }[];
  bandaValue?: string;
  onBanda?: (value: string) => void;
  onClose: () => void;
}) {
  const conSelector = !!props.onBanda && (props.bandas?.length || 0) > 1;
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center" data-cobertura-franja>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-black text-slate-900" data-cobertura-titular>{props.titular}</h3>
          <span className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-black text-slate-700" data-cobertura-codigo>{props.codigo}</span>
        </div>
        <p className="mt-0.5 text-xs font-bold text-slate-500">
          {props.motivo} · <span data-cobertura-rango>{props.rango}</span>
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 lg:max-w-[560px]" data-cobertura-cubrir>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-wide text-indigo-700">
            Cubrir{props.diaLabel ? ` · ${props.diaLabel}` : ''}
          </div>
          <div className="truncate text-sm font-black text-slate-900" data-cobertura-cubrir-texto>{props.cubrir}</div>
        </div>
        {conSelector && (
          <select
            value={props.bandaValue || ''}
            onChange={(e) => props.onBanda?.(e.target.value)}
            className="shrink-0 rounded-xl border border-indigo-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
            data-cobertura-banda
            aria-label="Turno a cubrir"
          >
            {props.bandas!.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        )}
      </div>
      <button type="button" onClick={props.onClose} aria-label="Cerrar" className="hidden self-start rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:block">
        <X size={18} />
      </button>
    </div>
  );
}

export type DiaFila = {
  date: string;
  /** «mar 06/10». */
  label: string;
  activo: boolean;
  seleccionado: boolean;
  estado: EstadoDiaCobertura;
  puedeQuitar: boolean;
};

export function CoberturaDias(props: {
  dias: DiaFila[];
  onSeleccionar: (date: string) => void;
  onMarcar: (date: string) => void;
  onTodos: () => void;
  onNinguno: () => void;
  onQuitar: (date: string) => void;
  aplicarMarcados: { n: number; habilitado: boolean; onClick: () => void } | null;
  completar: { texto: string; onClick: () => void } | null;
}) {
  const marcados = props.dias.filter((d) => d.activo).length;
  return (
    <div className="flex min-h-0 flex-col" data-cobertura-dias>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          Días <span className="text-slate-400">· {marcados} de {props.dias.length} marcados</span>
        </div>
        {props.dias.length > 1 && (
          <div className="flex gap-1 text-[10px] font-black">
            <button type="button" onClick={props.onTodos} className="rounded-md px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-50" data-cobertura-todos>Todos</button>
            <button type="button" onClick={props.onNinguno} className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-100" data-cobertura-ninguno>Ninguno</button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3 custom-scrollbar">
        {props.dias.map((d) => (
          <div
            key={d.date}
            className={`flex items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${d.seleccionado ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200 bg-white hover:bg-slate-50'} ${d.activo ? '' : 'opacity-60'}`}
            data-cobertura-dia={d.date}
            data-cobertura-estado={d.estado.tipo}
            data-cobertura-seleccionado={d.seleccionado ? '1' : undefined}
          >
            <input
              type="checkbox"
              checked={d.activo}
              onChange={() => props.onMarcar(d.date)}
              aria-label={`Procesar ${d.label}`}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              data-cobertura-marcar={d.date}
            />
            <button type="button" onClick={() => props.onSeleccionar(d.date)} className="min-w-0 flex-1 text-left" data-cobertura-abrir={d.date}>
              <div className="text-xs font-black text-slate-900">{d.label}</div>
              <div className={`flex items-center gap-1.5 text-[11px] font-bold ${TONO_TEXTO[d.estado.tono]}`}>
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONO_PUNTO[d.estado.tono]}`} />
                <span className="truncate">{d.estado.texto}</span>
              </div>
            </button>
            {d.puedeQuitar && (
              <button
                type="button"
                onClick={() => props.onQuitar(d.date)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                data-cobertura-quitar={d.date}
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
      {(props.aplicarMarcados || props.completar) && (
        <div className="space-y-1.5 border-t border-slate-200 px-3 py-3">
          {props.aplicarMarcados && (
            <button
              type="button"
              disabled={!props.aplicarMarcados.habilitado}
              onClick={props.aplicarMarcados.onClick}
              className="w-full rounded-xl border border-indigo-300 bg-white px-3 py-2 text-[11px] font-black text-indigo-800 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              data-cobertura-aplicar="marcados"
            >
              {textoAplicarMarcados(props.aplicarMarcados.n)}
            </button>
          )}
          {props.completar && (
            <button
              type="button"
              onClick={props.completar.onClick}
              className="w-full rounded-xl px-3 py-1.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50"
              data-cobertura-completar
            >
              {props.completar.texto}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CoberturaTabs(props: { tab: CoberturaTab; onTab: (t: CoberturaTab) => void; eventuales: boolean; split: boolean }) {
  const items: { id: CoberturaTab; label: string; visible: boolean }[] = [
    { id: 'nomina', label: 'Nómina', visible: true },
    { id: 'eventuales', label: 'Eventuales', visible: props.eventuales },
    { id: 'split', label: 'Ext + Adel', visible: props.split },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1" role="tablist" data-cobertura-tabs={props.tab}>
      {items.filter((i) => i.visible).map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          aria-selected={props.tab === i.id}
          onClick={() => props.onTab(i.id)}
          data-cobertura-tab={i.id}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${props.tab === i.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Reemplaza al switch Preguntar / Asignar directo (06/10): la acción la decide el tipo de cada fila. */
export function NominaAyuda() {
  return (
    <p className="text-[10px] font-bold text-slate-500" data-nomina-ayuda>{TEXTO_NOMINA_AYUDA}</p>
  );
}

/** Texto de lo que va a pasar y un botón que siempre dice qué hace, aunque esté deshabilitado. */
export function CoberturaBarra(props: {
  texto: string;
  detalle?: string | null;
  boton: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
  tono?: 'indigo' | 'violet' | 'slate';
  children?: React.ReactNode;
}) {
  const tono = props.tono || 'indigo';
  const caja = tono === 'violet' ? 'border-violet-200 bg-violet-50/70' : tono === 'slate' ? 'border-slate-200 bg-slate-50' : 'border-indigo-200 bg-indigo-50/70';
  return (
    <div className={`mt-2 flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center ${caja}`} data-cobertura-barra={tono}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black text-slate-900" data-cobertura-barra-texto>{props.texto}</p>
        {props.detalle && <p className="mt-0.5 text-[10px] font-bold text-slate-600">{props.detalle}</p>}
        {props.children}
      </div>
      <button
        type="button"
        disabled={!!props.disabled || !!props.busy}
        onClick={props.onClick}
        data-cobertura-accion
        className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:border disabled:border-slate-300 disabled:bg-white disabled:text-slate-500 disabled:shadow-none"
      >
        {props.busy ? 'Un momento…' : props.boton}
      </button>
    </div>
  );
}

/** Día ya cubierto por Operaciones: solo lectura. El cambio se hace en el Centro de Control. */
export function CoberturaOpsBox(props: { texto: string; detalle?: string | null }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3" data-cobertura-ops="cubierto">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-emerald-100 p-2 text-emerald-700">
          <UserCheck size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-emerald-900" data-cobertura-ops-texto>{props.texto}</p>
          {props.detalle && <p className="mt-0.5 text-[11px] font-bold text-slate-700">{props.detalle}</p>}
          <p className="mt-1 text-[10px] font-bold text-slate-500">
            Lo cubrió Operaciones. Para cambiarlo, hacelo desde Operaciones.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Estados 3 y 4 del boceto: la consulta del día elegido, en vivo. */
export function ConsultaDiaBox(props: {
  estado: EstadoDiaCobertura;
  resumen: string | null;
  abierta: boolean;
  cancelando?: boolean;
  onCancelar?: () => void;
  onOtraForma?: () => void;
}) {
  const acepto = props.estado.tipo === 'acepto';
  return (
    <div className={`mb-2 rounded-2xl border px-4 py-3 ${acepto ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50'}`} data-consulta-dia={props.estado.tipo}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-xl p-2 ${acepto ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
          {acepto ? <UserCheck size={16} /> : <Clock size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-black ${acepto ? 'text-emerald-900' : 'text-indigo-950'}`}>{props.estado.texto}</p>
          {props.resumen && <p className="mt-0.5 text-[11px] font-bold text-slate-700" data-consulta-dia-resumen>{props.resumen}</p>}
          <p className="mt-1 text-[10px] font-bold text-slate-500">
            {acepto ? 'El turno ya está escrito en el servidor: Guardar cronograma no lo pisa.' : 'Podés cerrar: el día queda en espera y la celda avisa cuando alguien acepte.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {props.abierta && props.onCancelar && (
            <button type="button" disabled={!!props.cancelando} onClick={props.onCancelar} data-consulta-dia-cancelar className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60">
              {props.cancelando ? 'Cancelando…' : 'Cancelar consulta'}
            </button>
          )}
          {props.onOtraForma && (
            <button type="button" onClick={props.onOtraForma} data-consulta-dia-otra className="rounded-xl px-3 py-1.5 text-[10px] font-black text-indigo-700 hover:bg-white">
              Cubrir de otra forma
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type CandidatoNominaFila = {
  id: string;
  nombre: string;
  /** «Libre · 142 h · 3 km». */
  meta: string;
  /** Franco · FT · Retén · ESC · REF · Libre. */
  tag: string;
  tono: 'violet' | 'amber' | 'sky' | 'emerald' | 'indigo';
  /** «se asigna directo» · «solo se consulta · franco trabajado (PIN si hace falta)». */
  nota?: string | null;
  /** `sinPush`: no tiene la app instalada. No bloquea la casilla. */
  canal?: {
    sinPush?: boolean;
  } | null;
};

const TAG_CLASES: Record<CandidatoNominaFila['tono'], string> = {
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
};

/**
 * Una fila de la Nómina. La acción la decide el tipo (`accion`): RET · libre · ESC · REF llevan el botón
 * «Asignar» (una persona por día: la elegida queda marcada y la barra dice «Asignar a X»); el franco
 * lleva casilla para consultarlo como FT. No hay switch global.
 */
export function FilaCandidatoNomina(props: {
  c: CandidatoNominaFila;
  accion: AccionCobertura;
  marcado: boolean;
  seleccionado: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onElegir: () => void;
  extra?: React.ReactNode;
}) {
  const { c } = props;
  const preguntar = props.accion === 'preguntar';
  const activo = preguntar ? props.marcado : props.seleccionado;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors ${activo ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
      data-candidato={c.id}
      data-candidato-accion={props.accion}
      data-candidato-activo={activo ? '1' : undefined}
    >
      {preguntar ? (
        <input
          type="checkbox"
          checked={activo}
          disabled={props.disabled}
          onChange={props.onToggle}
          aria-label={`Preguntar a ${c.nombre}`}
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-2 border-slate-500 bg-white accent-indigo-600 disabled:cursor-not-allowed"
          style={{ WebkitAppearance: 'auto', appearance: 'auto' }}
          data-consulta-nomina={c.id}
        />
      ) : (
        <span className={`inline-block h-4 w-4 shrink-0 rounded-full border-2 ${props.seleccionado ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'}`} aria-hidden />
      )}
      <button
        type="button"
        disabled={props.disabled}
        onClick={preguntar ? props.onToggle : props.onElegir}
        className="min-w-0 flex-1 text-left"
        data-candidato-elegir={c.id}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-black text-slate-900">{c.nombre}</span>
          {props.extra}
        </div>
        <div className="truncate text-[10px] font-bold text-slate-500">{c.meta}{c.nota ? ` · ${c.nota}` : ''}</div>
      </button>
      {preguntar && c.canal?.sinPush && (
        <span data-sin-push={c.id} title={TOOLTIP_SIN_PUSH} className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-bold text-slate-400">
          <BellOff size={12} aria-hidden />
          sin push
        </span>
      )}
      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-black ${TAG_CLASES[c.tono]}`}>{c.tag}</span>
      {!preguntar && (
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onElegir}
          data-fila-asignar={c.id}
          aria-pressed={props.seleccionado}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-black transition-colors ${props.seleccionado ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-indigo-50'} disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400`}
        >
          {props.seleccionado ? 'Elegido' : 'Asignar'}
        </button>
      )}
    </div>
  );
}

export function NoDisponiblesNomina({ rows }: { rows: { id: string; nombre: string; motivo: string }[] }) {
  if (!rows.length) return null;
  return (
    <details className="group mt-2 rounded-xl border border-slate-200 bg-slate-50" data-no-disponibles={rows.length}>
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] font-black text-slate-600 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
        {textoNoDisponibles(rows.length)}
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <ul className="space-y-1 px-3 pb-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500" data-no-disponible={r.id}>
            <span className="truncate text-slate-700">{r.nombre}</span>
            <span className="shrink-0">{r.motivo}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AvisoCobertura({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900" data-cobertura-aviso>
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function CoberturaPie(props: { accion: string; accionDisabled?: boolean; onAccion: () => void; onCerrar: () => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-5 py-3 sm:flex-row sm:items-center" data-cobertura-pie>
      <p className="min-w-0 flex-1 text-[10px] font-bold text-slate-500">{props.hint || TEXTO_CERRAR_GUARDA}</p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={props.onCerrar} data-cobertura-cerrar className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50">
          Cerrar
        </button>
        <button
          type="button"
          disabled={!!props.accionDisabled}
          onClick={props.onAccion}
          data-cobertura-principal
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white shadow-lg hover:bg-indigo-700 disabled:cursor-not-allowed disabled:border disabled:border-slate-300 disabled:bg-white disabled:text-slate-500 disabled:shadow-none"
        >
          {props.accion}
        </button>
      </div>
    </div>
  );
}
