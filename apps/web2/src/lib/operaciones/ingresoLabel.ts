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

/** Reloj de auditoría (`checkInAt`). Tarde solo si pasó la tolerancia T+5. */
export function formatIngresoLine(shift: {
  checkInAt?: TsLike;
  checkInTime?: TsLike;
  startTime?: TsLike;
  shiftDateObj?: Date | null;
}): string | null {
  const punch = toDate(shift.checkInAt) || toDate(shift.checkInTime);
  if (!punch) return null;
  const planned = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : toDate(shift.startTime);
  const hh = punch.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  if (!planned) return `Ingresó ${hh}`;
  const lateMin = Math.round((punch.getTime() - planned.getTime()) / 60000);
  if (lateMin > 5) return `Ingresó ${hh} (${lateMin} min tarde)`;
  return `Ingresó ${hh}`;
}
