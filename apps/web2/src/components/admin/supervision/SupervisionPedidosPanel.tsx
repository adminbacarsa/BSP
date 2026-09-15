import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Ban, Calendar, CheckCircle, MessageSquare, Pencil, Trash2, User, XCircle,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { formatRefuerzoOrigenCanal } from '@/lib/servicios/slaModificaciones';
import {
  fmtTs, hoursSincePending, pendingHoursLabel, URGENCY_STYLES, urgencyLevel,
} from '@/lib/supervision/supervisionUtils';
import {
  buildPlanificacionHref,
  canLinkToPlanificacion,
  pedidoDetalleResumen,
  pedidoEstadoLabel,
  pedidoFechaDisplay,
  pedidoKind,
  PEDIDO_ESTADO_STYLES,
  PEDIDO_KIND_STYLES,
  type SupervisionPedidosView,
} from '@/lib/supervision/supervisionPedidos';

function ParentShiftInfo({ parentShiftId }: { parentShiftId?: string }) {
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    if (!parentShiftId) return;
    getDoc(doc(db, 'turnos', parentShiftId)).then(snap => {
      if (!snap.exists()) { setInfo(null); return; }
      const d = snap.data();
      setInfo(`${d.code || '?'} · ${d.employeeName || '—'}`);
    }).catch(() => setInfo(null));
  }, [parentShiftId]);
  if (!info) return null;
  return <span className="text-xs text-slate-400 font-medium">({info})</span>;
}

function PlanificacionLink({ solicitud, compact = false }: { solicitud: SolicitudRefuerzo; compact?: boolean }) {
  if (!canLinkToPlanificacion(solicitud.estado)) return null;
  const href = buildPlanificacionHref(solicitud);
  return (
    <Link
      href={href}
      title="Abrir planificación en el mes del pedido"
      className={`inline-flex items-center gap-1 font-black uppercase text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors ${
        compact
          ? 'px-2 py-1 text-[9px]'
          : 'px-2.5 py-1.5 text-[10px] border border-indigo-200 dark:border-indigo-800'
      }`}
    >
      <Calendar size={compact ? 10 : 11} />
      {compact ? 'Plan' : 'Ver planificación'}
    </Link>
  );
}

function isRefuerzoPuntualGestionable(s: SolicitudRefuerzo): boolean {
  if (s.alcance === 'ESTRUCTURAL' || s.slaApplied) return false;
  return s.estado === 'APROBADA' || s.estado === 'ASIGNADA';
}

export type SupervisionPedidosPanelProps = {
  solicitudes: SolicitudRefuerzo[];
  view: SupervisionPedidosView;
  onAprobar: (s: SolicitudRefuerzo) => void;
  onRechazar: (s: SolicitudRefuerzo) => void;
  onEditar: (s: SolicitudRefuerzo) => void;
  onEliminar: (s: SolicitudRefuerzo) => void;
  onRevertirEstructural: (s: SolicitudRefuerzo) => void;
};

