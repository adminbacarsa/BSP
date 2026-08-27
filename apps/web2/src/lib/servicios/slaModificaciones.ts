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
    rows.push({
      key: `sol-${sol.id || sol.fecha}-${code}`,
      at: sol.fecha || ymdFromIso(String(sol.solicitadoAt || '')),
      kind: estructural ? 'ESTRUCTURAL' : (code === 'TURA' ? 'TURA' : 'RFZ'),
      title: estructural
        ? `Estructural +${sol.cantidadPax || 1} pax`
        : `${code} puntual · ${sol.estado}`,
      detail: [
        fecha,
        horario,
        sol.positionName || sol.parentEmpleadoName,
        sol.motivo,
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
