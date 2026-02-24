/**
 * Horario de atención para rutas de cámara NVR.
 * Si la ruta tiene schedule_enabled y estamos fuera de la ventana, no se crea la alerta.
 */

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

export type ScheduleRouteData = {
  schedule_enabled?: boolean;
  schedule_days?: number[]; // 0=Dom, 1=Lun, ..., 6=Sab. Vacío = todos los días
  schedule_time_start?: string; // "HH:mm" ej. "22:00"
  schedule_time_end?: string;   // "HH:mm" ej. "06:00"
  schedule_timezone?: string;
};

function parseHHmm(s: string | undefined): number | null {
  if (!s || typeof s !== 'string') return null;
  const parts = s.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Indica si la fecha/hora actual está dentro del horario de atención configurado.
 * @param routeData datos del documento camera_routes (puede ser null/undefined)
 * @param now fecha a evaluar (por defecto ahora)
 * @returns true si no hay horario restringido o si estamos dentro de la ventana
 */
export function isWithinSchedule(
  routeData: ScheduleRouteData | null | undefined,
  now: Date = new Date()
): boolean {
  if (!routeData || routeData.schedule_enabled !== true) return true;

  const tz = routeData.schedule_timezone || DEFAULT_TIMEZONE;

  // Día de la semana en la zona (0=Dom, 6=Sab)
  const dayStr = now.toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDay = dayMap[dayStr] ?? 0;

  if (Array.isArray(routeData.schedule_days) && routeData.schedule_days.length > 0) {
    if (!routeData.schedule_days.includes(currentDay)) return false;
  }

  const startMin = parseHHmm(routeData.schedule_time_start);
  const endMin = parseHHmm(routeData.schedule_time_end);
  if (startMin == null && endMin == null) return true;

  const timeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const [h, m] = timeStr.split(':').map(Number);
  const currentMin = (h ?? 0) * 60 + (m ?? 0);

  if (startMin != null && endMin != null) {
    if (endMin > startMin) {
      return currentMin >= startMin && currentMin < endMin;
    }
    // Ventana nocturna: ej. 22:00 a 06:00
    return currentMin >= startMin || currentMin < endMin;
  }
  if (startMin != null) return currentMin >= startMin;
  if (endMin != null) return currentMin < endMin;
  return true;
}
