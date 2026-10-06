import React, { useState, type ReactNode } from 'react';
import { CalendarX2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { CandidatoMovil, FranjaMovil, TabCandidato } from '@/lib/movil/planificacionBasica';
import { AVISO_MES_SIN_PUBLICAR, type OpcionTurno } from '@/lib/movil/planificacionSemana';
import type { CronogramaGrupo, CronogramaItem } from '@/lib/movil/cronogramaAlertas';
import { MovilTopBar } from './ui/MovilTopBar';
import { MovilBadge } from './ui/MovilBadge';
import { MOVIL_BORDER, MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_PRIMARY_BORDER, MOVIL_TEXT } from './ui/tones';
import { PestanasPlanificacion, type PanelPlanificacion } from './PlanificacionSemanaView';
import { PuntajeChip } from '@/components/desempeno/PuntajeChip';

const TABS: { id: TabCandidato | 'eventuales'; label: string }[] = [
  { id: 'plantel', label: 'Plantel' },
  { id: 'otros', label: 'Otros' },
  { id: 'eventuales', label: 'Eventuales' },
  { id: 'ft', label: 'FT' },
];

export type EventualMovil = {
  cuil: string;
  nombre: string;
  distanciaKm: number | null;
  motivo: string | null;
  motivoCodigo?: string | null;
  elegible: boolean;
  horasMes?: { usadas: number; tope: number; texto: string; aviso: boolean; cerca?: boolean; alcanzado?: boolean } | null;
  canal?: { chip: string | null; motivo: string | null; sinCanal: boolean; porMail: boolean } | null;
};

/** Igual a `esOcultoPorTope` del motor: cerca del tope o lo pasa con este turno → no se ofrece. */
export function eventualOcultoPorTope(ev: Pick<EventualMovil, 'motivoCodigo'>): boolean {
  return ev.motivoCodigo === 'TOPE_HORAS' || ev.motivoCodigo === 'TOPE_CERCA';
}
export const textoOcultosPorTopeMovil = (n: number) => (n === 1 ? '1 eventual oculto por tope de horas' : `${n} eventuales ocultos por tope de horas`);

function diaCorto(fecha: string): { n: string; lab: string } {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 15));
  const lab = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' }).format(dt).replace('.', '').slice(0, 3).toUpperCase();
  return { n: String(d), lab };
}

/** Chip rectangular con borde; el elegido se rellena con el color de la empresa. */
function Chip({ on, onClick, children, disabled, attrs }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; attrs?: Record<string, string> }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} {...attrs} className={`min-h-10 flex-1 rounded border text-[11px] font-semibold ${on ? `${MOVIL_PRIMARY_BG} border-transparent` : MOVIL_BTN_SECONDARY} disabled:opacity-50`}>
      {children}
    </button>
  );
}

/**
 * Alerta agrupada de Planificación: «15 objetivos sin cronograma de octubre». Se despliega a la
 * lista por objetivo, cada uno con «Ver semana» (abre ese objetivo y mes en solo lectura: el celular
 * no publica, se publica desde la computadora) y «Vista».
 */
