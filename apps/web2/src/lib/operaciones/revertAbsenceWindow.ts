/** Espejo de `REVERT_ABSENCE_WINDOW_MS` en apps/functions/src/attendance/revertirAusencia.ts (PAST_T60). */
export const REVERT_ABSENCE_WINDOW_MS = 60 * 60 * 1000;

function plannedStartMs(shift: any): number {
    const raw = shift?.startTime ?? shift?.shiftDateObj;
    if (!raw) return 0;
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw?.toMillis === 'function') return raw.toMillis();
    if (typeof raw?.toDate === 'function') return raw.toDate().getTime();
    if (typeof raw?.seconds === 'number') return raw.seconds * 1000;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

export function isRevertAbsenceExpired(shift: any, nowMs: number = Date.now()): boolean {
    const startMs = plannedStartMs(shift);
    return startMs > 0 && nowMs > startMs + REVERT_ABSENCE_WINDOW_MS;
}

/**
 * Desde el instante de la ausencia hasta T+60 el operador siempre tiene salida,
 * esté la vacante abierta, la cascada corriendo o el protocolo asistido tomado.
 */
export function canRevertAbsenceNow(shift: any, nowMs: number = Date.now()): boolean {
    if (!shift) return false;
    const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
    if (!absent || shift.isCompleted === true || shift.isPresent === true) return false;
    return !isRevertAbsenceExpired(shift, nowMs);
}
