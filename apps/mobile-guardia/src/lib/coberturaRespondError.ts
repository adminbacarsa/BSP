/**
 * Clasifica errores de `responderConvocatoriaCobertura` para Alertas / banner.
 * - stale: convocatoria ya no accionable → soft-dismiss OK
 * - retryable: red/servidor → NO dismiss
 */

export type CoberturaRespondOutcome =
  | { kind: 'stale'; message: string }
  | { kind: 'retryable'; message: string };

function cleanFirebaseMessage(raw: string): string {
  return raw
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\(functions\/[^)]+\)\.?$/i, '')
    .trim();
}

export function isRetryablePortalError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '').replace(/^functions\//, '').toLowerCase();
  const msg = String(e?.message ?? '').toLowerCase();
  if (
    code.includes('unavailable') ||
    code.includes('deadline') ||
    code.includes('internal') ||
    code === 'unknown' ||
    code.includes('resource-exhausted')
  ) {
    return true;
  }
  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('connection')
  ) {
    return true;
  }
  return false;
}

/**
 * Mensaje UX + si hay que dismiss la alerta.
 * `failed-precondition` / `not-found` / status terminal → stale.
 */
export function classifyCoberturaRespondError(err: unknown): CoberturaRespondOutcome {
  if (isRetryablePortalError(err)) {
    return {
      kind: 'retryable',
      message: 'No se pudo enviar la respuesta. Reintentá.',
    };
  }

  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '').replace(/^functions\//, '').toLowerCase();
  const raw = cleanFirebaseMessage(String(e?.message ?? ''));
  const upper = raw.toUpperCase();

  if (code === 'not-found') {
    return { kind: 'stale', message: 'La convocatoria ya no está disponible.' };
  }

  if (/YA FUE ACCEPTED|YA FUE CUBIERT|YA EST[AÁ] CUBIERT|ALREADY ACCEPTED/i.test(upper)) {
    return { kind: 'stale', message: 'Ya fue cubierta.' };
  }
  if (/YA FUE REJECTED|YA FUE RECHAZ/i.test(upper)) {
    return { kind: 'stale', message: 'Esta convocatoria ya fue rechazada.' };
  }
  if (/EXPIR|VENCI|TIMEOUT|AGOTAD/i.test(upper)) {
    return { kind: 'stale', message: 'La convocatoria venció.' };
  }
  if (/CANCEL/i.test(upper)) {
    return { kind: 'stale', message: 'La convocatoria fue cancelada.' };
  }
  if (code === 'failed-precondition') {
    // "La convocatoria ya fue ACCEPTED|..."
    const m = upper.match(/YA FUE\s+([A-Z_]+)/);
    if (m?.[1] === 'ACCEPTED') return { kind: 'stale', message: 'Ya fue cubierta.' };
    if (m?.[1] === 'REJECTED') return { kind: 'stale', message: 'Esta convocatoria ya fue rechazada.' };
    if (m?.[1] === 'EXPIRED' || m?.[1] === 'TIMEOUT') {
      return { kind: 'stale', message: 'La convocatoria venció.' };
    }
    if (m?.[1] === 'CANCELLED' || m?.[1] === 'CANCELED') {
      return { kind: 'stale', message: 'La convocatoria fue cancelada.' };
    }
    return {
      kind: 'stale',
      message: raw || 'La convocatoria ya no está vigente.',
    };
  }

  return {
    kind: 'retryable',
    message: raw || 'No se pudo enviar la respuesta. Reintentá.',
  };
}
