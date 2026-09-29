type TsLike = { seconds?: number; toDate?: () => Date } | Date | null | undefined;

function toMs(v: TsLike): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

/** Cuenta regresiva de la ventana del convocado: min(acceptedAt+60, fin). */
export function convocadoCountdownLabel(shift: {
  isAwaitingCoverageCheckIn?: boolean;
  isPresent?: boolean;
  acceptedAt?: TsLike;
  createdAt?: TsLike;
  coverageCreatedAt?: TsLike;
  endDateObj?: Date | null;
  endTime?: TsLike;
}, now = new Date()): string | null {
  if (!shift.isAwaitingCoverageCheckIn || shift.isPresent) return null;
  const anchor = toMs(shift.acceptedAt) || toMs(shift.createdAt) || toMs(shift.coverageCreatedAt);
  if (!anchor) return null;
  const end = shift.endDateObj instanceof Date ? shift.endDateObj.getTime() : toMs(shift.endTime);
  const cap = end > 0 ? Math.min(anchor + 60 * 60 * 1000, end) : anchor + 60 * 60 * 1000;
  const leftMin = Math.ceil((cap - now.getTime()) / 60000);
  const hh = new Date(cap).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  if (leftMin <= 0) return `Ventana vencida ${hh}`;
  return `Fichá hasta ${hh} · ${leftMin} min`;
}
