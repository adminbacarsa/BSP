import { horasVendidasDeServicio, type Evento } from '@/services/eventoService';

export type PlanningEventosDayEntry = {
  nombre: string;
  hours: number;
};

export type PlanningEventosDayCell = {
  totalHours: number;
  entries: PlanningEventosDayEntry[];
};

/** Horas vendidas del evento en el objetivo, por día. No suma TURA ni turnos EV. */
export function buildPlanningEventosCellsByDay(
  eventos: Evento[],
  objectiveId: string,
  monthPrefix: string,
): Record<string, PlanningEventosDayCell> {
  const out: Record<string, PlanningEventosDayCell> = {};
  if (!objectiveId) return out;

  for (const ev of eventos || []) {
    if (ev.status === 'cancelado') continue;
    for (const s of ev.servicios || []) {
      if (s.status === 'cancelado') continue;
      const fecha = String(s.fecha || '').slice(0, 10);
      if (!fecha.startsWith(monthPrefix)) continue;
      if (String(s.ubicacion?.objectiveId || '') !== objectiveId) continue;
      const hrs = horasVendidasDeServicio(s);
      out[fecha] ||= { totalHours: 0, entries: [] };
      out[fecha].totalHours += hrs;
      out[fecha].entries.push({ nombre: s.nombre || ev.nombre || 'Evento', hours: hrs });
    }
  }

  for (const cell of Object.values(out)) {
    cell.totalHours = Math.round(cell.totalHours * 10) / 10;
    cell.entries.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  return out;
}

export function formatPlanningEventosTooltip(cell: PlanningEventosDayCell): string {
  if (!cell.entries.length) return 'Sin horas vendidas';
  const lines = cell.entries.map((e) => `• ${e.nombre}: ${e.hours}h vendidas`);
  return `Eventos · ${cell.totalHours}h vendidas\n${lines.join('\n')}`;
}
