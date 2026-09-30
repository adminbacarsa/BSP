/** Helpers de la grilla para armar jornadas de eventuales (cruce 12 h y contrato). */
import type { JornadaEventual } from '@/components/eventuales/EventualesCandidatosPanel';

const CCT_BANDS: Record<string, { startTime: string; endTime: string; hours: number; name: string }> = {
    M:   { startTime: '07:00', endTime: '15:00', hours: 8,  name: 'Mañana' },
    T:   { startTime: '15:00', endTime: '23:00', hours: 8,  name: 'Tarde' },
    N:   { startTime: '23:00', endTime: '07:00', hours: 8,  name: 'Noche' },
    D12: { startTime: '07:00', endTime: '19:00', hours: 12, name: 'Diurno 12h' },
    N12: { startTime: '19:00', endTime: '07:00', hours: 12, name: 'Nocturno 12h' },
};

function hhmm(raw: unknown): string | null {
    const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function horasEntre(startTime: string, endTime: string): number {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let span = (eh * 60 + em) - (sh * 60 + sm);
    if (span <= 0) span += 24 * 60;
    return Math.round((span / 60) * 10) / 10;
}

/**
 * Jornada para una banda de la grilla. Usa el horario del SLA (`startTime`/`endTime` o `scheduleLabel`
 * "07:00–15:00") y cae a la tabla CCT por código.
 */
export function jornadaEventualDesdeBanda(
    fecha: string,
    code: string,
    opts: { startTime?: unknown; endTime?: unknown; scheduleLabel?: unknown; hours?: unknown } = {},
): JornadaEventual & { code: string; name: string } {
    const upper = String(code || 'M').toUpperCase();
    const cct = CCT_BANDS[upper] || CCT_BANDS.M;
    let startTime = hhmm(opts.startTime);
    let endTime = hhmm(opts.endTime);
    if (!startTime || !endTime) {
        const m = String(opts.scheduleLabel ?? '').match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
        if (m) { startTime = hhmm(m[1]); endTime = hhmm(m[2]); }
    }
    if (!startTime || !endTime) { startTime = cct.startTime; endTime = cct.endTime; }
    const hours = Number(opts.hours) > 0 ? Number(opts.hours) : horasEntre(startTime, endTime);
    return { fecha, horaInicio: startTime, horaFin: endTime, horas: hours, code: upper, name: CCT_BANDS[upper]?.name || upper };
}

/** Badge de fila para un legajo eventual. */
export function esLegajoEventual(emp: { modalidad?: unknown; bolsaCuil?: unknown } | null | undefined): boolean {
    return String(emp?.modalidad || '').toUpperCase() === 'EVENTUAL' || !!emp?.bolsaCuil;
}
