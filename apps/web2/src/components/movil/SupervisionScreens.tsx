import { ArrowLeft, Camera, ClipboardCheck, MapPin, Navigation } from 'lucide-react';
import {
  horaCortaAr,
  textoSinVisita,
  textoVisita,
  tonoResultado,
  VISITA_RESULTADOS,
  type SupervisionAlertas,
  type SupervisionCliente,
  type SupervisionRow,
  type SupervisionVisitaLite,
} from '@/lib/movil/supervisionMovil';
import { MovilBadge } from './ui/MovilBadge';
import { MovilCard } from './ui/MovilCard';
import { MovilTopBar } from './ui/MovilTopBar';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_TEXT } from './ui/tones';

export type SupervisionPanel = 'objetivos' | 'alertas';

const CHIP = 'min-h-8 shrink-0 rounded-md border px-2.5 text-[12px] font-medium';
const CHIP_OFF = `${CHIP} border-slate-300 bg-white text-slate-700`;
const CHIP_ON = `${CHIP} border-transparent ${MOVIL_PRIMARY_BG}`;
const BTN = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold active:bg-slate-50';

export interface SupervisionScreensProps {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  panel: SupervisionPanel;
  fechaLabel: string;
  loading: boolean;
  clientes: SupervisionCliente[];
  clienteId: string;
  onCliente: (id: string) => void;
  buscar: string;
  onBuscar: (value: string) => void;
  rows: SupervisionRow[];
  row: SupervisionRow | null;
  /** Visitas del objetivo abierto (más nueva primero). */
  visitasObjetivo: SupervisionVisitaLite[];
  onOpen: (objectiveId: string) => void;
  onBack: () => void;
  onMarcarVisita: () => void;
  onNovedad: () => void;
  alertas: SupervisionAlertas;
  diasLimite: number;
  nowMs: number;
  onNovedadVista?: (id: string) => void;
}

