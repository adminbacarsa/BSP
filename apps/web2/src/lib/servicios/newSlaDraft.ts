/** Alta de SLA: vigencia por defecto y estado al guardar. Sin Firebase. */

export const REOPEN_MOTIVO_MSG = 'Escribí el motivo de la reapertura';
const REOPEN_MOTIVO_MIN = 5;

/** Día 1 → último día del mes (mismo criterio que el alta actual). */
export function monthBoundsYmd(year: number, monthIndex0: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  return {
    start: `${year}-${pad(monthIndex0 + 1)}-01`,
    end: `${year}-${pad(monthIndex0 + 1)}-${pad(lastDay)}`,
  };
}

export function localTodayYmd(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Si hay mes seleccionado arriba, ese mes. Si no, el mes en curso.
 * No usa el fin del SLA anterior.
 */
export function defaultNewSlaDates(
  now: Date,
  selected?: { year: number; monthIndex0: number } | null,
): { startDate: string; endDate: string } {
  const year = selected ? selected.year : now.getFullYear();
  const monthIndex0 = selected ? selected.monthIndex0 : now.getMonth();
  const bounds = monthBoundsYmd(year, monthIndex0);
  return { startDate: bounds.start, endDate: bounds.end };
}

/** Incluye hoy o es futura → no nace cerrado. Solo si el fin ya pasó. */
export function newSlaBornClosed(endDate: string, todayYmd: string): boolean {
  const end = String(endDate || '').slice(0, 10);
  return !!end && end < todayYmd;
}

const LIFECYCLE_KEYS = [
  'closed',
  'closedAt',
  'closedBy',
  'closedByUid',
  'closedReason',
  'reopenedManually',
  'reopenedAt',
  'reopenedBy',
  'reopenedByUid',
  'reopenReason',
  'closeHistory',
  'cancelledAt',
  'cancelledBy',
  'cancelledByUid',
  'cancelReason',
  'changeLog',
] as const;

export function stripSlaLifecycle<T extends Record<string, unknown>>(src: T): T {
  const next = { ...src };
  for (const key of LIFECYCLE_KEYS) delete next[key];
  return next;
}

/** null si el motivo sirve. Espacios o texto corto no pasan. */
export function reopenMotivoError(raw: unknown): string | null {
  const motivo = String(raw ?? '').trim();
  if (motivo.length < REOPEN_MOTIVO_MIN) return REOPEN_MOTIVO_MSG;
  return null;
}

export function normalizeReopenMotivo(raw: unknown): string {
  const err = reopenMotivoError(raw);
  if (err) throw new Error(err);
  return String(raw ?? '').trim();
}
