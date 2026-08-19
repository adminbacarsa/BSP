import type { Evento, ServicioEvento } from '@cosp/portal-types';

export function isEventoActivo(ev: Evento): boolean {
  return ev.status === 'activo' || ev.status === 'abierto' || ev.status === 'en_curso';
}

export function calcHorasEvento(horaInicio: string, horaFin: string): number {
  const [sh, sm] = horaInicio.split(':').map(Number);
  const [eh, em] = horaFin.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round(mins / 60);
}

export function calcHorasServicio(s: Pick<ServicioEvento, 'tipoTurno' | 'horaInicio' | 'horaFin'>): number {
  if (s.tipoTurno === '3x8' || s.tipoTurno === '2x12') return 24;
  return calcHorasEvento(s.horaInicio, s.horaFin);
}

export function horarioBadgeServicio(s: Pick<ServicioEvento, 'tipoTurno' | 'horaInicio' | 'horaFin'>): string {
  if (s.tipoTurno === '3x8') return '3×8h';
  if (s.tipoTurno === '2x12') return '2×12h';
  return `${s.horaInicio}–${s.horaFin}`;
}

export function servicioUbicacionLabel(ubi: ServicioEvento['ubicacion'] | undefined): string | null {
  if (!ubi) return null;
  if (ubi.tipo === 'nueva') return ubi.direccion || null;
  return ubi.objectiveNombre || null;
}

export function serviciosDisponiblesPortal(
  eventos: Evento[],
  todayKey: string,
): Array<{ evento: Evento; servicio: ServicioEvento }> {
  const result: Array<{ evento: Evento; servicio: ServicioEvento }> = [];
  for (const ev of eventos) {
    if (!isEventoActivo(ev)) continue;
    for (const s of ev.servicios ?? []) {
      if (s.status === 'cancelado') continue;
      if (s.fecha >= todayKey) {
        result.push({ evento: ev, servicio: s });
      }
    }
  }
  return result;
}

export function portalEventosDateRange(now = new Date()): { from: string; to: string } {
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const to = `${nextMonthEnd.getFullYear()}-${String(nextMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(nextMonthEnd.getDate()).padStart(2, '0')}`;
  return { from, to };
}