/** Pantallas de Supervisión (lista, detalle y alertas). Sin acciones sobre turnos. */
export function SupervisionScreens(props: SupervisionScreensProps) {
  const vista = props.row ? 'detalle' : props.panel;
  return (
    <div
      data-movil-screen={`supervision-${vista}`}
      data-viewport="390x844"
      className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`}
    >
      <MovilTopBar modulo="Supervisión" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      {props.row ? (
        <DetalleHeader row={props.row} onBack={props.onBack} />
      ) : (
        <p className="h-5 px-3 pt-1 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">
          {props.fechaLabel} · {props.panel === 'alertas' ? 'Alertas de la recorrida' : 'Recorrida'}
        </p>
      )}
      <div className="flex flex-1 flex-col gap-2 px-3 pt-2">
        {vista === 'objetivos' && <Lista {...props} />}
        {vista === 'detalle' && props.row && <Detalle {...props} row={props.row} />}
        {vista === 'alertas' && <Alertas {...props} />}
      </div>
    </div>
  );
}

function DetalleHeader({ row, onBack }: { row: SupervisionRow; onBack: () => void }) {
  return (
    <div className="flex h-11 items-center gap-2 px-3 pt-1" data-movil-objetivo-header="fino">
      <button type="button" onClick={onBack} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 active:bg-slate-50">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-900">{row.name}</p>
        <p className="truncate text-[11px] text-slate-500">{row.clientName}</p>
      </div>
      <span className={`shrink-0 text-[11px] font-semibold ${MOVIL_TEXT[row.tono]}`} data-supervision-estado={row.tono}>{row.estadoTexto}</span>
    </div>
  );
}

function Lista(props: SupervisionScreensProps) {
  return (
    <>
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5" data-supervision-clientes={String(props.clientes.length)}>
        <button type="button" onClick={() => props.onCliente('')} aria-pressed={!props.clienteId} className={props.clienteId ? CHIP_OFF : CHIP_ON}>
          Todos
        </button>
        {props.clientes.map((c) => (
          <button key={c.id} type="button" onClick={() => props.onCliente(c.id)} aria-pressed={props.clienteId === c.id} className={props.clienteId === c.id ? CHIP_ON : CHIP_OFF}>
            {c.name}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={props.buscar}
        onChange={(event) => props.onBuscar(event.target.value)}
        placeholder="Buscar objetivo o dirección"
        className={`h-9 w-full ${MOVIL_CARD} px-3 text-base outline-none focus:border-[var(--movil-primary,#111827)]`}
      />
      {props.rows.map((row) => (
        <MovilCard
          key={row.id}
          ring={row.tono}
          title={row.name}
          subtitle={`${row.clientName}${row.address ? ` · ${row.address}` : ''}`}
          onClick={() => props.onOpen(row.id)}
          attrs={{ 'data-supervision-objetivo': row.id, 'data-supervision-estado': row.tono }}
        >
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
            <span className={`font-semibold ${MOVIL_TEXT[row.tono]}`}>{row.estadoTexto}</span>
            <span className={`truncate ${row.diasSinVisita === null || row.diasSinVisita >= props.diasLimite ? 'text-amber-600' : 'text-slate-500'}`} data-supervision-visita={row.diasSinVisita === null ? 'nunca' : String(row.diasSinVisita)}>
              {row.visitaTexto}
            </span>
          </div>
        </MovilCard>
      ))}
      {!props.loading && props.rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-slate-500">{props.buscar || props.clienteId ? 'Sin objetivos con ese filtro.' : 'Sin objetivos cargados.'}</p>
      )}
      {props.loading && props.rows.length === 0 && <p className="py-6 text-center text-[13px] text-slate-500">Cargando objetivos…</p>}
    </>
  );
}

function Detalle(props: SupervisionScreensProps & { row: SupervisionRow }) {
  const { row } = props;
  return (
    <>
      <section className={`${MOVIL_CARD} p-3`} data-supervision-detalle={row.id}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ahora</p>
        <p className={`text-[15px] font-semibold ${MOVIL_TEXT[row.tono]}`}>{row.estadoTexto}</p>
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-slate-700">
          <MapPin size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>{row.address || 'Sin dirección cargada'}</span>
        </p>
        <div className="mt-3 flex gap-2">
          {row.mapsUrl ? (
            <a href={row.mapsUrl} target="_blank" rel="noopener noreferrer" className={`${BTN} ${MOVIL_BTN_SECONDARY}`} data-supervision-maps="1">
              <Navigation size={15} strokeWidth={1.75} aria-hidden="true" /> Cómo llegar
            </a>
          ) : (
            <span className={`${BTN} border border-slate-200 bg-white text-slate-400`}>Sin ubicación</span>
          )}
          <button type="button" onClick={props.onMarcarVisita} className={`${BTN} ${MOVIL_BTN_PRIMARY}`} data-supervision-marcar="1">
            <ClipboardCheck size={15} strokeWidth={1.75} aria-hidden="true" /> Marcar visita
          </button>
        </div>
        <button type="button" onClick={props.onNovedad} className={`${BTN} mt-2 w-full ${MOVIL_BTN_SECONDARY}`} data-supervision-novedad="1">
          <Camera size={15} strokeWidth={1.75} aria-hidden="true" /> Novedad de la visita
        </button>
      </section>
      <section className={`${MOVIL_CARD} p-3`}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Última visita</p>
          {row.diasSinVisita !== null && row.diasSinVisita >= props.diasLimite && (
            <MovilBadge tone="amber">{textoSinVisita(row.diasSinVisita, props.diasLimite)}</MovilBadge>
          )}
          {row.diasSinVisita === null && <MovilBadge tone="amber">Nunca visitado</MovilBadge>}
        </div>
        <p className="text-[13px] font-semibold text-slate-900" data-supervision-ultima={row.ultimaVisita?.id || 'none'}>{row.visitaTexto}</p>
        {props.visitasObjetivo.length > 0 && (
          <ul className="mt-2 divide-y divide-[#eceef1]">
            {props.visitasObjetivo.slice(0, 5).map((v, i) => (
              <li key={v.id || i} className="flex items-center justify-between py-1.5 text-[12px]">
                <span className="text-slate-700">{textoVisita(v, props.nowMs)}</span>
                <span className={`font-semibold ${MOVIL_TEXT[tonoResultado(v.resultado)]}`}>
                  {VISITA_RESULTADOS.find((r) => r.id === v.resultado)?.label || ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="px-1 text-[11px] text-slate-500">La supervisión no actúa sobre turnos: para ingresos, ausencias o coberturas usá Operación.</p>
    </>
  );
}

function Alertas(props: SupervisionScreensProps) {
  const { alertas } = props;
  return (
    <>
      <section>
        <h2 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sin visita hace {props.diasLimite} días o más</h2>
        <div className="flex flex-col gap-2" data-supervision-sin-visita={String(alertas.sinVisita.length)}>
          {alertas.sinVisita.map(({ row, dias }) => (
            <MovilCard key={row.id} ring={dias === null ? 'rose' : 'amber'} title={row.name} subtitle={row.clientName} onClick={() => props.onOpen(row.id)} attrs={{ 'data-supervision-alerta': row.id }}>
              <p className={`mt-1 text-[12px] font-semibold ${dias === null ? 'text-rose-600' : 'text-amber-600'}`}>{textoSinVisita(dias, props.diasLimite)}</p>
            </MovilCard>
          ))}
          {alertas.sinVisita.length === 0 && <p className="px-1 text-[13px] text-slate-500">Todos los objetivos visitados en los últimos {props.diasLimite} días.</p>}
        </div>
      </section>
      <section className="mt-2">
        <h2 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Novedades de supervisión</h2>
        <div className="flex flex-col gap-2" data-supervision-novedades={String(alertas.novedades.length)}>
          {alertas.novedades.map((n, i) => (
            <article key={n.id || i} className={`${MOVIL_CARD} p-3`} data-supervision-novedad-item={n.id || String(i)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{n.objectiveName || n.title || 'Novedad'}</p>
                  <p className="text-[11px] text-slate-500">{[horaCortaAr(n.createdAtMs), n.reportedBy].filter(Boolean).join(' · ')}</p>
                </div>
                {n.imageUrl && <Camera size={14} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-label="Con foto" />}
              </div>
              {n.description && <p className="mt-1 text-[13px] text-slate-700">{n.description}</p>}
              {n.imageUrl && (
                <a href={n.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={n.imageUrl} alt="Foto de la novedad" className="h-28 w-full rounded-md border border-[#eceef1] object-cover" loading="lazy" />
                </a>
              )}
              {props.onNovedadVista && n.id && (
                <button type="button" onClick={() => props.onNovedadVista?.(n.id!)} className={`mt-2 min-h-9 w-full rounded-lg text-[12px] font-semibold ${MOVIL_BTN_SECONDARY}`}>
                  Marcar como vista
                </button>
              )}
            </article>
          ))}
          {alertas.novedades.length === 0 && <p className="px-1 text-[13px] text-slate-500">Sin novedades de supervisión pendientes.</p>}
        </div>
      </section>
    </>
  );
}