function PedidoAcciones({
  s,
  onAprobar,
  onRechazar,
  onEditar,
  onEliminar,
  onRevertirEstructural,
  layout,
}: {
  s: SolicitudRefuerzo;
  onAprobar: (s: SolicitudRefuerzo) => void;
  onRechazar: (s: SolicitudRefuerzo) => void;
  onEditar: (s: SolicitudRefuerzo) => void;
  onEliminar: (s: SolicitudRefuerzo) => void;
  onRevertirEstructural: (s: SolicitudRefuerzo) => void;
  layout: 'card' | 'table';
}) {
  const btn = layout === 'table'
    ? 'px-2 py-1 rounded-lg font-black text-[9px] uppercase'
    : 'px-3 py-1.5 rounded-xl font-black text-[10px] uppercase';

  if (s.estado === 'PENDIENTE') {
    return (
      <div className={`flex flex-col gap-1 ${layout === 'table' ? 'items-end' : ''}`}>
        <div className={`flex gap-1 ${layout === 'card' ? 'w-full sm:w-auto' : 'flex-wrap justify-end'}`}>
          <button type="button" onClick={() => onRechazar(s)}
            className={`${btn} bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center gap-1 ${layout === 'card' ? 'flex-1 sm:flex-none justify-center py-2.5 text-xs' : ''}`}>
            <XCircle size={layout === 'table' ? 10 : 13}/> Rechazar
          </button>
          <button type="button" onClick={() => onAprobar(s)}
            className={`${btn} bg-teal-50 hover:bg-teal-100 text-teal-700 flex items-center gap-1 ${layout === 'card' ? 'flex-1 sm:flex-none justify-center py-2.5 text-xs' : ''}`}>
            <CheckCircle size={layout === 'table' ? 10 : 13}/> Aprobar
          </button>
        </div>
        <PlanificacionLink solicitud={s} compact={layout === 'table'} />
      </div>
    );
  }

  if (s.estado === 'APROBADA') {
    return (
      <div className={`flex flex-col gap-1 ${layout === 'table' ? 'items-end' : 'items-end'}`}>
        {layout === 'card' && s.autorizadoPorNombre && (
          <span className="text-[10px] text-teal-600 font-bold">✓ {s.autorizadoPorNombre}</span>
        )}
        <div className="flex gap-1 flex-wrap justify-end">
          <PlanificacionLink solicitud={s} compact={layout === 'table'} />
          {isRefuerzoPuntualGestionable(s) && (
            <>
              <button type="button" onClick={() => onEditar(s)}
                className={`${btn} bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1`}>
                <Pencil size={10}/> Editar
              </button>
              <button type="button" onClick={() => onEliminar(s)}
                className={`${btn} bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center gap-1`}>
                <Trash2 size={10}/> Eliminar
              </button>
            </>
          )}
          {s.alcance === 'ESTRUCTURAL' && s.slaApplied && (
            <button type="button" onClick={() => onRevertirEstructural(s)}
              className={`${btn} bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center gap-1`}>
              <Ban size={10}/> Revertir
            </button>
          )}
        </div>
      </div>
    );
  }

  if (s.estado === 'ASIGNADA' && isRefuerzoPuntualGestionable(s)) {
    return (
      <div className="flex gap-1 flex-wrap justify-end">
        <PlanificacionLink solicitud={s} compact={layout === 'table'} />
        <button type="button" onClick={() => onEditar(s)}
          className={`${btn} bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1`}>
          <Pencil size={10}/> Editar
        </button>
        <button type="button" onClick={() => onEliminar(s)}
          className={`${btn} bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center gap-1`}>
          <Trash2 size={10}/> Eliminar
        </button>
      </div>
    );
  }

  if (canLinkToPlanificacion(s.estado)) {
    return <PlanificacionLink solicitud={s} compact={layout === 'table'} />;
  }

  return null;
}

