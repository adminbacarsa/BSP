type TsLike = { seconds?: number; toMillis?: () => number; toDate?: () => Date } | Date | number | null | undefined;

function toMs(v: TsLike): number {
  if (!v) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Tarjeta del convocado: en camino, origen, recordatorio, respuesta y demora.
 * No es una ventana de fichada.
 */
export function convocadoEnCaminoLabel(shift: {
  isPresent?: boolean;
  isCompleted?: boolean;
  expectedArrivalAt?: TsLike;
  originSource?: string;
  convocadoReminderSentAt?: TsLike;
  convocadoReply?: string;
  convocadoDemorado?: boolean;
}): string | null {
  if (shift.isPresent || shift.isCompleted) return null;
  const eta = toMs(shift.expectedArrivalAt);
  if (!eta) return null;
  const origin = shift.originSource === 'DEVICE'
    ? 'celular'
    : shift.originSource === 'DOMICILIO'
      ? 'domicilio'
      : '';
  const parts = [`EN CAMINO · llega ~${hhmm(eta)}`];
  if (origin) parts.push(origin);
  if (toMs(shift.convocadoReminderSentAt) > 0) parts.push('recordatorio enviado');
  if (shift.convocadoReply === 'ON_WAY') parts.push('confirmó que llega');
  if (shift.convocadoReply === 'PROBLEM') parts.push('avisó un problema');
  if (shift.convocadoDemorado) parts.push('DEMORADO');
  return parts.join(' · ');
}
