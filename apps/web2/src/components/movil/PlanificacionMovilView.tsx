import React, { useState } from 'react';
import { CalendarX2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { CandidatoMovil, FranjaMovil, TabCandidato } from '@/lib/movil/planificacionBasica';
import type { CronogramaGrupo, CronogramaItem } from '@/lib/movil/cronogramaAlertas';
import { MovilTopBar } from './ui/MovilTopBar';

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

/**
 * Alerta agrupada de Planificación: «15 objetivos sin cronograma de octubre». Se despliega a la
 * lista por objetivo, cada uno con «Publicar» (abre el planificador del mes) y «Vista».
 */
export function CronogramaSinPublicarCard({ grupo, onVista, onPublicar, abiertoInicial = false }: {
  grupo: CronogramaGrupo;
  onVista: (ids: readonly string[]) => void;
  onPublicar: (item: CronogramaItem) => void;
  abiertoInicial?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <section className="rounded-lg border border-amber-200 bg-white" data-cronograma-grupo={grupo.items.length} data-cronograma-mes={grupo.mesLabel}>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="flex min-h-12 w-full items-center gap-2 px-3 text-left">
        <span aria-hidden="true" className="h-8 w-[3px] rounded bg-amber-500" />
        <CalendarX2 size={15} strokeWidth={1.75} className="shrink-0 text-amber-600" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold text-slate-900">{grupo.titulo}</span>
        {abierto ? <ChevronUp size={15} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" />}
      </button>
      {abierto && (
        <div className="border-t border-[#eceef1] px-3 pb-2">
          <div className="flex justify-end py-1">
            <button type="button" onClick={() => onVista(grupo.ids)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700" data-cronograma-vista="todas">
              Marcar todas como vistas
            </button>
          </div>
          {grupo.items.map((item) => (
            <div key={item.id} className="flex min-h-12 items-center gap-2 border-t border-[#eceef1] py-1.5" data-cronograma-item={item.objectiveId}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">{item.objectiveName}</span>
                <span className="block text-[11px] font-medium text-slate-500">{item.corte ? `Mañana corta a las ${item.corte}` : 'Mañana no entra en operación'}</span>
              </span>
              <button type="button" onClick={() => onPublicar(item)} className="h-8 shrink-0 rounded-lg bg-[var(--movil-primary,#111827)] px-2.5 text-[11px] font-semibold text-[var(--movil-primary-text,#fff)]" data-cronograma-publicar={item.objectiveId}>
                Publicar
              </button>
              <button type="button" onClick={() => onVista([item.id])} aria-label={`Marcar como vista ${item.objectiveName}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700" data-cronograma-vista={item.id}>
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
    <div data-viewport="390x844" className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa]">
      <MovilTopBar modulo="Planificación" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      <div className="px-3 pt-1">
        <p className="h-5 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">Próximos días</p>
        {!props.mesPublicado && (
          <p className="mt-1 text-[11px] font-medium text-amber-700">Este mes sigue en borrador. La primera publicación se hace en el escritorio.</p>
        )}
      </div>
      <div className="flex gap-2 px-3 py-3">
        {props.dias.map((fecha) => {
          const d = diaCorto(fecha);
          const marcado = props.franjas.some((f) => f.date === fecha && f.kind !== 'ok');
          const on = fecha === props.dia;
          return (
            <button key={fecha} type="button" onClick={() => props.onDia(fecha)} className={`min-h-14 flex-1 rounded-lg border text-center ${on ? 'border-[var(--movil-primary,#111827)] bg-white' : 'border-slate-200 bg-white'}`}>
              <span className="block text-sm font-semibold">{d.n}</span>
              <span className="block text-[9px] font-semibold text-slate-500">{d.lab}</span>
              {marcado && <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-rose-600" />}
            </button>
          );
        })}
      </div>
      <div className="flex-1 space-y-2 px-3 pb-28">
        {(props.cronograma || []).map((grupo) => (
          <CronogramaSinPublicarCard
            key={grupo.mesLabel}
            grupo={grupo}
            onVista={(ids) => props.onCronogramaVista?.(ids)}
            onPublicar={(item) => props.onCronogramaPublicar?.(item)}
          />
        ))}
        {huecos > 0 && (
          <p className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-[11px] font-bold text-rose-800">{huecos} hueco{huecos === 1 ? '' : 's'} en estos 4 días</p>
        )}
        {[...grupos.entries()].map(([key, filas]) => (
          <section key={key} className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold">{filas[0].objectiveName || 'Objetivo'}</h2>
            <p className="text-[11px] font-semibold text-slate-500">{filas[0].positionName}</p>
            {filas.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => (f.kind === 'ok' ? props.onAsignado(f) : props.onHueco(f))}
                className="mt-2 flex min-h-14 w-full items-center gap-2 border-t border-[#eceef1] py-2 text-left"
              >
                <span className={`rounded-lg px-2 py-1 text-[11px] font-semibold text-white ${f.kind === 'vacante' ? 'bg-rose-600' : f.kind === 'licencia' ? 'bg-violet-600' : 'bg-[var(--movil-primary,#111827)]'}`}>{f.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.kind === 'vacante' ? 'Vacante' : f.employeeName}</span>
                  <span className="block text-[11px] font-semibold text-slate-500">{f.start}–{f.end}{f.kind === 'licencia' ? ' · sin cubrir' : ''}</span>
                </span>
                <span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${f.kind === 'ok' ? 'bg-white text-emerald-800' : 'bg-white text-rose-700'}`}>
                  {f.kind === 'ok' ? 'Ok' : 'Hueco'}
                </span>
              </button>
            ))}
          </section>
        ))}
        {delDia.length === 0 && <p className="py-8 text-center text-sm font-bold text-slate-400">No hay turnos cargados este día.</p>}
      </div>
      {props.porPublicar > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 mx-auto w-full max-w-[390px] px-3">
          <button
            type="button"
            disabled={!props.puedePublicar}
            onClick={props.onPublicar}
            className="min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white disabled:bg-slate-300"
          >
            {props.puedePublicar ? `Publicar ${props.porPublicar} cambio${props.porPublicar === 1 ? '' : 's'}` : 'Falta permiso para publicar'}
          </button>
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
  return (
    <div>
      <div className="mb-3 flex gap-1">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" onClick={() => props.onTab(tab.id)} className={`min-h-11 flex-1 rounded-full text-[10px] font-semibold ${props.tab === tab.id ? 'bg-[var(--movil-primary,#111827)] text-white' : 'bg-slate-100 text-slate-500'}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {props.tab === 'ft' && !props.puedeFt && <p className="text-xs font-bold text-slate-500">Hace falta el permiso de franco trabajado.</p>}
      {props.tab === 'eventuales' && !props.puedeEventuales && <p className="text-xs font-bold text-slate-500">Hace falta el permiso para convocar eventuales.</p>}
      {props.tab === 'eventuales' && props.puedeEventuales && props.eventuales.map((ev) => (
        <button key={ev.cuil} type="button" disabled={!ev.elegible} onClick={() => props.onElegir(ev.cuil)} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 text-left ${props.elegidoId === ev.cuil ? 'border-[var(--movil-primary,#111827)] bg-white' : 'border-slate-200'} disabled:opacity-60`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{ev.nombre}</span>
            <span className="block text-[11px] font-semibold text-slate-500">{ev.distanciaKm != null ? `${ev.distanciaKm} km` : 'sin distancia'} · bolsa</span>
            {ev.motivo && <span className="block text-[11px] font-bold text-rose-700">{ev.motivo}</span>}
          </span>
        </button>
      ))}
      {props.tab !== 'eventuales' && lista.map((c) => (
        <button key={c.employeeId} type="button" disabled={c.blocked || (props.tab === 'ft' && !props.puedeFt)} onClick={() => props.onElegir(c.employeeId)} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 text-left ${props.elegidoId === c.employeeId ? 'border-[var(--movil-primary,#111827)] bg-white' : 'border-slate-200'} disabled:opacity-60`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{c.name}</span>
            <span className="block text-[11px] font-semibold text-slate-500">{Math.round(c.monthHours)}/{c.cap} h{c.km != null ? ` · ${c.km} km` : ''}</span>
            {c.reason && <span className="block text-[11px] font-bold text-rose-700">{c.reason}</span>}
          </span>
        </button>
      ))}
      <button type="button" disabled={!props.elegidoId} onClick={props.onConfirmar} className="mt-2 min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white disabled:bg-slate-300">
        Confirmar
      </button>
      <p className="mt-2 text-[11px] font-semibold text-slate-400">Un toque elige. El segundo confirma.</p>
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
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Horario</p>
        <div className="grid grid-cols-5 gap-1">
          {BANDAS_UI.map((code) => (
            <button key={code} type="button" onClick={() => props.onCodigo(code)} className={`min-h-11 rounded-lg text-xs font-semibold ${props.codigo === code ? 'bg-[var(--movil-primary,#111827)] text-white' : 'bg-slate-100 text-slate-700'}`}>
              {code}
            </button>
          ))}
        </div>
        <button type="button" disabled={!props.codigo || props.bloqueado} onClick={props.onHorario} className="mt-2 min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white disabled:bg-slate-300">
          Cambiar horario
        </button>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Permuta</p>
        {props.companeros.map((c) => (
          <button key={c.id} type="button" onClick={() => props.onCompanero(c.id)} className={`mb-2 flex min-h-12 w-full items-center rounded-lg border px-3 text-left ${props.companeroId === c.id ? 'border-[var(--movil-primary,#111827)] bg-white' : 'border-slate-200'}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{c.nombre}</span>
              <span className="block text-[11px] font-semibold text-slate-500">{c.detalle}</span>
            </span>
          </button>
        ))}
        <button type="button" disabled={!props.companeroId || props.bloqueado} onClick={props.onPermuta} className="min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white disabled:bg-slate-300">
          Permutar
        </button>
      </div>
      <button type="button" onClick={props.onFranco} className="min-h-12 w-full rounded-lg border border-slate-300 text-sm font-semibold text-slate-800">
        Pasar a franco
      </button>
      {props.aviso && <p className="rounded-lg bg-white px-3 py-2 text-[11px] font-bold text-rose-800">{props.aviso}</p>}
    </div>
  );
}
