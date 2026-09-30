/** Espejo de `retentionPendingReason` en `packages/ops-core/src/retentionDisplay.ts`. */

const TZ = 'America/Argentina/Buenos_Aires';

function formatHmAR(ms: number): string {
  if (!ms) return '--:--';
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ,
  });
}

export function retentionPendingReason(opts: {
  nowMs: number;
  reliefStartMs: number;
  employeeName: string;
}): string {
  const name = String(opts.employeeName || 'relevo').trim() || 'relevo';
  if (opts.reliefStartMs > 0 && opts.nowMs < opts.reliefStartMs) {
    return `Esperando relevo de las ${formatHmAR(opts.reliefStartMs)} (${name})`;
  }
  return `${name} no se presentó`;
}
