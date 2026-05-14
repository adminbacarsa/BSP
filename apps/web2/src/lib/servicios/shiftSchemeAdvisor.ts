/**
 * Asesor de esquema de rotación frente a la dotación declarada en un SLA (sin costeo).
 * Usa la misma noción de hs/día que `hoursForPositionOnDay` (viabilityAnalysis).
 */

import type { ServicePosition, ServiceSLA } from '@/services/slaService';
import { hoursForPositionOnDay, requiredConcurrentPaxForServiceDay } from '@/utils/viabilityAnalysis';

export type RotationSchemeId = '6x2' | '6x1' | '4x2';

export type SchemeFit = 'alta' | 'media' | 'baja';

export interface ShiftSchemeAdvice {
    positionSummaries: string[];
    /** Máx. Σ (hs puesto × cantidad) en un día del muestreo. */
    peakDailyCoverageHs: number;
    /** Promedio de esa suma en días laborables (L–V) del muestreo. */
    avgWeekdayCoverageHs: number;
    /** Máx. puestos en paralelo requeridos (día del muestreo). */
    peakConcurrentPax: number;
    issues: string[];
    schemes: Array<{
        id: RotationSchemeId;
        label: string;
        fit: SchemeFit;
        note: string;
    }>;
    primaryScheme: RotationSchemeId;
    primaryReason: string;
}

