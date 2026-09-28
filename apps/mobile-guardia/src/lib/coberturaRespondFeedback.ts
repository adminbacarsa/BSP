/** Campos mínimos para armar el mensaje de confirmación (Alertas o banner). */
export type CoberturaConfirmDetails = {
  objectiveName?: string | null;
  positionName?: string | null;
  clientName?: string | null;
  startTime?: unknown;
  endTime?: unknown;
  shiftCode?: string | null;
};

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object' && val !== null && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatTimeArLocal(d: Date): string {
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function placeLine(d: CoberturaConfirmDetails): string {
  const parts = [d.clientName, d.objectiveName, d.positionName]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.join(' · ');
}

function scheduleLine(d: CoberturaConfirmDetails): string {
  const start = d.startTime != null ? toDate(d.startTime) : null;
  const end = d.endTime != null ? toDate(d.endTime) : null;
  const bits: string[] = [];
  if (d.shiftCode) bits.push(String(d.shiftCode).trim());
  if (start) {
    const hi = formatTimeArLocal(start);
    const hf = end ? formatTimeArLocal(end) : '';
    bits.push(hf ? `${hi}–${hf}` : hi);
  }
  return bits.filter(Boolean).join(' · ');
}

/**
 * Mensaje post-respuesta (éxito). ACEPTAR incluye lugar y horario;
 * RECHAZAR es corto y vinculante.
 */
export function buildCoberturaRespondFeedback(
  response: 'ACCEPTED' | 'REJECTED',
  details?: CoberturaConfirmDetails | null,
): { title: string; message: string } {
  if (response === 'REJECTED') {
    return { title: 'Convocatoria rechazada', message: 'No vas a cubrir este turno.' };
  }

  const lines: string[] = ['Convocatoria aceptada.'];
  const place = details ? placeLine(details) : '';
  const schedule = details ? scheduleLine(details) : '';
  if (place) lines.push(place);
  if (schedule) lines.push(schedule);
  lines.push('Ya figura en Hoy como tu turno asignado.');
  return { title: 'Convocatoria aceptada', message: lines.join('\n') };
}
