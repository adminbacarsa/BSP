/**
 * Nota rápida del operador sobre un turno (celular o escritorio).
 * Se guarda en el turno (`opsNota`, última nota visible en la tarjeta) y como novedad
 * `NOTA_OPERADOR` (bitácora del escritorio). Autor y hora siempre.
 */
export const OPS_NOTA_MAX = 140;

export interface OpsNota {
  texto: string;
  autor: string;
  autorUid?: string | null;
  /** Timestamp Firestore o Date/ISO; se lee con `opsNotaMs`. */
  at: unknown;
}

const TZ = 'America/Argentina/Buenos_Aires';

export function opsNotaMs(at: unknown): number {
  if (!at) return 0;
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  if (typeof at === 'string') {
    const t = Date.parse(at);
    return Number.isFinite(t) ? t : 0;
  }
  const t = at as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

/** Recorta y normaliza el texto; vacío → null. */
export function normalizarNota(texto: unknown): string | null {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > OPS_NOTA_MAX ? `${t.slice(0, OPS_NOTA_MAX - 1)}…` : t;
}

/** «Nota 15:21 · Lopez: sin llaves del portón». */
export function formatOpsNotaLine(nota: Partial<OpsNota> | null | undefined): string | null {
  const texto = normalizarNota(nota?.texto);
  if (!texto) return null;
  const ms = opsNotaMs(nota?.at);
  const hora = ms ? new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '';
  const autor = String(nota?.autor || '').trim();
  const meta = [hora, autor].filter(Boolean).join(' · ');
  return meta ? `Nota ${meta}: ${texto}` : `Nota: ${texto}`;
}

/** Documento de novedad para la bitácora del escritorio (informativa: solo «Entendido»). */
export function buildNotaNovedad(shift: Record<string, unknown>, nota: OpsNota, source: 'CC_MOVIL' | 'CC') {
  return {
    type: 'NOTA_OPERADOR',
    shiftId: String(shift.id || ''),
    employeeId: shift.employeeId || null,
    employeeName: shift.employeeName || null,
    objectiveId: shift.objectiveId || null,
    objectiveName: shift.objectiveName || null,
    clientName: shift.clientName || null,
    positionName: shift.positionName || null,
    shiftCode: shift.code || null,
    empresaId: shift.empresaId || null,
    description: nota.texto,
    createdBy: nota.autorUid || null,
    createdByName: nota.autor,
    source,
    status: 'unread',
    viewed: false,
    createdAt: nota.at,
  };
}
