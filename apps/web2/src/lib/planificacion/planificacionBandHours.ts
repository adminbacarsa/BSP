import { SHIFT_HOURS_LOOKUP } from '@/lib/planificacion/planificacionGridVisuals';
import { calcPlanningBillableShiftHours } from '@/lib/planificacion/planningScheduledHours';

/**
 * Horas de banda para cupos 8h vs 12h.
 * Prioriza la definición del puesto en el SLA (ej. M custom 08–20 = 12h), no el lookup CCT estándar (M=8).
 */
export function resolveBandHours(
    code: string | undefined | null,
    shiftLike?: { hours?: unknown; startTime?: unknown; endTime?: unknown } | null,
    posShifts?: Array<{ code?: string; hours?: unknown; startTime?: unknown; endTime?: unknown }> | null,
): number {
    const upper = String(code || '').toUpperCase();
    const fromSla = (posShifts || []).find((s) => String(s.code || '').toUpperCase() === upper);
    const slaH = Number(fromSla?.hours);
    if (slaH > 0) return slaH;
    const stored = Number(shiftLike?.hours);
    if (stored > 0) return stored;
    const st = fromSla?.startTime ?? shiftLike?.startTime;
    const en = fromSla?.endTime ?? shiftLike?.endTime;
    if (typeof st === 'string' && typeof en === 'string') {
        const parseH = (t: string) => {
            const m = t.match(/^(\d{1,2}):(\d{2})$/);
            return m ? +m[1] + +m[2] / 60 : null;
        };
        const s = parseH(st);
        const e = parseH(en);
        if (s !== null && e !== null) {
            let dur = e - s;
            if (Math.abs(dur) < 1 / 60) {
                /* cae al lookup CCT */
            } else {
                if (dur < 0) dur += 24;
                if (dur > 0 && dur <= 24) return dur;
            }
        }
    }
    return SHIFT_HOURS_LOOKUP[upper] ?? 8;
}

export const isShortBandHours = (hours: number) => hours < 12;

/** Puestos 24hs usan esquema CCT M+T+N / D12+N12. Custom: turnos con nombre libre. */
export function is24hCoverageType(pos: { coverageType?: unknown } | null | undefined): boolean {
    const cov = String(pos?.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

export const calcShiftHours = (
    shift: Parameters<typeof calcPlanningBillableShiftHours>[0],
    slaHoursHint?: Record<string, number>,
): number => calcPlanningBillableShiftHours(shift, slaHoursHint);
