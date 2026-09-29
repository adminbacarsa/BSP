type TsLike = { seconds?: number; toDate?: () => Date } | Date | string | number | null | undefined;

function toDate(v: TsLike): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** Reloj de pago (`realStartTime`). `checkInAt` queda como «marcó» si fichó antes. */
export function formatIngresoLine(shift: {
  checkInAt?: TsLike;
  checkInTime?: TsLike;
  realStartTime?: TsLike;
  startTime?: TsLike;
  shiftDateObj?: Date | null;
}): string | null {
  const punch = toDate(shift.checkInAt) || toDate(shift.checkInTime);
  const planned = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : toDate(shift.startTime);
  const pay =
    toDate(shift.realStartTime) ||
    (planned && punch && punch.getTime() < planned.getTime() ? planned : punch);
  if (!pay) return null;
  const lateMin = planned ? Math.round((pay.getTime() - planned.getTime()) / 60000) : 0;
  const main = lateMin > 5 ? `Ingresó ${hhmm(pay)} (${lateMin} min tarde)` : `Ingresó ${hhmm(pay)}`;
  if (punch && Math.abs(punch.getTime() - pay.getTime()) >= 60_000) {
    return `${main} · marcó ${hhmm(punch)}`;
  }
  return main;
}