export function CronogramaSinPublicarCard({ grupo, onVista, onAbrir, abiertoInicial = false }: {
  grupo: CronogramaGrupo;
  onVista: (ids: readonly string[]) => void;
  onAbrir: (item: CronogramaItem) => void;
  abiertoInicial?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <section className={`relative overflow-hidden ${MOVIL_CARD}`} data-cronograma-grupo={grupo.items.length} data-cronograma-mes={grupo.mesLabel}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${MOVIL_FILETE.amber}`} />
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="flex min-h-12 w-full items-center gap-2 pl-4 pr-3 text-left">
        <CalendarX2 size={15} strokeWidth={1.75} className="shrink-0 text-slate-700" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold text-slate-900">{grupo.titulo}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide ${MOVIL_TEXT.amber}`}>Sin publicar</span>
        {abierto ? <ChevronUp size={15} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" />}
      </button>
      {abierto && (
        <div className={`border-t ${MOVIL_BORDER} pb-2 pl-4 pr-3`}>
          <div className="flex justify-end py-1">
            <button type="button" onClick={() => onVista(grupo.ids)} className={`h-8 rounded px-2 text-[11px] font-semibold ${MOVIL_BTN_SECONDARY}`} data-cronograma-vista="todas">
              Marcar todas como vistas
            </button>
          </div>
          {grupo.items.map((item) => (
            <div key={item.id} className={`flex min-h-12 items-center gap-2 border-t ${MOVIL_BORDER} py-1.5`} data-cronograma-item={item.objectiveId}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">{item.objectiveName}</span>
                <span className="block text-[11px] font-medium text-slate-500">{item.corte ? `Mañana corta a las ${item.corte}` : 'Mañana no entra en operación'}</span>
              </span>
              <button type="button" onClick={() => onAbrir(item)} className={`h-8 shrink-0 rounded px-2.5 text-[11px] font-semibold ${MOVIL_BTN_SECONDARY}`} data-cronograma-abrir={item.objectiveId}>
                Ver semana
              </button>
              <button type="button" onClick={() => onVista([item.id])} aria-label={`Marcar como vista ${item.objectiveName}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${MOVIL_BTN_SECONDARY}`} data-cronograma-vista={item.id}>
                <Check size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PlanificacionMovilView(props: {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  panel: PanelPlanificacion;
  onPanel: (panel: PanelPlanificacion) => void;
  /** Contenido de la pestaña Semana (encabezado + grilla). */
  semana?: ReactNode;
  dias: string[];
  dia: string;
  franjas: FranjaMovil[];
  /** Cambios locales pendientes de «Publicar corrección» (solo meses publicados). */
  porPublicar: number;
  /** Permiso `correct`: el único que escribe desde el celular. */
  puedeCorregir: boolean;
  /** false = algún mes de estos días no está publicado: se muestra el aviso de solo lectura. */
  mesPublicado: boolean;
  /** CRONOGRAMA_SIN_PUBLICAR agrupadas por mes (pendientes). */
  cronograma?: CronogramaGrupo[];
  onCronogramaVista?: (ids: readonly string[]) => void;
  /** Abre ese objetivo y mes en la semana (solo lectura si no está publicado). */
  onCronogramaAbrir?: (item: CronogramaItem) => void;
  onDia: (dia: string) => void;
  onHueco: (franja: FranjaMovil) => void;
  onAsignado: (franja: FranjaMovil) => void;
  onPublicar: () => void;
}) {
  const delDia = props.franjas.filter((f) => f.date === props.dia);
  const grupos = new Map<string, FranjaMovil[]>();
  for (const f of delDia) {
    const key = `${f.objectiveId}|${f.positionName}`;
    const list = grupos.get(key) || [];
    list.push(f);
    grupos.set(key, list);
  }
  const huecos = props.franjas.filter((f) => f.kind !== 'ok').length;
  return (
    <div data-viewport="390x844" className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] ${MOVIL_FONT}`}>
      <MovilTopBar modulo="Planificación" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      <PestanasPlanificacion panel={props.panel} onPanel={props.onPanel} huecos={huecos} />
      {props.panel === 'semana' ? (
        <div className="flex-1 pb-32" data-plan-panel="semana">
          {(props.cronograma || []).length > 0 && (
            <div className="space-y-2 px-3 pt-3">
              {(props.cronograma || []).map((grupo) => (
                <CronogramaSinPublicarCard key={grupo.mesLabel} grupo={grupo} onVista={(ids) => props.onCronogramaVista?.(ids)} onAbrir={(item) => props.onCronogramaAbrir?.(item)} />
              ))}
            </div>
          )}
          {props.semana}
        </div>
      ) : (
        <div className="flex-1" data-plan-panel="dias">
          <div className="px-3 pt-3">
            <p className="text-[11px] font-medium text-slate-500" data-movil-fecha="1">Próximos días</p>
            {!props.mesPublicado && <p className={`mt-1 text-[11px] font-semibold ${MOVIL_TEXT.amber}`} data-plan-solo-lectura="dias">{AVISO_MES_SIN_PUBLICAR}</p>}
          </div>
          <div className="flex gap-2 px-3 py-3">
            {props.dias.map((fecha) => {
              const d = diaCorto(fecha);
              const marcado = props.franjas.some((f) => f.date === fecha && f.kind !== 'ok');
              const on = fecha === props.dia;
              return (
                <button key={fecha} type="button" onClick={() => props.onDia(fecha)} aria-pressed={on} className={`min-h-14 flex-1 rounded border text-center ${on ? `${MOVIL_PRIMARY_BORDER} bg-white` : `${MOVIL_BORDER} bg-white`}`}>
                  <span className="block text-sm font-semibold tabular-nums">{d.n}</span>
                  <span className="block text-[9px] font-semibold text-slate-500">{d.lab}</span>
                  {marcado && <span className={`block text-[9px] font-bold uppercase ${MOVIL_TEXT.rose}`}>Hueco</span>}
                </button>
              );
            })}
          </div>
          <div className="space-y-2 px-3 pb-28">
            {(props.cronograma || []).map((grupo) => (
              <CronogramaSinPublicarCard key={grupo.mesLabel} grupo={grupo} onVista={(ids) => props.onCronogramaVista?.(ids)} onAbrir={(item) => props.onCronogramaAbrir?.(item)} />
            ))}
            {huecos > 0 && (
              <p className={`px-3 py-2 text-[11px] font-semibold ${MOVIL_CARD} ${MOVIL_TEXT.rose}`}>{huecos} hueco{huecos === 1 ? '' : 's'} en estos 4 días</p>
            )}
            {[...grupos.entries()].map(([key, filas]) => (
              <section key={key} className={`p-3 ${MOVIL_CARD}`}>
                <h2 className="text-sm font-semibold text-slate-900">{filas[0].objectiveName || 'Objetivo'}</h2>
                <p className="text-[11px] font-medium text-slate-500">{filas[0].positionName}</p>
                {filas.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => (f.kind === 'ok' ? props.onAsignado(f) : props.onHueco(f))}
                    className={`relative mt-2 flex min-h-14 w-full items-center gap-2 overflow-hidden border-t ${MOVIL_BORDER} py-2 pl-2 text-left`}
                  >
                    {f.kind !== 'ok' && <span aria-hidden="true" className={`absolute inset-y-2 left-0 w-[3px] ${MOVIL_FILETE.rose}`} />}
                    <MovilBadge outline>{f.code}</MovilBadge>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1"><span className="block truncate text-sm font-semibold text-slate-900">{f.kind === 'vacante' ? 'Vacante' : f.employeeName}</span>{f.kind !== 'vacante' && <PuntajeChip sujetoId={f.employeeId} />}</span>
                      <span className="block text-[11px] font-medium tabular-nums text-slate-500">{f.start}–{f.end}{f.kind === 'licencia' ? ' · sin cubrir' : ''}</span>
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${f.kind === 'ok' ? 'text-slate-500' : MOVIL_TEXT.rose}`}>
                      {f.kind === 'ok' ? 'Ok' : 'Hueco'}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {delDia.length === 0 && <p className="py-8 text-center text-sm font-medium text-slate-400">No hay turnos cargados este día.</p>}
          </div>
          {props.porPublicar > 0 && (
            <div className="fixed bottom-16 left-0 right-0 z-40 mx-auto w-full max-w-[390px] px-3">
              <button
                type="button"
                disabled={!props.puedeCorregir}
                onClick={props.onPublicar}
                data-plan-publicar="correccion"
                className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}
              >
                {props.puedeCorregir ? `Publicar corrección · ${props.porPublicar} cambio${props.porPublicar === 1 ? '' : 's'}` : 'Falta permiso para corregir'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CandidatosHueco(props: {
  tab: TabCandidato | 'eventuales';
  onTab: (tab: TabCandidato | 'eventuales') => void;
  candidatos: CandidatoMovil[];
  eventuales: EventualMovil[];
  elegidoId: string | null;
  puedeFt: boolean;
  puedeEventuales: boolean;
  onElegir: (id: string) => void;
  onConfirmar: () => void;
  /** Cuiles marcados para consultar disponibilidad (solo eventuales elegibles). */
  consultaCuils?: string[];
  onToggleConsulta?: (cuil: string) => void;
  /** Cobertura de un hueco: siempre un lugar, el primero que acepte cubre. */
  onConsultar?: (cuils: string[]) => void;
  puedeAsignarEventual?: boolean;
  /** Turno del SLA que se cubre: con más de una opción el operador puede cambiarlo. */
  opciones?: OpcionTurno[];
  opcionId?: string | null;
  onOpcion?: (id: string) => void;
}) {
  const lista = props.candidatos.filter((c) => c.tab === props.tab);
  const opcion = props.opciones?.find((o) => o.id === props.opcionId) || null;
  const [verOcultosTope, setVerOcultosTope] = useState(false);
  const consultaCuils = props.consultaCuils || [];
  const ocultosTope = props.eventuales.filter(eventualOcultoPorTope);
  const eventualesBase = verOcultosTope ? props.eventuales : props.eventuales.filter((ev) => !eventualOcultoPorTope(ev));
  // Elegibles arriba; los bloqueados colapsados con su motivo.
  const eventualesVisibles = eventualesBase.filter((ev) => ev.elegible || (verOcultosTope && eventualOcultoPorTope(ev)));
  const eventualesNoDisponibles = eventualesBase.filter((ev) => !ev.elegible && !eventualOcultoPorTope(ev));
  const fila = (on: boolean, disabled: boolean, onClick: () => void, key: string, children: ReactNode, attrs: Record<string, string>) => (
    <button key={key} type="button" disabled={disabled} onClick={onClick} aria-pressed={on} {...attrs} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded border bg-white px-3 text-left ${on ? MOVIL_PRIMARY_BORDER : MOVIL_BORDER} disabled:opacity-60`}>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
  return (
    <div data-plan-candidatos={props.tab}>
      {opcion && (
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-900" data-plan-turno-cubrir={opcion.label}>
          <span className="rounded border border-slate-300 px-1.5 text-[11px] font-bold leading-5">{opcion.code}</span>
          <span className="tabular-nums">{opcion.start}–{opcion.end}</span>
          <span className="font-medium text-slate-500">· {opcion.hours} h</span>
        </p>
      )}
      {props.opciones && props.opciones.length > 1 && props.onOpcion && (
        <details className="mb-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500">Otro turno del SLA</summary>
          <div className="mt-2"><OpcionesTurno opciones={props.opciones} elegidaId={props.opcionId ?? null} onElegir={props.onOpcion} /></div>
        </details>
      )}
      <div className="mb-3 flex gap-1">
        {TABS.map((tab) => <Chip key={tab.id} on={props.tab === tab.id} onClick={() => props.onTab(tab.id)} attrs={{ 'data-plan-tab': tab.id }}>{tab.label}</Chip>)}
      </div>
      {props.tab === 'ft' && !props.puedeFt && <p className="text-xs font-medium text-slate-500">Hace falta el permiso de franco trabajado.</p>}
      {props.tab === 'eventuales' && !props.puedeEventuales && <p className="text-xs font-medium text-slate-500">Hace falta el permiso para convocar eventuales.</p>}
      {props.tab === 'eventuales' && props.puedeEventuales && eventualesVisibles.map((ev) => fila(props.elegidoId === ev.cuil, !ev.elegible, () => props.onElegir(ev.cuil), ev.cuil, (
        <>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {ev.elegible && props.onToggleConsulta && (
              <input
                type="checkbox"
                checked={consultaCuils.includes(ev.cuil)}
                disabled={!!ev.canal?.sinCanal}
                onClick={(e) => e.stopPropagation()}
                onChange={() => { if (!ev.canal?.sinCanal) props.onToggleConsulta?.(ev.cuil); }}
                aria-label={`Consultar a ${ev.nombre}`}
                data-consulta-cuil={ev.cuil}
                className="h-4 w-4 accent-indigo-600"
              />
            )}
            {ev.nombre}<PuntajeChip sujetoId={ev.cuil} />
            {ev.canal?.chip && <span data-sin-app={ev.cuil} className="text-[11px] font-semibold text-amber-800">{ev.canal.chip}{ev.canal.motivo ? ` · ${ev.canal.motivo}` : ''}</span>}
          </span>
          <span className="block text-[11px] font-medium tabular-nums text-slate-500">{ev.distanciaKm != null ? `${ev.distanciaKm} km` : 'sin distancia'} · bolsa</span>
          {ev.horasMes && (
            <span data-horas-mes className={`block text-[11px] font-semibold tabular-nums ${ev.horasMes.aviso ? 'text-amber-700' : 'text-slate-500'}`}>
              {ev.horasMes.texto}
              {eventualOcultoPorTope(ev) && <span data-chip-tope={ev.horasMes.alcanzado ? 'alcanzado' : 'cerca'} className={`ml-1 ${ev.horasMes.alcanzado ? MOVIL_TEXT.rose : MOVIL_TEXT.amber}`}>· {ev.horasMes.alcanzado ? 'Tope alcanzado' : 'Cerca del tope'}</span>}
            </span>
          )}
          {ev.canal?.sinCanal && (
            <a href={`/admin/rrhh/eventuales/?cuil=${ev.cuil}`} data-crear-acceso={ev.cuil} onClick={(e) => e.stopPropagation()} className="block text-[11px] font-semibold text-amber-800 underline">
              No le va a llegar: llamalo o creá su acceso
            </a>
          )}
          {ev.canal?.porMail && <span data-por-mail={ev.cuil} className="block text-[11px] font-semibold text-slate-500">Le llega por mail</span>}
          {ev.motivo && <span className={`block text-[11px] font-semibold ${MOVIL_TEXT.rose}`}>{ev.motivo}</span>}
        </>
      ), { 'data-plan-candidato': ev.cuil }))}
      {props.tab === 'eventuales' && props.puedeEventuales && eventualesVisibles.length === 0 && eventualesNoDisponibles.length > 0 && (
        <p className="mb-2 text-[12px] font-medium text-slate-500" data-sin-elegibles>Nadie de la bolsa puede tomar este turno.</p>
      )}
      {props.tab === 'eventuales' && props.puedeEventuales && eventualesNoDisponibles.length > 0 && (
        <details className={`mb-2 rounded border bg-white ${MOVIL_BORDER}`} data-no-disponibles={eventualesNoDisponibles.length}>
          <summary className="min-h-10 cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-slate-600">No disponibles ({eventualesNoDisponibles.length})</summary>
          <ul className={`divide-y border-t ${MOVIL_BORDER}`}>
            {eventualesNoDisponibles.map((ev) => (
              <li key={ev.cuil} className="px-3 py-2" data-no-disponible={ev.cuil}>
                <span className="block text-[13px] font-semibold text-slate-800">{ev.nombre}</span>
                <span className={`block text-[11px] font-semibold ${MOVIL_TEXT.rose}`}>{ev.motivo || 'No elegible'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {props.tab === 'eventuales' && props.puedeEventuales && ocultosTope.length > 0 && (
        <div data-ocultos-tope={ocultosTope.length} className={`mb-2 flex min-h-10 items-center justify-between gap-2 rounded border bg-white px-3 text-[11px] font-semibold ${MOVIL_BORDER} ${MOVIL_TEXT.amber}`}>
          <span>{textoOcultosPorTopeMovil(ocultosTope.length)}</span>
          <button type="button" data-ocultos-tope-ver onClick={() => setVerOcultosTope((v) => !v)} className={`rounded border px-2 py-1 text-[11px] font-semibold ${MOVIL_BTN_SECONDARY}`}>{verOcultosTope ? 'Ocultar' : 'Ver'}</button>
        </div>
      )}
      {props.tab !== 'eventuales' && lista.map((c) => fila(props.elegidoId === c.employeeId, c.blocked || (props.tab === 'ft' && !props.puedeFt), () => props.onElegir(c.employeeId), c.employeeId, (
        <>
          <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">{c.name}<PuntajeChip sujetoId={c.employeeId} /></span>
          <span className="block text-[11px] font-medium tabular-nums text-slate-500">{Math.round(c.monthHours)}/{c.cap} h{c.km != null ? ` · ${c.km} km` : ''}</span>
          {c.reason && <span className={`block text-[11px] font-semibold ${MOVIL_TEXT.rose}`} data-plan-conflicto={c.employeeId}>{c.reason}</span>}
        </>
      ), { 'data-plan-candidato': c.employeeId }))}
      {props.tab !== 'eventuales' && lista.length === 0 && <p className="py-4 text-center text-[12px] font-medium text-slate-400">Sin candidatos en esta pestaña.</p>}
      <button type="button" disabled={!props.elegidoId || (props.tab === 'eventuales' && props.puedeAsignarEventual === false)} onClick={props.onConfirmar} data-plan-confirmar="1" className={`mt-2 min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
        Confirmar
      </button>
      {props.tab === 'eventuales' && props.onConsultar && (
        <div className="mt-2" data-consulta-bar>
          <p className="mb-1 text-[11px] font-semibold text-slate-600" data-consulta-texto>
            {consultaCuils.length > 0 ? `Preguntar a ${consultaCuils.length} · el primero que acepte cubre el turno` : 'Marcá a quién preguntar'}
          </p>
          <button
            type="button"
            disabled={consultaCuils.length === 0}
            onClick={() => props.onConsultar?.(consultaCuils)}
            data-consulta-enviar
            className={`min-h-12 w-full rounded border text-sm font-semibold ${MOVIL_BTN_SECONDARY} disabled:opacity-50`}
          >
            {consultaCuils.length > 0 ? `Enviar consulta (${consultaCuils.length})` : 'Marcá a quién preguntar'}
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] font-medium text-slate-400">Un toque elige. El segundo confirma.</p>
    </div>
  );
}

/** Turnos del SLA del puesto ese día («M2 11:00–15:00»), en lista vertical de toque grande. */
export function OpcionesTurno({ opciones, elegidaId, onElegir, actualId }: {
  opciones: OpcionTurno[];
  elegidaId: string | null;
  onElegir: (id: string) => void;
  actualId?: string | null;
}) {
  if (opciones.length === 0) return <p className="text-[12px] font-medium text-slate-400">El SLA no habilita turnos ese día.</p>;
  return (
    <div className="grid grid-cols-2 gap-1.5" data-plan-opciones={opciones.length}>
      {opciones.map((op) => {
        const on = elegidaId === op.id;
        return (
          <button
            key={op.id}
            type="button"
            onClick={() => onElegir(op.id)}
            aria-pressed={on}
            data-plan-opcion={op.label}
            className={`flex min-h-11 items-center gap-1.5 rounded border px-2 text-left ${on ? `${MOVIL_PRIMARY_BG} border-transparent` : `${MOVIL_BTN_SECONDARY}`}`}
          >
            <span className="text-[12px] font-bold">{op.code}</span>
            <span className="text-[12px] font-medium tabular-nums">{op.start}–{op.end}</span>
            {actualId === op.id && <span className="ml-auto text-[9px] font-bold uppercase tracking-wide">Actual</span>}
          </button>
        );
      })}
    </div>
  );
}

export function CambioPuntual(props: {
  /** Turnos habilitados del SLA para ese puesto y día (genéricos solo si el SLA no define). */
  opciones: OpcionTurno[];
  actualId?: string | null;
  codigo: string | null;
  onCodigo: (opcionId: string) => void;
  companeros: { id: string; nombre: string; detalle: string }[];
  companeroId: string | null;
  onCompanero: (id: string) => void;
  aviso: string | null;
  bloqueado: boolean;
  onHorario: () => void;
  onPermuta: () => void;
  onFranco: () => void;
  /** Semana: cambiar el guardia de la celda (abre candidatos). */
  onCambiarGuardia?: () => void;
  /** Semana: borrar el turno (mismo borrado físico que la grilla). */
  onBorrar?: () => void;
}) {
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  return (
    <div className="space-y-3" data-plan-cambio="1">
      {props.onCambiarGuardia && (
        <button type="button" onClick={props.onCambiarGuardia} data-plan-cambiar-guardia="1" className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_SECONDARY}`}>
          Cambiar guardia
        </button>
      )}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Código y horario</p>
        <OpcionesTurno opciones={props.opciones} elegidaId={props.codigo} onElegir={props.onCodigo} actualId={props.actualId} />
        <button type="button" disabled={!props.codigo || props.codigo === props.actualId || props.bloqueado} onClick={props.onHorario} data-plan-horario="1" className={`mt-2 min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
          Cambiar código y horario
        </button>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Permuta</p>
        {props.companeros.length === 0 && <p className="mb-2 text-[12px] font-medium text-slate-400">No hay compañeros ese día.</p>}
        {props.companeros.map((c) => (
          <button key={c.id} type="button" onClick={() => props.onCompanero(c.id)} aria-pressed={props.companeroId === c.id} className={`mb-2 flex min-h-12 w-full items-center rounded border bg-white px-3 text-left ${props.companeroId === c.id ? MOVIL_PRIMARY_BORDER : MOVIL_BORDER}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{c.nombre}</span>
              <span className="block text-[11px] font-medium tabular-nums text-slate-500">{c.detalle}</span>
            </span>
          </button>
        ))}
        <button type="button" disabled={!props.companeroId || props.bloqueado} onClick={props.onPermuta} className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
          Permutar
        </button>
      </div>
      <button type="button" onClick={props.onFranco} data-plan-franco="1" className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_SECONDARY}`}>
        Pasar a franco
      </button>
      {props.onBorrar && (
        confirmaBorrar ? (
          <button type="button" onClick={props.onBorrar} data-plan-borrar="confirmar" className={`min-h-12 w-full rounded border border-slate-300 bg-white text-sm font-semibold ${MOVIL_TEXT.rose}`}>
            Confirmar borrado
          </button>
        ) : (
          <button type="button" onClick={() => setConfirmaBorrar(true)} data-plan-borrar="1" className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_SECONDARY}`}>
            Borrar turno
          </button>
        )
      )}
      {props.aviso && <p className={`px-3 py-2 text-[11px] font-semibold ${MOVIL_CARD} ${MOVIL_TEXT.rose}`} data-plan-aviso="1">{props.aviso}</p>}
    </div>
  );
}
