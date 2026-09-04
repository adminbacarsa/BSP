import type { SlaChangeLogEntry, ServiceSLA } from '@/services/slaService';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import {
  calcRefuerzoHorasVendidas,
} from '@/lib/refuerzo/refuerzoProforma';
import {
  formatRefuerzoFechaAr,
  formatRefuerzoTimeRange,
  hoursFromShiftClock,
  isSolicitudRefuerzoExtraVendible,
  refuerzoTipoCode,
} from '@/lib/refuerzo/refuerzoDisplay';

export type SlaModificacionRow = {
  key: string;
  at: string;
  kind: 'LOG' | 'RFZ' | 'TURA' | 'ESTRUCTURAL' | 'TURNO';
  title: string;
  detail: string;
  hours?: number;
  actor?: string;
};

function ymdFromIso(iso?: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function matchesService(sol: SolicitudRefuerzo, srv: ServiceSLA): boolean {
  if (sol.objectiveId && srv.objectiveId && sol.objectiveId === srv.objectiveId) return true;
  if (sol.slaIdAplicado && srv.id && sol.slaIdAplicado === srv.id) return true;
  return false;
}

export function buildServiceModificaciones(
  srv: ServiceSLA,
  solicitudes: SolicitudRefuerzo[],
  turnos: Array<{
    id?: string;
    objectiveId?: string;
    objectiveName?: string;
    fecha?: string;
    startTime?: unknown;
    endTime?: unknown;
    hours?: unknown;
    code?: string;
    positionName?: string;
    employeeName?: string;
    employeeId?: string;
    solicitudRefuerzoId?: string;
  }>,
): SlaModificacionRow[] {
  const rows: SlaModificacionRow[] = [];

  (srv.changeLog || []).forEach((entry: SlaChangeLogEntry, idx) => {
    rows.push({
      key: `log-${entry.at}-${idx}`,
      at: entry.at,
      kind: 'LOG',
      title: String(entry.action || 'CAMBIO').replace(/_/g, ' '),
      detail: entry.detail,
      actor: entry.byName,
    });
  });

  solicitudes.filter((sol) => matchesService(sol, srv)).forEach((sol) => {
    const code = refuerzoTipoCode(sol);
    const estructural = !isSolicitudRefuerzoExtraVendible(sol);
    const hrs = estructural ? undefined : calcRefuerzoHorasVendidas(sol);
    const horario = formatRefuerzoTimeRange(sol.startTime, sol.endTime);
    const fecha = formatRefuerzoFechaAr(sol.fecha);
    const cancelled = sol.estado === 'CANCELADA';
    rows.push({
      key: `sol-${sol.id || sol.fecha}-${code}`,
      at: sol.fecha || ymdFromIso(String(sol.solicitadoAt || '')),
      kind: estructural ? 'ESTRUCTURAL' : (code === 'TURA' ? 'TURA' : 'RFZ'),
      title: estructural
        ? (sol.fechaHasta
          ? `Estructural +${sol.cantidadPax || 1} pax (${formatRefuerzoFechaAr(sol.fecha)} → ${formatRefuerzoFechaAr(sol.fechaHasta)})`
          : `Estructural +${sol.cantidadPax || 1} pax permanente`)
        : cancelled
          ? `${code} cancelado`
          : `${code} puntual · ${sol.estado}`,
      detail: [
        fecha,
        horario,
        sol.positionName || sol.parentEmpleadoName,
        cancelled && sol.cancelReason ? `Motivo: ${sol.cancelReason}` : sol.motivo,
      ].filter(Boolean).join(' · '),
      hours: hrs,
      actor: sol.autorizadoPorNombre || sol.solicitadoPorNombre,
    });
  });

  const billed = new Set(
    solicitudes.filter((s) => s.id && matchesService(s, srv)).map((s) => s.id as string),
  );
  turnos
    .filter((t) => {
      if (t.objectiveId && srv.objectiveId && t.objectiveId === srv.objectiveId) return true;
      return !!srv.objectiveName && t.objectiveName === srv.objectiveName;
    })
    .filter((t) => !t.solicitudRefuerzoId || !billed.has(t.solicitudRefuerzoId))
    .filter((t) => (t as { isDeleted?: boolean }).isDeleted !== true)
    .forEach((t) => {
      const hrs = hoursFromShiftClock(t);
      const fecha = String(t.fecha || '').slice(0, 10) || ymdFromIso(String(t.startTime || ''));
      rows.push({
        key: `turno-${t.id || fecha}`,
        at: fecha,
        kind: 'TURNO',
        title: `${String(t.code || 'RFZ').toUpperCase()} ${t.employeeId && t.employeeId !== 'VACANTE' ? 'asignado' : 'vacante'}`,
        detail: [t.positionName, t.employeeName].filter(Boolean).join(' · ') || 'Turno extra',
        hours: hrs > 0 ? hrs : undefined,
      });
    });

  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function turnoExtraHours(t: { startTime?: unknown; endTime?: unknown; hours?: unknown }): number {
  const hs = hoursFromShiftClock(t);
  return hs > 0 ? hs : 0;
}

export function formatModificacionFechaAr(at: string): string {
  const d = String(at || '').slice(0, 10);
  if (d.length !== 10) return d || '—';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Rango visible del mes KPI intersectado con vigencia del contrato SLA. */
export function monthRangeForService(
  year: number,
  month: number,
  service?: { startDate?: string; endDate?: string },
): { start: string; end: string; label: string } | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = `${year}-${pad(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
  let start = monthStart;
  let end = monthEnd;
  const sd = String(service?.startDate || '').slice(0, 10);
  const ed = String(service?.endDate || '').slice(0, 10);
  if (sd && sd > start) start = sd;
  if (ed && ed < end) end = ed;
  if (start > end) return null;
  const label = new Date(year, month, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

/** Filtra modificaciones al mes del listado KPI y vigencia del servicio. */
export function filterModificacionesForMonth(
  rows: SlaModificacionRow[],
  year: number,
  month: number,
  service?: { startDate?: string; endDate?: string },
): SlaModificacionRow[] {
  const range = monthRangeForService(year, month, service);
  if (!range) return [];
  return rows.filter((row) => {
    const d = String(row.at || '').slice(0, 10);
    return d.length === 10 && d >= range.start && d <= range.end;
  });
}
