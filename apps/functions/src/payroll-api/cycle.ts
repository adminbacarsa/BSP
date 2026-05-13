/**
 * Utilidades del ciclo CCT 422/05 (SUVICO).
 *
 * Convención del proyecto: ciclo de nómina del 26 del mes anterior al 25 del
 * mes "objetivo". El `cycleId` es el YYYY-MM del mes donde cae el corte (día 25).
 *
 *   cycleId "2026-05" → del 2026-04-26 al 2026-05-25.
 *
 * Si más adelante se necesitan ciclos personalizados por empleado
 * (`payrollCycleStartDay/EndDay`), este archivo es el único lugar que hay
 * que tocar.
 */
import * as admin from 'firebase-admin';

const PAD2 = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_CYCLE_START_DAY = 26;
export const DEFAULT_CYCLE_END_DAY = 25;

export type CycleRange = {
    cycleId: string;
    cycleStart: Date;
    cycleEnd: Date;
    cycleStartStr: string;
    cycleEndStr: string;
};

export const parseCycleId = (cycleId: string): CycleRange | null => {
    const m = /^(\d{4})-(\d{2})$/.exec(cycleId);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!year || !month || month < 1 || month > 12) return null;

    const cycleStart = new Date(year, month - 2, DEFAULT_CYCLE_START_DAY, 0, 0, 0, 0);
    const cycleEnd = new Date(year, month - 1, DEFAULT_CYCLE_END_DAY, 23, 59, 59, 999);

    const fmt = (d: Date) =>
        `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`;

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
