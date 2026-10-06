/**
 * Aviso «sin notificaciones» del Centro de Control.
 * El legajo ya trae `pushEstado` / `pushEstadoAt` (lo escribe la app).
 * Solo se muestra si el turno trae la clave: el monitor la pega desde el
 * catálogo de empleados. Un fixture sin la clave no inventa el aviso.
 */

export function recibeAvisosApp(pushEstado: unknown): boolean {
  return String(pushEstado ?? '').trim().toLowerCase() === 'activo';
}

function msOf(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date ? d.getTime() : 0;
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function ddMmAR(ms: number): string {
  const ymd = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const [y, m, d] = ymd.split('-');
  if (!d || !m || !y) return '';
  return `${d}/${m}`;
}

/** «No recibe avisos de la app (permiso denegado / sin token desde dd/mm). Llamalo.» */
export function textoSinNotificaciones(pushEstado: unknown, pushEstadoAt: unknown): string {
  const estado = String(pushEstado ?? '').trim().toLowerCase();
  const motivo = estado === 'denegado' ? 'permiso denegado' : 'sin token';
  const ms = msOf(pushEstadoAt);
  const cuando = ms ? ` desde ${ddMmAR(ms)}` : '';
  return `No recibe avisos de la app (${motivo}${cuando}). Llamalo.`;
}

type ShiftPush = {
  pushEstado?: unknown;
  pushEstadoAt?: unknown;
  isUnassigned?: boolean;
};

/** null = recibe avisos, o el turno no trae el dato del legajo. */
export function textoSinNotificacionesDe(shift: ShiftPush | null | undefined): string | null {
  if (!shift || shift.isUnassigned) return null;
  if (!Object.prototype.hasOwnProperty.call(shift, 'pushEstado')) return null;
  if (recibeAvisosApp(shift.pushEstado)) return null;
  return textoSinNotificaciones(shift.pushEstado, shift.pushEstadoAt);
}
