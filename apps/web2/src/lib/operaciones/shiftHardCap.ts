/** Espejo de `SHIFT_HARD_CAP_MS` en apps/functions/src/scheduling/shiftClose.ts (el servidor cierra al tope). */
export const SHIFT_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;

/** Tope de jornada: inicio real (o planificado si no fichó) + 12:59. */
export function shiftHardCapAt(workStart: Date | null | undefined): Date | null {
    if (!(workStart instanceof Date) || isNaN(workStart.getTime())) return null;
    return new Date(workStart.getTime() + SHIFT_HARD_CAP_MS);
}
