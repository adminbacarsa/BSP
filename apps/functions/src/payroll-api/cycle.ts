/**
 * Utilidades del ciclo CCT 422/05 (SUVICO).
 *
 * Convención del proyecto: ciclo de nómina del 26 del mes anterior al 25 del
 * mes "objetivo". El `cycleId` es el YYYY-MM del mes donde cae el corte (día 25).
 *
 *   cycleId "2026-05" → del 2026-04-26 al 2026-05-25 (hora Argentina).
 *
 * Importante: Cloud Functions corre en UTC. Hay que anclar el rango a ART
 * (-03:00), no a `new Date(y, m, d)` del server (que en CF es medianoche UTC).
 */
import * as admin from 'firebase-admin';

const PAD2 = (n: number) => String(n).padStart(2, '0');
/** Offset fijo Argentina (sin DST desde 2009). */
const AR_OFFSET = '-03:00';

export const DEFAULT_CYCLE_START_DAY = 26;
export const DEFAULT_CYCLE_END_DAY = 25;

export type CycleRange = {
    cycleId: string;
    cycleStart: Date;
    cycleEnd: Date;
    cycleStartStr: string;
    cycleEndStr: string;
};

/** Medianoche ART → Instant UTC. */
export function arDayStart(year: number, month1to12: number, day: number): Date {
    return new Date(
        `${year}-${PAD2(month1to12)}-${PAD2(day)}T00:00:00.000${AR_OFFSET}`,
    );
}

/** Fin de día ART (23:59:59.999) → Instant UTC. */
export function arDayEnd(year: number, month1to12: number, day: number): Date {
    return new Date(
        `${year}-${PAD2(month1to12)}-${PAD2(day)}T23:59:59.999${AR_OFFSET}`,
    );
}

export const parseCycleId = (cycleId: string): CycleRange | null => {
    const m = /^(\d{4})-(\d{2})$/.exec(cycleId);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!year || !month || month < 1 || month > 12) return null;

    // Inicio = día 26 del mes anterior (ART).
    const startAnchor = new Date(Date.UTC(year, month - 1, 1));
    startAnchor.setUTCMonth(startAnchor.getUTCMonth() - 1);
    const startY = startAnchor.getUTCFullYear();
    const startM = startAnchor.getUTCMonth() + 1;

    const cycleStart = arDayStart(startY, startM, DEFAULT_CYCLE_START_DAY);
    const cycleEnd = arDayEnd(year, month, DEFAULT_CYCLE_END_DAY);

    const fmt = (d: Date) => {
        // Formatear la fecha calendario en ART a partir del instant.
        const ar = new Date(d.getTime() - 3 * 3600 * 1000);
        return `${ar.getUTCFullYear()}-${PAD2(ar.getUTCMonth() + 1)}-${PAD2(ar.getUTCDate())}`;
    };

    return {
        cycleId,
        cycleStart,
        cycleEnd,
        cycleStartStr: fmt(cycleStart),
        cycleEndStr: fmt(cycleEnd),
    };
};

/** Devuelve los últimos N ciclos calendario hasta hoy (inclusive). */
export const listRecentCycles = (count = 12, ref: Date = new Date()): CycleRange[] => {
    const out: CycleRange[] = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 15);
        const id = `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}`;
        const range = parseCycleId(id);
        if (range) out.push(range);
    }
    return out;
};

/** Convierte Date a Timestamp Firestore. */
export const toTs = (d: Date): admin.firestore.Timestamp =>
    admin.firestore.Timestamp.fromDate(d);