function parseYmd(s: string): Date | null {
    const core = (s || '').trim().slice(0, 10);
    if (core.length < 10) return null;
    const y = parseInt(core.slice(0, 4), 10);
    const mo = parseInt(core.slice(5, 7), 10);
    const d = parseInt(core.slice(8, 10), 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function totalCoverageHoursOnDay(
    srv: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions'>,
    day: Date,
): number {
    if (!srv.startDate || !srv.endDate) return 0;
    let sum = 0;
    for (const pos of srv.positions || []) {
        const h = hoursForPositionOnDay(pos, day, srv.startDate, srv.endDate);
        sum += h * (pos.quantity ?? 1);
    }
    return sum;
}

function customHoursOnDayLetter(pos: ServicePosition, dayLetter: string): number {
    if (pos.coverageType !== 'custom') return 0;
    let h = 0;
    for (const shift of pos.allowedShiftTypes || []) {
        if (!shift.days || shift.days.length === 0 || shift.days.includes(dayLetter)) {
            h += Number(shift.hours) || 0;
        }
    }
    return h;
}

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function summarizePosition(pos: ServicePosition, idx: number): string {
    const q = pos.quantity ?? 1;
    const name = pos.name || `Puesto ${idx + 1}`;
    if (pos.coverageType === '24hs') return `${q}× ${name} — 24 h (M+T+N o D12+N12)`;
    if (pos.coverageType === '12hs_diurno') return `${q}× ${name} — 12 h diurno`;
    if (pos.coverageType === '12hs_nocturno') return `${q}× ${name} — 12 h nocturno`;
    if (pos.coverageType === 'custom') {
        const n = (pos.allowedShiftTypes || []).length;
        return `${q}× ${name} — custom (${n} bloque${n !== 1 ? 's' : ''})`;
    }
    return `${q}× ${name} — ${pos.coverageType}`;
}

function has24hCoverage(positions: ServicePosition[]): boolean {
    return (positions || []).some((p) => p.coverageType === '24hs');
}

function has12hNocturno(positions: ServicePosition[]): boolean {
    return (positions || []).some((p) => p.coverageType === '12hs_nocturno');
}

export function analyzeShiftSchemesForService(srv: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions'>): ShiftSchemeAdvice {
    const positions = srv.positions || [];
    const issues: string[] = [];
    const positionSummaries = positions.map((p, i) => summarizePosition(p, i));

    if (!srv.startDate || !srv.endDate) {
        issues.push('Contrato sin fechas: no se puede muestrear el calendario.');
        return emptyAdvice(issues, positionSummaries);
    }
    if (positions.length === 0) {
        issues.push('Sin puestos definidos: no hay turnos que evaluar.');
        return emptyAdvice(issues, positionSummaries);
    }

    const start = parseYmd(srv.startDate);
    const end = parseYmd(srv.endDate);
    if (!start || !end || start > end) {
        issues.push('Rango de fechas inválido.');
        return emptyAdvice(issues, positionSummaries);
    }

    const sample: Date[] = [];
    const cur = new Date(start);
    const maxScan = 90;
    let n = 0;
    while (cur <= end && n < maxScan) {
        sample.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
        n++;
    }

    let peakDaily = 0;
    let peakConcurrent = 0;
    let weekdaySum = 0;
    let weekdayCount = 0;

    for (const day of sample) {
        const th = totalCoverageHoursOnDay(srv, day);
        peakDaily = Math.max(peakDaily, th);
        peakConcurrent = Math.max(peakConcurrent, requiredConcurrentPaxForServiceDay(srv, day));
        const dow = day.getDay();
        if (dow >= 1 && dow <= 5) {
            weekdaySum += th;
            weekdayCount++;
        }
    }

    const avgWeekday = weekdayCount > 0 ? weekdaySum / weekdayCount : peakDaily;

    for (const pos of positions) {
        if (pos.coverageType !== 'custom') continue;
        for (const letter of DAY_LETTERS) {
            const h = customHoursOnDayLetter(pos, letter) * (pos.quantity ?? 1);
            if (h > 24.01) {
                issues.push(
                    `Puesto «${pos.name || 'custom'}»: más de 24 h declaradas el mismo día (${letter}) — revisá solapamientos o bloques.`,
                );
            }
        }
    }

    if (peakDaily > 24 * 4 + 1e-6) {
        issues.push('Carga diaria muy alta: conviene validar solapes horarios y cantidad de puestos en paralelo.');
    }

    const h24 = has24hCoverage(positions);
    const hN12 = has12hNocturno(positions);

    const schemes: ShiftSchemeAdvice['schemes'] = [
        {
            id: '6x2',
            label: '6×2 (ciclo 8 d, 6 trabajo / 2 franco, típ. 8 h)',
            fit: 'media',
            note: 'Menos días de trabajo por ciclo: buena opción si la demanda diaria no exige demasiados cuerpos en paralelo.',
        },
        {
            id: '6x1',
            label: '6×1 (ciclo 7 d, 6 trabajo / 1 franco, 8 h)',
            fit: 'media',
            note: 'Más presencia mensual por cabeza que 6×2: suele encajar cuando hay más hs/día que en un 6×2 cómodo pero no justifica aún 12 h.',
        },
        {
            id: '4x2',
            label: '4×2 (ciclo 6 d, 4 trabajo / 2 franco, 12 h)',
            fit: 'media',
            note: 'Marco 12 h: típico con cobertura 24 h o mezcla fuerte día/noche y muchos puestos en paralelo.',
        },
    ];

    let primary: RotationSchemeId = '6x2';
    let primaryReason =
        'Por defecto 6×2 prioriza descanso; ajustá según pico diario y tipo de puestos (abajo el detalle por esquema).';

    if (h24 || peakDaily >= 36 || hN12) {
        primary = '4x2';
        primaryReason =
            'Hay cobertura 24 h, 12 h nocturna o pico diario alto: el marco 12 h del 4×2 suele alinear mejor con esas cargas.';
        schemes[0].fit = peakDaily < 28 ? 'media' : 'baja';
        schemes[1].fit = 'media';
        schemes[2].fit = 'alta';
        schemes[2].note =
            'Encaje alto: rotación 12 h encaja con presencia continua y reparto M/T/N o D12/N12 en puestos 24 h.';
    } else if (peakDaily >= 22 || avgWeekday >= 18) {
        primary = '6x1';
        primaryReason =
            'Demanda diaria media-alta sin marco 12 h obligatorio: 6×1 aporta más días de trabajo por ciclo que 6×2 sin saltar a 12 h.';
        schemes[0].fit = peakDaily > 26 ? 'baja' : 'media';
        schemes[1].fit = 'alta';
        schemes[2].fit = 'media';
    } else {
        schemes[0].fit = 'alta';
        schemes[1].fit = 'media';
        schemes[2].fit = 'baja';
        primaryReason =
            'Carga diaria moderada y sin 24 h duros: 6×2 suele ser el mejor compromiso fatiga / dotación.';
    }

    return {
        positionSummaries,
        peakDailyCoverageHs: Math.round(peakDaily * 10) / 10,
        avgWeekdayCoverageHs: Math.round(avgWeekday * 10) / 10,
        peakConcurrentPax: peakConcurrent,
        issues,
        schemes,
        primaryScheme: primary,
        primaryReason,
    };
}

function emptyAdvice(issues: string[], positionSummaries: string[]): ShiftSchemeAdvice {
    return {
        positionSummaries,
        peakDailyCoverageHs: 0,
        avgWeekdayCoverageHs: 0,
        peakConcurrentPax: 0,
        issues,
        schemes: [
            { id: '6x2', label: '6×2', fit: 'media', note: '—' },
            { id: '6x1', label: '6×1', fit: 'media', note: '—' },
            { id: '4x2', label: '4×2', fit: 'media', note: '—' },
        ],
        primaryScheme: '6x2',
        primaryReason: 'Sin datos suficientes.',
    };
}
