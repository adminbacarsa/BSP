import { SHIFT_RANGES } from '@/lib/planificacion/planificacionGridVisuals';

export function formatPlanificacionTime(dateInput: unknown): string {
    if (!dateInput) return '--:--';
    if (typeof dateInput === 'string' && /^\d{1,2}:\d{2}$/.test(dateInput.trim())) return dateInput.trim();
    const d = (dateInput as { toDate?: () => Date }).toDate
        ? (dateInput as { toDate: () => Date }).toDate()
        : new Date(dateInput as string | number | Date);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function formatShiftScheduleLabel(
    shift: { startTime?: unknown; endTime?: unknown } | null | undefined,
    bandCode: string,
    formatTime: (dateInput: unknown) => string = formatPlanificacionTime,
): string {
    const bandFallback = SHIFT_RANGES[String(bandCode || '').toUpperCase()] || '—';
    const isSameClock = (a: string, b: string) => {
        const norm = (t: string) => {
            const raw = String(t || '').trim().toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/\./g, '');
            if (/^(0?0:00|12:00\s*a\s*m)$/.test(raw)) return '00:00';
            const m = raw.match(/^(\d{1,2}):(\d{2})/);
            if (!m) return raw;
            return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
        };
        return norm(a) === norm(b);
    };

    if (typeof shift?.startTime === 'string' && typeof shift?.endTime === 'string') {
        const s = shift.startTime.trim();
        const e = shift.endTime.trim();
        if (s && e && !isSameClock(s, e)) return `${s} - ${e}`;
        return bandFallback;
    }
    if (shift?.startTime && shift?.endTime && typeof shift.startTime !== 'string') {
        const s = formatTime(shift.startTime);
        const e = formatTime(shift.endTime);
        if (s !== '--:--' && e !== '--:--' && !isSameClock(s, e)) return `${s} - ${e}`;
    }
    return bandFallback;
}

/** Partes start/end para UI; si start≈end usa banda CCT (nunca fingir 24h). */
export function resolveShiftDisplayClockParts(
    shift: { startTime?: unknown; endTime?: unknown } | null | undefined,
    bandCode: string,
    formatTime: (dateInput: unknown) => string = formatPlanificacionTime,
): { start: string; end: string; usedBandFallback: boolean } {
    const label = formatShiftScheduleLabel(shift, bandCode, formatTime);
    const parts = String(label).split(/\s*[-–—]\s*/);
    if (parts.length >= 2 && parts[0] && parts[1] && parts[0] !== '—') {
        const band = SHIFT_RANGES[String(bandCode || '').toUpperCase()];
        const usedBandFallback = !!band && label === band;
        return { start: parts[0].trim(), end: parts[1].trim(), usedBandFallback };
    }
    return { start: '--:--', end: '--:--', usedBandFallback: true };
}
