import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { eventoEtiqueta, type TurnoMovil } from '@/lib/movil/planificacionBasica';
import {
  AVISO_MES_SIN_PUBLICAR,
  DIAS_CORTOS,
  apellidoCorto,
  direccionSwipe,
  etiquetaSemana,
  type CeldaSemana,
  type FilaSemana,
  type OpsClienteMovil,
  type SeleccionPlan,
  buscarClientes,
} from '@/lib/movil/planificacionSemana';
import { esJornada12h } from '@/lib/planificacion/cierre12h';
import { MOVIL_BORDER, MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_PRIMARY_BG, MOVIL_PRIMARY_BORDER, MOVIL_PRIMARY_TEXT, MOVIL_TEXT } from './ui/tones';
import { MovilBadge } from './ui/MovilBadge';

export type PanelPlanificacion = 'semana' | 'dias';

/** Pestañas Semana / Próximos días: chips rectangulares con borde; la elegida rellena con el color de la empresa. */
export function PestanasPlanificacion({ panel, onPanel, huecos }: { panel: PanelPlanificacion; onPanel: (p: PanelPlanificacion) => void; huecos: number }) {
  const chip = (id: PanelPlanificacion, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onPanel(id)}
      aria-pressed={panel === id}
      data-plan-pestana={id}
      className={`min-h-9 flex-1 rounded border text-[12px] font-semibold tabular-nums ${panel === id ? `${MOVIL_PRIMARY_BG} border-transparent` : `${MOVIL_BTN_SECONDARY}`}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2 px-3 pt-3">
      {chip('semana', 'Semana')}
      {chip('dias', huecos > 0 ? `Próximos días · ${huecos}` : 'Próximos días')}
    </div>
  );
}

/** Selector cliente → objetivo con buscador (hoja inferior). Recuerda el último en el contenedor. */
export function SelectorObjetivoSheetBody({ clientes, seleccion, onElegir }: {
  clientes: OpsClienteMovil[];
  seleccion: SeleccionPlan;
  onElegir: (clientId: string, objectiveId: string) => void;
}) {
  const [filtro, setFiltro] = useState('');
  const lista = buscarClientes(clientes, filtro);
  return (
    <div data-plan-selector="1">
      <label className={`mb-3 flex min-h-11 items-center gap-2 rounded border ${MOVIL_BORDER} bg-white px-3 focus-within:border-[var(--movil-primary,#111827)]`}>
        <Search size={15} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden="true" />
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar cliente u objetivo"
          aria-label="Buscar cliente u objetivo"
          className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
        />
      </label>
      {lista.length === 0 && <p className="py-6 text-center text-[12px] font-medium text-slate-400">Sin resultados.</p>}
      {lista.map((cliente) => (
        <section key={cliente.id} className="mb-2" data-plan-cliente={cliente.id}>
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{cliente.name}</p>
          {cliente.objetivos.map((obj) => {
            const on = seleccion?.objectiveId === obj.id;
            return (
              <button
                key={obj.id}
                type="button"
                onClick={() => onElegir(cliente.id, obj.id)}
                aria-pressed={on}
                data-plan-objetivo={obj.id}
                className={`mb-1 flex min-h-11 w-full items-center rounded border px-3 text-left text-[13px] font-semibold ${on ? `${MOVIL_PRIMARY_BORDER} ${MOVIL_PRIMARY_TEXT} bg-white` : `${MOVIL_BORDER} bg-white text-slate-900`}`}
              >
                <span className="min-w-0 flex-1 truncate">{obj.name}</span>
                {on && <span className="text-[10px] font-bold uppercase tracking-wide">Elegido</span>}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function diaNumero(fecha: string): string {
  return String(Number(fecha.slice(8, 10)));
}

function Celda({ celda, hoy, onClick, marca, onMarca, sinHuecos }: {
  celda: CeldaSemana;
  hoy: string;
  onClick: () => void;
  marca?: { texto: string; tooltip: string } | null;
  onMarca?: () => void;
  sinHuecos?: boolean;
}) {
  const esHueco = celda.kind === 'hueco' && !sinHuecos;
  const sinServicio = celda.kind === 'sin-servicio';
  const asignados = celda.guardias.filter((g) => !g.vacante);
  const doce = esJornada12h(celda.fila.code, celda.fila.hours) && asignados.length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sinServicio}
      data-plan-celda={`${celda.fila.id}|${celda.fecha}`}
      data-plan-estado={sinHuecos && celda.kind === 'hueco' ? 'libre' : celda.kind}
      data-jornada-12={doce ? '1' : undefined}
      aria-label={`${celda.fila.positionName} ${celda.fila.code} ${celda.fecha}: ${esHueco ? `${celda.faltan} hueco` : asignados.map((g) => g.employeeName).join(', ') || 'sin servicio'}`}
      className={`relative flex min-h-12 flex-col items-start justify-center overflow-hidden rounded border px-1 py-1 text-left ${doce ? 'border-red-800 bg-red-600' : `bg-white ${MOVIL_BORDER}`} ${celda.fecha === hoy ? 'border-slate-400' : ''} disabled:bg-[#f7f8fa]`}
    >
      {esHueco && <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${MOVIL_FILETE.rose}`} />}
      {sinServicio && <span className="block w-full text-center text-[10px] font-medium text-slate-300">—</span>}
      {asignados.map((g) => (
        <span key={g.id} className={`block w-full truncate pl-0.5 text-[9px] font-semibold leading-3 ${doce ? 'text-white' : 'text-slate-900'}`}>{apellidoCorto(g.employeeName)}</span>
      ))}
      {esHueco && (
        <span className={`block w-full truncate pl-0.5 text-[9px] font-bold uppercase leading-3 ${MOVIL_TEXT.rose}`}>
          {celda.faltan > 1 ? `${celda.faltan} huecos` : 'Hueco'}
        </span>
      )}
      {marca ? (
        <span
          data-consulta-celda="1"
          title={marca.tooltip}
          className="block w-full truncate text-[7px] font-black leading-none text-indigo-700"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMarca?.(); }}
        >
          {marca.texto}
        </span>
      ) : null}
    </button>
  );
}

export function SemanaGrilla(props: {
  lunes: string;
  dias: string[];
  hoy: string;
  filas: FilaSemana[];
  celdas: CeldaSemana[][];
  licencias: TurnoMovil[];
  /** Guardias del plantel afectados a un evento (EV del servidor): solo lectura. */
  eventos?: TurnoMovil[];
  onAnterior: () => void;
  onSiguiente: () => void;
  onCelda: (celda: CeldaSemana) => void;
  onLicencia: (turno: TurnoMovil) => void;
  sinEstructura?: string | null;
  marcaConsulta?: (fecha: string, positionName: string) => { texto: string; tooltip: string } | null;
  onConsulta?: (fecha: string, positionName: string) => void;
  sinHuecos?: boolean;
}) {
  const eventos = props.eventos || [];
  const touch = useRef<{ x: number; y: number } | null>(null);
  return (
    <section
      data-plan-semana={props.lunes}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }}
      onTouchEnd={(e) => {
        const start = touch.current;
        const t = e.changedTouches[0];
        touch.current = null;
        if (!start || !t) return;
        const dir = direccionSwipe(t.clientX - start.x, t.clientY - start.y);
        if (dir === 'siguiente') props.onSiguiente();
        else if (dir === 'anterior') props.onAnterior();
      }}
      className="px-3"
    >
      <div className="flex min-h-10 items-center gap-1">
        <button type="button" onClick={props.onAnterior} aria-label="Semana anterior" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded ${MOVIL_BTN_SECONDARY}`}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <p className="flex-1 text-center text-[13px] font-semibold tabular-nums text-slate-900" data-plan-etiqueta="1">{etiquetaSemana(props.lunes)}</p>
        <button type="button" onClick={props.onSiguiente} aria-label="Semana siguiente" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded ${MOVIL_BTN_SECONDARY}`}>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {props.dias.map((fecha, i) => (
          <div key={fecha} className="text-center" data-plan-dia={fecha}>
            <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-500">{DIAS_CORTOS[i]}</span>
            <span className={`block text-[13px] font-semibold tabular-nums ${fecha === props.hoy ? MOVIL_PRIMARY_TEXT : 'text-slate-900'}`}>{diaNumero(fecha)}</span>
          </div>
        ))}
      </div>
      {props.sinEstructura && <p className="mt-3 text-[12px] font-medium text-amber-600">{props.sinEstructura}</p>}
      {props.filas.map((fila, r) => (
        <div key={fila.id} className="mt-3" data-plan-fila={fila.id}>
          <div className="mb-1 flex items-center gap-2 px-0.5">
            <MovilBadge outline className={esJornada12h(fila.code, fila.hours) ? '!border-red-800 !bg-red-600 !text-white' : ''} attrs={esJornada12h(fila.code, fila.hours) ? { 'data-jornada-12': '1' } : undefined}>{fila.code}</MovilBadge>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">{fila.positionName}</span>
            <span className="text-[11px] font-medium tabular-nums text-slate-500">{fila.start && fila.end ? `${fila.start}–${fila.end}` : ''}{fila.qty > 1 ? ` · ×${fila.qty}` : ''}</span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {props.celdas[r].map((celda) => (
              <Celda
                key={celda.fecha}
                celda={celda}
                hoy={props.hoy}
                marca={props.marcaConsulta?.(celda.fecha, celda.fila.positionName) || null}
                onMarca={() => props.onConsulta?.(celda.fecha, celda.fila.positionName)}
                onClick={() => props.onCelda(celda)}
                sinHuecos={props.sinHuecos}
              />
            ))}
          </div>
        </div>
      ))}
      {props.licencias.length > 0 && (
        <div className="mt-3" data-plan-fila="licencias">
          <p className="mb-1 px-0.5 text-[12px] font-semibold text-slate-900">Licencias</p>
          <div className="grid grid-cols-7 gap-1">
            {props.dias.map((fecha) => {
              const del = props.licencias.filter((l) => l.date === fecha);
              return (
                <div key={fecha} className="flex flex-col gap-1">
                  {del.length === 0 && <span className={`block min-h-12 rounded border ${MOVIL_BORDER} bg-[#f7f8fa]`} />}
                  {del.map((l) => (
                    <button key={l.id} type="button" onClick={() => props.onLicencia(l)} data-plan-licencia={l.id} className={`relative flex min-h-12 flex-col justify-center overflow-hidden rounded border ${MOVIL_BORDER} bg-white px-1 text-left`}>
                      {!l.coveredBy && <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${MOVIL_FILETE.rose}`} />}
                      <span className="block truncate pl-0.5 text-[9px] font-semibold leading-3 text-slate-900">{apellidoCorto(l.employeeName)}</span>
                      <span className={`block truncate pl-0.5 text-[9px] font-bold uppercase leading-3 ${l.coveredBy ? 'text-slate-500' : MOVIL_TEXT.rose}`}>{l.code}{l.coveredBy ? '' : ' · s/cubrir'}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {eventos.length > 0 && (
        <div className="mt-3" data-plan-fila="eventos">
          <p className="mb-1 px-0.5 text-[12px] font-semibold text-slate-900">Eventos</p>
          <div className="grid grid-cols-7 gap-1">
            {props.dias.map((fecha) => {
              const del = eventos.filter((e) => e.date === fecha);
              return (
                <div key={fecha} className="flex flex-col gap-1">
                  {del.length === 0 && <span className={`block min-h-12 rounded border ${MOVIL_BORDER} bg-[#f7f8fa]`} />}
                  {del.map((e) => (
                    <div
                      key={e.id}
                      data-plan-evento={e.id}
                      data-plan-evento-franco={e.francoUsado ? '1' : undefined}
                      title={eventoEtiqueta(e)}
                      aria-label={`${e.employeeName}: evento ${eventoEtiqueta(e)}${e.francoUsado ? ' (franco usado)' : ''}`}
                      className={`relative flex min-h-12 flex-col justify-center overflow-hidden rounded border ${MOVIL_BORDER} bg-white px-1 text-left`}
                    >
                      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${MOVIL_FILETE.amber}`} />
                      <span className="block truncate pl-0.5 text-[9px] font-semibold leading-3 text-slate-900">{apellidoCorto(e.employeeName)}</span>
                      <span className={`block truncate pl-0.5 text-[9px] font-bold uppercase leading-3 ${MOVIL_TEXT.amber}`}>EV{e.francoUsado ? ' · F usado' : ''}</span>
                      <span className="block truncate pl-0.5 text-[8px] font-medium leading-3 text-slate-500">{e.evento?.nombre}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** Selector + estado del mes + contadores. */
export function SemanaEncabezado(props: {
  clienteNombre: string | null;
  objetivoNombre: string | null;
  onSelector: () => void;
  publicado: boolean | null;
  publicadoPor?: string | null;
  huecos: number;
  ocultarHuecos?: boolean;
  cambios: number;
  mesLabel: string;
}) {
  const estado = props.publicado === null ? null : props.publicado ? 'Publicado' : 'Sin publicar';
  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={props.onSelector}
        data-plan-abrir-selector="1"
        className={`flex min-h-12 w-full items-center gap-2 px-3 text-left ${MOVIL_CARD} focus-visible:border-[var(--movil-primary,#111827)]`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-slate-500">{props.clienteNombre || 'Elegí el cliente'}</span>
          <span className="block truncate text-[14px] font-semibold text-slate-900">{props.objetivoNombre || 'Elegí el objetivo'}</span>
        </span>
        <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden="true" />
      </button>
      {props.objetivoNombre && (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold tabular-nums" data-plan-estado-mes={estado || ''}>
          <span className="text-slate-500">{props.mesLabel}</span>
          {estado && <span className={estado === 'Publicado' ? MOVIL_TEXT.emerald : MOVIL_TEXT.amber}>{estado}{estado === 'Publicado' && props.publicadoPor ? ` · ${props.publicadoPor}` : ''}</span>}
          <span className="flex-1" />
          {!props.ocultarHuecos && <span className={`rounded border px-1.5 leading-5 ${props.huecos > 0 ? `border-slate-300 ${MOVIL_TEXT.rose}` : 'border-slate-300 text-slate-500'}`} data-plan-huecos={props.huecos}>{props.huecos} hueco{props.huecos === 1 ? '' : 's'}</span>}
          {props.cambios > 0 && <span className={`rounded border px-1.5 leading-5 ${MOVIL_PRIMARY_BG} border-transparent`} data-plan-cambios={props.cambios}>{props.cambios} sin guardar</span>}
        </div>
      )}
    </div>
  );
}

/** Aviso fijo de solo lectura: el mes no está publicado y el celular no publica ni guarda borradores. */
export function AvisoSoloLectura({ fijo = true, texto = AVISO_MES_SIN_PUBLICAR }: { fijo?: boolean; texto?: string }) {
  return (
    <div className={fijo ? 'fixed bottom-16 left-0 right-0 z-40 mx-auto w-full max-w-[390px] px-3' : ''} data-plan-solo-lectura="1">
      <p className={`relative overflow-hidden px-3 py-2.5 pl-4 text-[12px] font-semibold ${MOVIL_CARD} ${MOVIL_TEXT.amber}`}>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${MOVIL_FILETE.amber}`} />
        {texto}
      </p>
    </div>
  );
}

/**
 * Barra fija de acción. El celular no publica meses: con el mes publicado y cambios pendientes
 * ofrece «Publicar corrección» (permiso `correct`); con el mes sin publicar muestra el aviso de solo lectura.
 */
export function BarraPublicar(props: {
  cambios: number;
  publicado: boolean | null;
  puedeCorregir: boolean;
  onGuardar: () => void;
  aviso?: string;
}) {
  if (props.publicado === null) return null;
  if (!props.publicado) return <AvisoSoloLectura texto={props.aviso} />;
  if (props.cambios === 0) return null;
  const n = `${props.cambios} cambio${props.cambios === 1 ? '' : 's'}`;
  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 mx-auto w-full max-w-[390px] px-3">
      <button type="button" disabled={!props.puedeCorregir} onClick={props.onGuardar} data-plan-publicar="correccion" className={`min-h-12 w-full rounded text-[13px] font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
        {props.puedeCorregir ? `Publicar corrección · ${n}` : 'Falta permiso para corregir'}
      </button>
    </div>
  );
}

/**
 * Hoja de la celda: guardias asignados (toque = acciones) y botón para cubrir el hueco.
 * Con `soloLectura` (mes sin publicar) solo lista y muestra el aviso: nada se toca desde el celular.
 */
export function CeldaSheetBody(props: {
  celda: CeldaSemana;
  soloLectura?: boolean;
  onGuardia: (turno: TurnoMovil) => void;
  onCubrir: () => void;
}) {
  const asignados = props.celda.guardias.filter((g) => !g.vacante);
  const fila = (g: TurnoMovil) => (
    <>
      <MovilBadge outline>{g.code}</MovilBadge>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-900">{g.employeeName}</span>
        <span className="block text-[11px] font-medium tabular-nums text-slate-500">{g.start}–{g.end} · {g.hours} h</span>
      </span>
      {!props.soloLectura && <ChevronRight size={15} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" />}
    </>
  );
  return (
    <div data-plan-celda-hoja="1" data-plan-celda-solo-lectura={props.soloLectura ? '1' : undefined}>
      <p className="mb-2 text-[11px] font-medium text-slate-500">
        {props.celda.fila.positionName} · {props.celda.fila.code} {props.celda.fila.start}–{props.celda.fila.end} · {props.celda.cupo} lugar{props.celda.cupo === 1 ? '' : 'es'}
      </p>
      {asignados.map((g) => (props.soloLectura ? (
        <div key={g.id} data-plan-guardia={g.id} className={`mb-2 flex min-h-12 w-full items-center gap-2 px-3 text-left ${MOVIL_CARD}`}>{fila(g)}</div>
      ) : (
        <button key={g.id} type="button" onClick={() => props.onGuardia(g)} data-plan-guardia={g.id} className={`mb-2 flex min-h-12 w-full items-center gap-2 px-3 text-left ${MOVIL_CARD}`}>{fila(g)}</button>
      )))}
      {props.celda.faltan > 0 && !props.soloLectura && (
        <button type="button" onClick={props.onCubrir} data-plan-cubrir="1" className={`min-h-12 w-full rounded text-[13px] font-semibold ${MOVIL_BTN_PRIMARY}`}>
          Cubrir {props.celda.faltan > 1 ? `${props.celda.faltan} huecos` : 'el hueco'}
        </button>
      )}
      {props.celda.faltan > 0 && props.soloLectura && (
        <p className={`text-[12px] font-medium ${MOVIL_TEXT.rose}`}>{props.celda.faltan > 1 ? `${props.celda.faltan} huecos` : 'Un hueco'} sin cubrir.</p>
      )}
      {props.celda.faltan === 0 && asignados.length === 0 && <p className="text-[12px] font-medium text-slate-400">Sin lugares vendidos ese día.</p>}
      {props.soloLectura && <div className="mt-2"><AvisoSoloLectura fijo={false} /></div>}
    </div>
  );
}
