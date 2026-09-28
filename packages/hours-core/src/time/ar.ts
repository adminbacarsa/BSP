const AR_OFFSET_MS = 3 * 3600 * 1000;

function arShifted(d: Date): Date {
    return new Date(d.getTime() - AR_OFFSET_MS);
}

export function arYmd(d: Date): string {
    const ar = arShifted(d);
    return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, '0')}-${String(ar.getUTCDate()).padStart(2, '0')}`;
}

export function arYearMonth(d: Date): { year: number; month: number } {
    const ar = arShifted(d);
    return { year: ar.getUTCFullYear(), month: ar.getUTCMonth() + 1 };
}

export function arMinutesOfDay(d: Date): number {
    const ar = arShifted(d);
    return ar.getUTCHours() * 60 + ar.getUTCMinutes();
}

/** Misma fecha AR de `base`, con la hora HH:mm en reloj AR. */
export function withArClock(base: Date, hours: number, minutes: number): Date {
    const ar = arShifted(base);
    return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), hours, minutes, 0, 0) + AR_OFFSET_MS);
}

export function ymdAddDays(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
