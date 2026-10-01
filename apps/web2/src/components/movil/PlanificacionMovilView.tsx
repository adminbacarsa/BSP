import React from 'react';
import type { CandidatoMovil, FranjaMovil, TabCandidato } from '@/lib/movil/planificacionBasica';

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

export function PlanificacionMovilView(props: {
  empresa: string;
  online: boolean;
  pendingLabel: string | null;
  dias: string[];
  dia: string;
  franjas: FranjaMovil[];
  porPublicar: number;
  puedePublicar: boolean;
  mesPublicado: boolean;
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
    <div data-viewport="390x844" className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col bg-slate-100">
      <header className="bg-white px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-base font-black text-slate-900">Próximos días</p>
            <p className="text-xs font-semibold text-slate-500">{props.empresa}</p>
          </div>
          <span className={`rounded-xl px-2 py-1 text-[10px] font-black uppercase ${props.online ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            {props.online ? 'En línea' : 'Sin señal'}
          </span>
        </div>
        {props.pendingLabel && (
          <p className="mt-2 rounded-xl bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-800">Pendiente de enviar: {props.pendingLabel}</p>
        )}
        {!props.mesPublicado && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">Este mes sigue en borrador. La primera publicación se hace en el escritorio.</p>
        )}
      </header>
      <div className="flex gap-2 px-3 py-3">
        {props.dias.map((fecha) => {
          const d = diaCorto(fecha);
          const marcado = props.franjas.some((f) => f.date === fecha && f.kind !== 'ok');
          const on = fecha === props.dia;
          return (
            <button key={fecha} type="button" onClick={() => props.onDia(fecha)} className={`min-h-14 flex-1 rounded-2xl border text-center ${on ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
              <span className="block text-sm font-black">{d.n}</span>
              <span className="block text-[9px] font-black text-slate-500">{d.lab}</span>
              {marcado && <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-rose-600" />}
            </button>
          );
        })}
      </div>
      <div className="flex-1 space-y-2 px-3 pb-28">
        {huecos > 0 && (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800">{huecos} hueco{huecos === 1 ? '' : 's'} en estos 4 días</p>
        )}
        {[...grupos.entries()].map(([key, filas]) => (
          <section key={key} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="text-sm font-black">{filas[0].objectiveName || 'Objetivo'}</h2>
            <p className="text-[11px] font-semibold text-slate-500">{filas[0].positionName}</p>
            {filas.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => (f.kind === 'ok' ? props.onAsignado(f) : props.onHueco(f))}
                className="mt-2 flex min-h-14 w-full items-center gap-2 border-t border-slate-100 py-2 text-left"
              >
                <span className={`rounded-lg px-2 py-1 text-[11px] font-black text-white ${f.kind === 'vacante' ? 'bg-rose-600' : f.kind === 'licencia' ? 'bg-violet-600' : 'bg-slate-900'}`}>{f.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">{f.kind === 'vacante' ? 'Vacante' : f.employeeName}</span>
                  <span className="block text-[11px] font-semibold text-slate-500">{f.start}–{f.end}{f.kind === 'licencia' ? ' · sin cubrir' : ''}</span>
                </span>
                <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${f.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
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
            className="min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white disabled:bg-slate-300"
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
          <button key={tab.id} type="button" onClick={() => props.onTab(tab.id)} className={`min-h-11 flex-1 rounded-full text-[10px] font-black ${props.tab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {props.tab === 'ft' && !props.puedeFt && <p className="text-xs font-bold text-slate-500">Hace falta el permiso de franco trabajado.</p>}
      {props.tab === 'eventuales' && !props.puedeEventuales && <p className="text-xs font-bold text-slate-500">Hace falta el permiso para convocar eventuales.</p>}
      {props.tab === 'eventuales' && props.puedeEventuales && props.eventuales.map((ev) => (
        <button key={ev.cuil} type="button" disabled={!ev.elegible} onClick={() => props.onElegir(ev.cuil)} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded-2xl border px-3 text-left ${props.elegidoId === ev.cuil ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'} disabled:opacity-60`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black">{ev.nombre}</span>
            <span className="block text-[11px] font-semibold text-slate-500">{ev.distanciaKm != null ? `${ev.distanciaKm} km` : 'sin distancia'} · bolsa</span>
            {ev.motivo && <span className="block text-[11px] font-bold text-rose-700">{ev.motivo}</span>}
          </span>
        </button>
      ))}
      {props.tab !== 'eventuales' && lista.map((c) => (
        <button key={c.employeeId} type="button" disabled={c.blocked || (props.tab === 'ft' && !props.puedeFt)} onClick={() => props.onElegir(c.employeeId)} className={`mb-2 flex min-h-14 w-full items-center gap-2 rounded-2xl border px-3 text-left ${props.elegidoId === c.employeeId ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'} disabled:opacity-60`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black">{c.name}</span>
            <span className="block text-[11px] font-semibold text-slate-500">{Math.round(c.monthHours)}/{c.cap} h{c.km != null ? ` · ${c.km} km` : ''}</span>
            {c.reason && <span className="block text-[11px] font-bold text-rose-700">{c.reason}</span>}
          </span>
        </button>
      ))}
      <button type="button" disabled={!props.elegidoId} onClick={props.onConfirmar} className="mt-2 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white disabled:bg-slate-300">
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
        <p className="mb-2 text-[11px] font-black uppercase text-slate-500">Horario</p>
        <div className="grid grid-cols-5 gap-1">
          {BANDAS_UI.map((code) => (
            <button key={code} type="button" onClick={() => props.onCodigo(code)} className={`min-h-11 rounded-xl text-xs font-black ${props.codigo === code ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              {code}
            </button>
          ))}
        </div>
        <button type="button" disabled={!props.codigo || props.bloqueado} onClick={props.onHorario} className="mt-2 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white disabled:bg-slate-300">
          Cambiar horario
        </button>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-black uppercase text-slate-500">Permuta</p>
        {props.companeros.map((c) => (
          <button key={c.id} type="button" onClick={() => props.onCompanero(c.id)} className={`mb-2 flex min-h-12 w-full items-center rounded-2xl border px-3 text-left ${props.companeroId === c.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{c.nombre}</span>
              <span className="block text-[11px] font-semibold text-slate-500">{c.detalle}</span>
            </span>
          </button>
        ))}
        <button type="button" disabled={!props.companeroId || props.bloqueado} onClick={props.onPermuta} className="min-h-12 w-full rounded-2xl bg-slate-900 text-sm font-black text-white disabled:bg-slate-300">
          Permutar
        </button>
      </div>
      <button type="button" onClick={props.onFranco} className="min-h-12 w-full rounded-2xl border border-slate-300 text-sm font-black text-slate-800">
        Pasar a franco
      </button>
      {props.aviso && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800">{props.aviso}</p>}
    </div>
  );
}
