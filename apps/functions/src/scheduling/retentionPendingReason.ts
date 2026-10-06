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

/** Primer token del apellido: «KOPP Franco» y «KOPP, Franco» → KOPP. */
function quienCobertura(employeeName: string): string {
  const raw = String(employeeName || '').trim();
  const head = (raw.split(',')[0] || raw).trim();
  return head.split(/\s+/)[0] || 'relevo';
}

export function retentionPendingReason(opts: {
  nowMs: number;
  reliefStartMs: number;
  employeeName: string;
  /** ops_cov que toma la franja: mismo relevo, otra persona. */
  cobertura?: boolean;
  /** Llegada prevista (`expectedArrivalAt`). Si no, vale `reliefStartMs`. */
  arrivalMs?: number;
}): string {
  const name = String(opts.employeeName || 'relevo').trim() || 'relevo';
  if (opts.cobertura) {
    const who = quienCobertura(name);
    const llega = opts.arrivalMs && opts.arrivalMs > 0 ? opts.arrivalMs : opts.reliefStartMs;
    if (llega > 0 && opts.nowMs < llega) {
      return `Esperando a ${who} (cobertura, llega ${formatHmAR(llega)})`;
    }
    return `Esperando a ${who} (cobertura, en camino)`;
  }
  if (opts.reliefStartMs > 0 && opts.nowMs < opts.reliefStartMs) {
    return `Esperando relevo de las ${formatHmAR(opts.reliefStartMs)} (${name})`;
  }
  return `${name} no se presentó`;
}
