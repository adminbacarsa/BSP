import type { SolicitudRefuerzo, SolicitudEstado } from '@/services/solicitudRefuerzoService';
import { formatYmdAr } from '@/lib/supervision/supervisionUtils';

export type SupervisionPedidoKind = 'RFZ' | 'TURA' | 'ESTRUCTURAL';

export type SupervisionPedidosView = 'cards' | 'table';

export const SUPERVISION_PEDIDOS_VIEW_STORAGE_KEY = 'cosp:sup:pedidosView';

const ESTADO_LABELS: Record<SolicitudEstado, string> = {
  PENDIENTE: 'Pendiente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  ASIGNADA: 'Asignada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
};

export function pedidoEstadoLabel(estado: SolicitudEstado): string {
  return ESTADO_LABELS[estado] || estado;
}

export function pedidoKind(sol: Pick<SolicitudRefuerzo, 'tipo' | 'alcance'>): SupervisionPedidoKind {
  if (sol.alcance === 'ESTRUCTURAL') return 'ESTRUCTURAL';
  return sol.tipo === 'AGREGADO_TURNO' ? 'TURA' : 'RFZ';
}

export function pedidoFechaDisplay(fecha: string): string {
  return formatYmdAr(String(fecha || '').slice(0, 10));
}

export function pedidoDetalleResumen(sol: SolicitudRefuerzo): string {
  if (sol.alcance === 'ESTRUCTURAL') {
    const pax = sol.cantidadPax || 1;
    return `+${pax} pax permanente${sol.positionName ? ` · ${sol.positionName}` : ''}`;
  }
  if (sol.tipo === 'AGREGADO_TURNO') {
    const parts = [`${sol.startTime}–${sol.endTime}`];
    if (sol.parentEmpleadoName) parts.push(sol.parentEmpleadoName);
    if (sol.positionName) parts.push(`→ ${sol.positionName}`);
    return parts.join(' · ');
  }
  const parts = [`${sol.startTime}–${sol.endTime}`];
  if (sol.cantidadPax && sol.cantidadPax > 1) parts.push(`×${sol.cantidadPax} pax`);
  else if (sol.cantidadPax) parts.push(`+${sol.cantidadPax} pax`);
  if (sol.positionName) parts.push(sol.positionName);
  return parts.join(' · ');
}

/** Deep-link a planificación (mismo contrato que Análisis / Operaciones). */
export function buildPlanificacionHref(
  sol: Pick<SolicitudRefuerzo, 'objectiveId' | 'clientId' | 'fecha'>,
): string {
  const fecha = String(sol.fecha || '').slice(0, 10);
  const [yStr, mStr] = fecha.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const q = new URLSearchParams();
  q.set('objectiveId', sol.objectiveId);
  if (sol.clientId) q.set('clientId', sol.clientId);
  if (Number.isFinite(y) && y > 2000) q.set('year', String(y));
  if (Number.isFinite(m) && m >= 1 && m <= 12) q.set('month', String(m));
  return `/admin/planificacion/?${q.toString()}`;
}

export function canLinkToPlanificacion(estado: SolicitudEstado): boolean {
  return estado !== 'RECHAZADA' && estado !== 'CANCELADA';
}

export const PEDIDO_KIND_STYLES: Record<SupervisionPedidoKind, string> = {
  RFZ: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  TURA: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  ESTRUCTURAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

export const PEDIDO_ESTADO_STYLES: Record<SolicitudEstado, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-700',
  APROBADA: 'bg-teal-100 text-teal-700',
  RECHAZADA: 'bg-rose-100 text-rose-700',
  ASIGNADA: 'bg-indigo-100 text-indigo-700',
  COMPLETADA: 'bg-slate-100 text-slate-600',
  CANCELADA: 'bg-slate-100 text-slate-400',
};
