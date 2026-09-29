import { horasVendidasDeServicio, type Evento, type ServicioEvento } from '@/services/eventoService';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey, toDateSafe } from './crmDateUtils';
import { fichadaDurationHours, fichadaHoursForShift, isShiftFichado } from './fichadaHours';
import { isEventoGuardHoursShift } from './eventosGuardHours';
import type { ProformaEvento, ProformaEventoDia } from './proformaTypes';

const BILLABLE_STATUS = new Set(['activo', 'abierto', 'en_curso', 'ejecutado']);

function r1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/** Horas fichadas del turno de evento. Informativas: no entran al total facturado. */
export function horasFichadasEvento(t: any): number {
  if (!isShiftFichado(t)) return 0;
  const rs = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  const re = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  if (rs && re && re.getTime() > rs.getTime()) {
    const hrs = fichadaDurationHours(rs, re);
    if (hrs > 0 && hrs <= 24) return r1(hrs);
  }
  return r1(fichadaHoursForShift(t));
}

function shiftDateKey(t: any): string {
  const scheduled = resolveTurnoScheduleDateKey(t);
  if (scheduled) return scheduled;
  const start = toDateSafe(t.startTime);
  return start ? getDateKeyInTimezone(start) : '';
}

function isEvShift(t: any): boolean {
  const code = String(t?.code || t?.type || '').trim().toUpperCase();
  const origin = String(t?.origin || '').trim().toUpperCase();
  return code === 'EV' || origin === 'EVENTO';
}

function serviciosFacturables(ev: Evento): ServicioEvento[] {
  const propios = ev.servicios ?? [];
  if (propios.length > 0) return propios.filter((s) => s.status !== 'cancelado');
  const fechas = [ev.fecha, ...(ev.fechas || [])].filter((f): f is string => !!f);
  return fechas.map((fecha) => ({
    id: `${ev.id || 'legacy'}_${fecha}`,
    nombre: ev.nombre,
    fecha,
    tipoTurno: 'libre' as const,
    horaInicio: ev.horaInicio || '08:00',
    horaFin: ev.horaFin || '20:00',
    horasTotal: ev.horasEvento || 0,
    ubicacion: { tipo: 'nueva' as const },
    cupo: ev.cupoGuardias || 0,
    status: 'pendiente' as const,
    horasVendidas: ev.horasVendidas,
  }));
}

function emptyDay(fecha: string, trabajadas: number): ProformaEventoDia {
  return { fecha, horasVendidas: 0, horasTrabajadas: trabajadas, servicios: [] };
}

/**
 * Un renglón por día de evento. totalHoras = horas vendidas.
 * Las fichadas van aparte y no se suman al facturado.
 */
export function buildEventosPrefactura(opts: {
  eventos: Evento[];
  turnos: any[];
  clientId: string;
  startYmd: string;
  endYmd: string;
}): ProformaEvento[] {
  const worked = new Map<string, number>();
  for (const t of opts.turnos || []) {
    if (!isEventoGuardHoursShift(t) || !isEvShift(t)) continue;
    const eventoId = String(t.eventoId || '').trim();
    if (!eventoId) continue;
    if (t.clientId && opts.clientId && t.clientId !== opts.clientId) continue;
    const dateKey = shiftDateKey(t);
    if (!dateKey || dateKey < opts.startYmd || dateKey > opts.endYmd) continue;
    const hrs = horasFichadasEvento(t);
    if (hrs <= 0) continue;
    const key = `${eventoId}|${dateKey}`;
    worked.set(key, r1((worked.get(key) || 0) + hrs));
  }

  const out: ProformaEvento[] = [];
  const seen = new Set<string>();
  for (const ev of opts.eventos || []) {
    if (opts.clientId && ev.clienteId && ev.clienteId !== opts.clientId) continue;
    if (!BILLABLE_STATUS.has(ev.status)) continue;
    const eventoId = String(ev.id || '').trim();
    if (!eventoId) continue;
    seen.add(eventoId);
    const byDay = new Map<string, ProformaEventoDia>();
    for (const s of serviciosFacturables(ev)) {
      const fecha = String(s.fecha || '').slice(0, 10);
      if (!fecha || fecha < opts.startYmd || fecha > opts.endYmd) continue;
      const vendidas = horasVendidasDeServicio(s);
      const row = byDay.get(fecha) || emptyDay(fecha, worked.get(`${eventoId}|${fecha}`) || 0);
      row.horasVendidas = r1(row.horasVendidas + vendidas);
      row.servicios.push({
        servicioId: s.id,
        servicioNombre: s.nombre || 'Servicio',
        horasVendidas: vendidas,
      });
      byDay.set(fecha, row);
    }
    for (const [key, hrs] of worked) {
      const split = key.indexOf('|');
      const eid = key.slice(0, split);
      const fecha = key.slice(split + 1);
      if (eid !== eventoId || byDay.has(fecha)) continue;
      byDay.set(fecha, emptyDay(fecha, hrs));
    }
    const dias = Array.from(byDay.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!dias.length) continue;
    out.push({
      eventoId,
      eventoNombre: ev.nombre || eventoId,
      dias,
      totalHoras: r1(dias.reduce((a, d) => a + d.horasVendidas, 0)),
      horasTrabajadas: r1(dias.reduce((a, d) => a + d.horasTrabajadas, 0)),
    });
  }

  const orphans = new Map<string, ProformaEventoDia[]>();
  for (const [key, hrs] of worked) {
    const split = key.indexOf('|');
    const eid = key.slice(0, split);
    const fecha = key.slice(split + 1);
    if (seen.has(eid)) continue;
    const list = orphans.get(eid) || [];
    list.push(emptyDay(fecha, hrs));
    orphans.set(eid, list);
  }
  for (const [eventoId, dias] of orphans) {
    dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
    out.push({
      eventoId,
      eventoNombre: eventoId,
      dias,
      totalHoras: 0,
      horasTrabajadas: r1(dias.reduce((a, d) => a + d.horasTrabajadas, 0)),
    });
  }

  return out.sort((a, b) => a.eventoNombre.localeCompare(b.eventoNombre, 'es'));
}