function PedidoCard({
  s,
  ...actions
}: { s: SolicitudRefuerzo } & Omit<SupervisionPedidosPanelProps, 'solicitudes' | 'view'>) {
  const urg = urgencyLevel(s.fecha);
  const urgStyle = URGENCY_STYLES[urg];
  const pendH = s.estado === 'PENDIENTE' ? pendingHoursLabel(hoursSincePending(s.solicitadoAt)) : null;
  const origenCanal = formatRefuerzoOrigenCanal(s);
  const kind = pedidoKind(s);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${PEDIDO_KIND_STYLES[kind]}`}>
              {kind}
            </span>
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${PEDIDO_ESTADO_STYLES[s.estado]}`}>
              {pedidoEstadoLabel(s.estado)}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${urgStyle.cls}`}>{urgStyle.label}</span>
            {pendH && <span className="text-[9px] font-bold text-amber-600">{pendH}</span>}
            <span className="text-[9px] text-slate-400 font-mono">{fmtTs(s.solicitadoAt)}</span>
          </div>
          <p className="font-black text-sm text-slate-800 dark:text-white truncate">{s.objectiveName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{s.clientName}</p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {pedidoFechaDisplay(s.fecha)} · {pedidoDetalleResumen(s)}
            </span>
            {s.tipo === 'AGREGADO_TURNO' && s.parentShiftId && (
              <ParentShiftInfo parentShiftId={s.parentShiftId} />
            )}
          </div>
          {s.solicitadoPorNombre && (
            <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1 flex-wrap">
              <User size={10} className="shrink-0"/>
              <span>
                Solicitó <span className="font-bold text-slate-600 dark:text-slate-300">{s.solicitadoPorNombre}</span>
                {origenCanal && <span className="text-slate-400"> · {origenCanal}</span>}
              </span>
            </p>
          )}
          {!s.solicitadoPorNombre && origenCanal && (
            <p className="mt-1 text-[11px] text-slate-400">{origenCanal}</p>
          )}
          {s.motivo && (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
              <MessageSquare size={10} className="mt-0.5 shrink-0"/>
              <span className="italic">&quot;{s.motivo}&quot;</span>
            </p>
          )}
          {s.motivoRechazo && (
            <p className="mt-1 text-[11px] text-rose-500 flex items-start gap-1">
              <XCircle size={10} className="mt-0.5 shrink-0"/>
              <span>{s.motivoRechazo}</span>
            </p>
          )}
          {s.estado === 'CANCELADA' && s.cancelReason && (
            <p className="mt-1 text-[11px] text-slate-500 flex items-start gap-1">
              <Ban size={10} className="mt-0.5 shrink-0"/>
              <span>Cancelado: {s.cancelReason}{s.cancelledPinAuthorizer ? ` · PIN ${s.cancelledPinAuthorizer}` : ''}</span>
            </p>
          )}
        </div>
        <PedidoAcciones s={s} layout="card" {...actions} />
      </div>
    </div>
  );
}

function PedidosTable({
  solicitudes,
  ...actions
}: { solicitudes: SolicitudRefuerzo[] } & Omit<SupervisionPedidosPanelProps, 'view' | 'solicitudes'>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      <table className="w-full min-w-[960px] text-left border-collapse">
        <thead>
          <tr className="bg-slate-100/80 dark:bg-slate-900/50 text-[9px] font-black uppercase text-slate-500 tracking-wide">
            <th className="px-3 py-2.5 whitespace-nowrap">Fecha</th>
            <th className="px-3 py-2.5 whitespace-nowrap">Tipo</th>
            <th className="px-3 py-2.5 whitespace-nowrap">Estado</th>
            <th className="px-3 py-2.5">Objetivo</th>
            <th className="px-3 py-2.5">Detalle</th>
            <th className="px-3 py-2.5 whitespace-nowrap">Solicitó</th>
            <th className="px-3 py-2.5 whitespace-nowrap">Por</th>
            <th className="px-3 py-2.5 whitespace-nowrap text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map(s => {
            const urg = urgencyLevel(s.fecha);
            const urgStyle = URGENCY_STYLES[urg];
            const kind = pedidoKind(s);
            const origenCanal = formatRefuerzoOrigenCanal(s);
            const pendH = s.estado === 'PENDIENTE' ? pendingHoursLabel(hoursSincePending(s.solicitadoAt)) : null;
            return (
              <tr
                key={s.id}
                className="border-t border-slate-100 dark:border-slate-700/80 text-[11px] hover:bg-slate-50/80 dark:hover:bg-slate-900/30 align-top"
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="font-bold text-slate-700 dark:text-slate-200">{pedidoFechaDisplay(s.fecha)}</div>
                  <span className={`inline-block mt-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${urgStyle.cls}`}>
                    {urgStyle.label}
                  </span>
                  {pendH && <div className="text-[9px] font-bold text-amber-600 mt-0.5">{pendH}</div>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${PEDIDO_KIND_STYLES[kind]}`}>
                    {kind}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${PEDIDO_ESTADO_STYLES[s.estado]}`}>
                    {pedidoEstadoLabel(s.estado)}
                  </span>
                  {s.autorizadoPorNombre && s.estado === 'APROBADA' && (
                    <div className="text-[9px] text-teal-600 font-bold mt-0.5 max-w-[80px] truncate" title={s.autorizadoPorNombre}>
                      {s.autorizadoPorNombre}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 max-w-[160px]">
                  <div className="font-black text-slate-800 dark:text-white truncate" title={s.objectiveName}>{s.objectiveName}</div>
                  <div className="text-[10px] text-slate-400 truncate" title={s.clientName}>{s.clientName}</div>
                  {s.motivo && (
                    <div className="text-[10px] text-slate-500 italic truncate mt-0.5" title={s.motivo}>&quot;{s.motivo}&quot;</div>
                  )}
                </td>
                <td className="px-3 py-2.5 font-medium text-slate-600 dark:text-slate-300 max-w-[180px]">
                  <span className="line-clamp-2" title={pedidoDetalleResumen(s)}>{pedidoDetalleResumen(s)}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200 whitespace-nowrap max-w-[90px] truncate font-bold" title={s.solicitadoPorNombre}>
                  {s.solicitadoPorNombre || '—'}
                </td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[100px] truncate" title={origenCanal}>
                  {origenCanal || '—'}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <PedidoAcciones s={s} layout="table" {...actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SupervisionPedidosPanel({
  solicitudes,
  view,
  onAprobar,
  onRechazar,
  onEditar,
  onEliminar,
  onRevertirEstructural,
}: SupervisionPedidosPanelProps) {
  const actionProps = { onAprobar, onRechazar, onEditar, onEliminar, onRevertirEstructural };

  if (view === 'table') {
    return <PedidosTable solicitudes={solicitudes} {...actionProps} />;
  }

  return (
    <div className="space-y-3">
      {solicitudes.map(s => (
        <PedidoCard key={s.id} s={s} {...actionProps} />
      ))}
    </div>
  );
}
