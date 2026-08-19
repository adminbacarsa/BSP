import type { Evento, Shift } from '@cosp/portal-types';
import { horarioBadgeServicio, servicioUbicacionLabel } from './eventoHelpers';

export type EvShiftDisplay = {
  nombre: string;
  eventoNombre: string | null;
  clienteNombre: string | null;
  horarioBadge: string | null;
  direccion: string | null;
  mapsUrl: string | null;
  requisitos: string | null;
  instrucciones: string | null;
};

export function isEvShift(shift: Pick<Shift, 'code' | 'eventoId'>): boolean {
  const code = String(shift.code || '').toUpperCase();
  return code === 'EV' || !!shift.eventoId;
}

export function resolveEvShiftDisplay(
  shift: Shift,
  eventosMap: Record<string, Evento>,
): EvShiftDisplay | null {
  if (!isEvShift(shift)) return null;
  const evento = shift.eventoId ? eventosMap[shift.eventoId] : undefined;
  const servicio = evento?.servicios?.find((s) => s.id === shift.servicioId) ?? null;
  const ubi = servicio?.ubicacion;
  const direccion = servicioUbicacionLabel(ubi);
  const lat = ubi?.tipo === 'nueva' ? ubi.latitud : undefined;
  const lng = ubi?.tipo === 'nueva' ? ubi.longitud : undefined;
  const mapsUrl =
    lat != null && lng != null
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : direccion
        ? `https://www.google.com/maps/search/${encodeURIComponent(direccion)}`
        : null;

  return {
    nombre: servicio?.nombre ?? shift.servicioNombre ?? shift.eventoNombre ?? 'Evento',
    eventoNombre: evento?.nombre ?? shift.eventoNombre ?? null,
    clienteNombre: evento?.clienteNombre ?? shift.clientName ?? null,
    horarioBadge: servicio ? horarioBadgeServicio(servicio) : null,
    direccion,
    mapsUrl,
    requisitos: servicio?.requisitos ?? null,
    instrucciones: servicio?.instrucciones ?? null,
  };
}

export function eventosArrayToMap(eventos: Evento[]): Record<string, Evento> {
  const map: Record<string, Evento> = {};
  for (const ev of eventos) {
    if (ev.id) map[ev.id] = ev;
  }
  return map;
}
