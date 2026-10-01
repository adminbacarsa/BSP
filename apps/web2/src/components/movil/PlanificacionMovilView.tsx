import React, { useState, type ReactNode } from 'react';
import { CalendarX2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { CandidatoMovil, FranjaMovil, TabCandidato } from '@/lib/movil/planificacionBasica';
import type { CronogramaGrupo, CronogramaItem } from '@/lib/movil/cronogramaAlertas';
import { MovilTopBar } from './ui/MovilTopBar';
import { MovilBadge } from './ui/MovilBadge';
import { MOVIL_BORDER, MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_PRIMARY_BORDER, MOVIL_TEXT } from './ui/tones';
import { PestanasPlanificacion, type PanelPlanificacion } from './PlanificacionSemanaView';

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
  elegible: boolean;
};

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
 * lista por objetivo, cada uno con «Publicar» (abre ese objetivo y mes en la semana) y «Vista».
 */
export function CronogramaSinPublicarCard({ grupo, onVista, onPublicar, abiertoInicial = false }: {
  grupo: CronogramaGrupo;
  onVista: (ids: readonly string[]) => void;
  onPublicar: (item: CronogramaItem) => void;
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
              <button type="button" onClick={() => onPublicar(item)} className={`h-8 shrink-0 rounded px-2.5 text-[11px] font-semibold ${MOVIL_BTN_PRIMARY}`} data-cronograma-publicar={item.objectiveId}>
                Publicar
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
  porPublicar: number;
  puedePublicar: boolean;
  mesPublicado: boolean;
  /** CRONOGRAMA_SIN_PUBLICAR agrupadas por mes (pendientes). */
  cronograma?: CronogramaGrupo[];
  onCronogramaVista?: (ids: readonly string[]) => void;
  onCronogramaPublicar?: (item: CronogramaItem) => void;
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
                <CronogramaSinPublicarCard key={grupo.mesLabel} grupo={grupo} onVista={(ids) => props.onCronogramaVista?.(ids)} onPublicar={(item) => props.onCronogramaPublicar?.(item)} />
              ))}
            </div>
          )}
          {props.semana}
        </div>
      ) : (
        <div className="flex-1" data-plan-panel="dias">
          <div className="px-3 pt-3">
            <p className="text-[11px] font-medium text-slate-500" data-movil-fecha="1">Próximos días</p>
            {!props.mesPublicado && <p className={`mt-1 text-[11px] font-semibold ${MOVIL_TEXT.amber}`}>Hay meses en borrador: los cambios se guardan sin avisar al guardia hasta publicar.</p>}
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
              <CronogramaSinPublicarCard key={grupo.mesLabel} grupo={grupo} onVista={(ids) => props.onCronogramaVista?.(ids)} onPublicar={(item) => props.onCronogramaPublicar?.(item)} />
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
                      <span className="block truncate text-sm font-semibold text-slate-900">{f.kind === 'vacante' ? 'Vacante' : f.employeeName}</span>
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
                disabled={!props.puedePublicar}
                onClick={props.onPublicar}
                className={`min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}
              >
                {props.puedePublicar ? `${props.mesPublicado ? 'Publicar corrección' : 'Guardar borrador'} · ${props.porPublicar} cambio${props.porPublicar === 1 ? '' : 's'}` : 'Falta permiso para guardar'}
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
}) {
  const lista = props.candidatos.filter((c) => c.tab === props.tab);
  const fila = (on: boolean, disabled: boolean, onClick: () => void, key: string, children: ReactNode, attrs: Record<string, string>) => (
    <button key={key} type="button" disabled={disabled} onClick={onClick} aria-pressed={on} {...attrs} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded border bg-white px-3 text-left ${on ? MOVIL_PRIMARY_BORDER : MOVIL_BORDER} disabled:opacity-60`}>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
  return (
    <div data-plan-candidatos={props.tab}>
      <div className="mb-3 flex gap-1">
        {TABS.map((tab) => <Chip key={tab.id} on={props.tab === tab.id} onClick={() => props.onTab(tab.id)} attrs={{ 'data-plan-tab': tab.id }}>{tab.label}</Chip>)}
      </div>
      {props.tab === 'ft' && !props.puedeFt && <p className="text-xs font-medium text-slate-500">Hace falta el permiso de franco trabajado.</p>}
      {props.tab === 'eventuales' && !props.puedeEventuales && <p className="text-xs font-medium text-slate-500">Hace falta el permiso para convocar eventuales.</p>}
      {props.tab === 'eventuales' && props.puedeEventuales && props.eventuales.map((ev) => fila(props.elegidoId === ev.cuil, !ev.elegible, () => props.onElegir(ev.cuil), ev.cuil, (
        <>
          <span className="block text-sm font-semibold text-slate-900">{ev.nombre}</span>
          <span className="block text-[11px] font-medium tabular-nums text-slate-500">{ev.distanciaKm != null ? `${ev.distanciaKm} km` : 'sin distancia'} · bolsa</span>
          {ev.motivo && <span className={`block text-[11px] font-semibold ${MOVIL_TEXT.rose}`}>{ev.motivo}</span>}
        </>
      ), { 'data-plan-candidato': ev.cuil }))}
      {props.tab !== 'eventuales' && lista.map((c) => fila(props.elegidoId === c.employeeId, c.blocked || (props.tab === 'ft' && !props.puedeFt), () => props.onElegir(c.employeeId), c.employeeId, (
        <>
          <span className="block text-sm font-semibold text-slate-900">{c.name}</span>
          <span className="block text-[11px] font-medium tabular-nums text-slate-500">{Math.round(c.monthHours)}/{c.cap} h{c.km != null ? ` · ${c.km} km` : ''}</span>
          {c.reason && <span className={`block text-[11px] font-semibold ${MOVIL_TEXT.rose}`} data-plan-conflicto={c.employeeId}>{c.reason}</span>}
        </>
      ), { 'data-plan-candidato': c.employeeId }))}
      {props.tab !== 'eventuales' && lista.length === 0 && <p className="py-4 text-center text-[12px] font-medium text-slate-400">Sin candidatos en esta pestaña.</p>}
      <button type="button" disabled={!props.elegidoId} onClick={props.onConfirmar} data-plan-confirmar="1" className={`mt-2 min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
        Confirmar
      </button>
      <p className="mt-2 text-[11px] font-medium text-slate-400">Un toque elige. El segundo confirma.</p>
    </div>
  );
}

const BANDAS_UI = ['M', 'T', 'N', 'D12', 'N12'] as const;

export function CambioPuntual(props: {
  codigo: string | null;
  onCodigo: (code: string) => void;
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
        <div className="flex gap-1">
          {BANDAS_UI.map((code) => <Chip key={code} on={props.codigo === code} onClick={() => props.onCodigo(code)} attrs={{ 'data-plan-codigo': code }}>{code}</Chip>)}
        </div>
        <button type="button" disabled={!props.codigo || props.bloqueado} onClick={props.onHorario} data-plan-horario="1" className={`mt-2 min-h-12 w-full rounded text-sm font-semibold ${MOVIL_BTN_PRIMARY} disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500`}>
          Cambiar horario
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
