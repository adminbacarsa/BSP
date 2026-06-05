/**
 * Asesor de esquema de rotación frente a la dotación declarada en un SLA (sin costeo).
 * Usa la misma noción de hs/día que `hoursForPositionOnDay` (viabilityAnalysis).
 */

import type { ServicePosition, ServiceSLA, ShiftVariant } from '@/services/slaService';
import { hoursForPositionOnDay, requiredConcurrentPaxForServiceDay } from '@/utils/viabilityAnalysis';

export type RotationSchemeId = '6x2' | '6x1' | '4x2';

export type SchemeFit = 'alta' | 'media' | 'baja';

/** Bloque custom vendido (hs) vs marcos CCT habituales 8h / 12h. */
export interface SoldShiftHourAnalysis {
    positionName: string;
    blockLabel: string;
    hours: number;
    indicativeMonthlyHsApprox: number;
    alignsWithCct8Or12: boolean;
    verdict: string;
    treatment: string;
}

/** Serie diaria de Σ hs cobertura (muestreo; para gráficos en UI). */
export interface CoverageDayPoint {
    /** Etiqueta corta (ej. 14/05). */
    label: string;
    hs: number;
}

/**
 * Complejidad para cubrir el servicio (planificación operativa), 1–10.
 * 1 = muy sencillo (p. ej. todo 24 h homogéneo), 10 = muy exigente.
 */
export interface CoverComplexityRating {
    /** 1–10 operativo; 0 = no se pudo evaluar. */
    score: number;
    label: string;
    reasons: string[];
}

export interface ShiftSchemeAdvice {
    positionSummaries: string[];
    /** Máx. Σ (hs puesto × cantidad) en un día del muestreo. */
    peakDailyCoverageHs: number;
    /** Promedio de esa suma en días laborables (L–V) del muestreo. */
    avgWeekdayCoverageHs: number;
    /** Máx. puestos en paralelo requeridos (día del muestreo). */
    peakConcurrentPax: number;
    issues: string[];
    soldShiftAnalyses: SoldShiftHourAnalysis[];
    schemes: Array<{
        id: RotationSchemeId;
        label: string;
        fit: SchemeFit;
        note: string;
    }>;
    primaryScheme: RotationSchemeId;
    primaryReason: string;
    /** Hasta ~30 puntos espaciados sobre el rango muestreado (máx. 90 días). */
    coverageByDay: CoverageDayPoint[];
    coverComplexity: CoverComplexityRating;
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
    srv: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions' | 'excludedDates'>,
    day: Date,
): number {
    if (!srv.startDate || !srv.endDate) return 0;
    let sum = 0;
    for (const pos of srv.positions || []) {
        const h = hoursForPositionOnDay(pos, day, srv.startDate, srv.endDate, srv.excludedDates);
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

function dayLetterFromDate(day: Date): string {
    return DAY_LETTERS[day.getDay()];
}

function formatDayLabel(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
}

function downsampleEvenly<T>(arr: T[], max: number): T[] {
    if (arr.length <= max) return arr;
    const out: T[] = [];
    const last = arr.length - 1;
    for (let i = 0; i < max; i++) {
        out.push(arr[Math.round((i * last) / (max - 1))]);
    }
    return out;
}

function positionActiveOnLetter(pos: ServicePosition, letter: string): boolean {
    if (!pos.activeDays || pos.activeDays.length === 0) return true;
    return pos.activeDays.includes(letter);
}

function shiftAppliesOnDay(shift: ShiftVariant, letter: string): boolean {
    if (!shift.days || shift.days.length === 0) return true;
    return shift.days.includes(letter);
}

function isCctStandardBlockHours(h: number): boolean {
    return Math.abs(h - 8) < 0.05 || Math.abs(h - 12) < 0.05;
}

function verdictTreatmentForSoldHours(h: number): { verdict: string; treatment: string } {
    if (isCctStandardBlockHours(h)) {
        return {
            verdict: 'Marco habitual SUVICO (8 h o 12 h).',
            treatment: 'Coherente con M/T/N o D12/N12 según el tipo de puesto.',
        };
    }
    if (Math.abs(h - 9) < 0.05) {
        return {
            verdict:
                '9 h no es estándar CCT: queda “entre” 8 h y 12 h y suele complicar encadenar descansos y el reparto M/T/N sin sobras incómodas.',
            treatment:
                'Conviene reformular a 8 h (dos bloques o reorden de franja) o subir a 12 h (D12) si el servicio admite marco largo único; evitá dejar 9 h como jornada “típica” del contrato.',
        };
    }
    if (Math.abs(h - 10) < 0.05) {
        return {
            verdict:
                '10 h es un mal punto intermedio: sube fuerte la carga mensual por cabeza (del orden de ~220 h/mes en L–V) y no encaja en turnos base 8/12 h CCT.',
            treatment:
                'Priorizá vender/planificar 12 h (D12 o N12 según caso) o bajar a 8 h + refuerzo en otro puesto; 10 h genera presión alta en rotación y francos.',
        };
    }
    if (h > 12.01) {
        return {
            verdict: 'Más de 12 h en un solo bloque supera la jornada típica de un tramo CCT.',
            treatment: 'Dividí en D12/N12 o en dos bloques con descanso intermedio; validá con legal.',
        };
    }
    if (h < 8 - 0.05 && h >= 4) {
        return {
            verdict: 'Jornada corta: puede ser válida pero suele “romper” simetría con el resto del anillo de turnos.',
            treatment: 'Alinear con bloques de 8 h o concentrar horas en menos tramos para simplificar ciclos.',
        };
    }
    return {
        verdict: `Las ${Math.round(h * 100) / 100} h no son marco estándar 8/12 h: dificulta rotaciones y acople con 6×2 / 4×2.`,
        treatment: 'Aproximá a 8 h o 12 h según cobertura diurna extendida o puesto 24 h.',
    };
}

function approximateMonthlyHsForBlock(sample: Date[], pos: ServicePosition, shift: ShiftVariant, q: number): number {
    const h = Number(shift.hours) || 0;
    if (h <= 0 || sample.length === 0) return 0;
    let sum = 0;
    for (const day of sample) {
        const letter = dayLetterFromDate(day);
        if (!positionActiveOnLetter(pos, letter)) continue;
        if (!shiftAppliesOnDay(shift, letter)) continue;
        sum += h * q;
    }
    const factor = 30 / sample.length;
    return Math.round(sum * factor);
}

/** Solo bloques custom cuyas hs no son 8 ni 12 (marco CCT habitual). */
function buildNonStandardSoldShiftAnalyses(sample: Date[], positions: ServicePosition[]): SoldShiftHourAnalysis[] {
    const out: SoldShiftHourAnalysis[] = [];
    for (const pos of positions) {
        if (pos.coverageType !== 'custom') continue;
        const q = pos.quantity ?? 1;
        const pname = pos.name || 'Custom';
        let bi = 0;
        for (const shift of pos.allowedShiftTypes || []) {
            const h = Number(shift.hours) || 0;
            if (h < 1e-6) continue;
            bi++;
            const label = shift.name || shift.code || `Bloque ${bi}`;
            if (isCctStandardBlockHours(h)) continue;
            const approx = approximateMonthlyHsForBlock(sample, pos, shift, q);
            const vt = verdictTreatmentForSoldHours(h);
            out.push({
                positionName: pname,
                blockLabel: label,
                hours: Math.round(h * 100) / 100,
                indicativeMonthlyHsApprox: approx,
                alignsWithCct8Or12: false,
                verdict: vt.verdict,
                treatment: vt.treatment,
            });
        }
    }
    return out;
}

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

function clampCoverScore(n: number): number {
    return Math.max(1, Math.min(10, Math.round(n)));
}

function coverComplexityLabel(score: number): string {
    if (score <= 2) return 'Muy baja';
    if (score <= 4) return 'Baja';
    if (score <= 6) return 'Media';
    if (score <= 8) return 'Alta';
    return 'Muy alta';
}

/**
 * Heurística orientativa: homogeneidad 24 h baja la nota; custom, picos y pax en paralelo la suben.
 */
function buildCoverComplexityRating(
    positions: ServicePosition[],
    peakDaily: number,
    peakConcurrent: number,
    soldShiftAnalyses: SoldShiftHourAnalysis[],
    issues: string[],
): CoverComplexityRating {
    const n = positions.length;
    let s = 5;
    const reasons: string[] = [];

    const types = new Set(positions.map((p) => p.coverageType));
    const all24 = n > 0 && positions.every((p) => p.coverageType === '24hs');
    const customPositions = positions.filter((p) => p.coverageType === 'custom');
    const customCount = customPositions.length;
    const maxBlocksOnePos = Math.max(0, ...customPositions.map((p) => (p.allowedShiftTypes || []).length));

    const structuralIssues = issues.filter((t) => !t.includes('Hay bloques custom fuera de 8h/12h CCT'));

    if (all24) {
        s -= 3.5;
        reasons.push('Todo 24 h homogéneo: patrón clásico (M/T/N o D12/N12) y suele ser lo más directo de cubrir.');
    } else if (types.size === 1 && (types.has('12hs_diurno') || types.has('12hs_nocturno'))) {
        s -= 2;
        reasons.push('Un solo tipo en franja 12 h: menos reglas que un mix o custom.');
    }

    if (customCount > 0) {
        s += 1 + Math.min(2, customCount - 1) * 0.75;
        reasons.push(`${customCount} puesto(s) custom: más combinaciones por día y por bloque.`);
    }

    if (maxBlocksOnePos >= 3) {
        s += 1.25;
        reasons.push('Varios bloques custom en un mismo puesto: más riesgo de solapes y excepciones.');
    }

    if (soldShiftAnalyses.length > 0) {
        s += Math.min(3, 1.25 + soldShiftAnalyses.length * 0.45);
        reasons.push('Hs vendidas fuera de 8/12 h CCT: encadenar descansos y rotación suele costar más.');
    }

    if (peakConcurrent >= 8) {
        s += 2;
        reasons.push(`Pico de ${peakConcurrent} personas en paralelo: más coordinación y vacantes visibles.`);
    } else if (peakConcurrent >= 4) {
        s += 1.25;
        reasons.push(`Hasta ${peakConcurrent} personas en paralelo en el pico del muestreo.`);
    } else if (peakConcurrent >= 2) {
        s += 0.35;
    }

    if (peakDaily >= 80) {
        s += 2;
        reasons.push(`Pico diario muy alto (${Math.round(peakDaily)} hs efectivas): densidad fuerte.`);
    } else if (peakDaily >= 48) {
        s += 1.25;
        reasons.push(`Pico diario elevado (${Math.round(peakDaily)} hs): conviene validar solapes y refuerzos.`);
    } else if (peakDaily >= 32) {
        s += 0.5;
    }

    if (n >= 8) {
        s += 1.5;
        reasons.push('Muchos puestos declarados: más aristas entre coberturas y reemplazos.');
    } else if (n >= 4) {
        s += 0.75;
    }

    if (types.size >= 3) {
        s += 1;
        reasons.push('Mezcla de varios tipos de cobertura (24 h, 12 h, custom…): más casos borde.');
    } else if (types.size === 2 && !all24) {
        s += 0.35;
    }

    if (structuralIssues.length > 0) {
        s += Math.min(2, structuralIssues.length * 0.55);
        reasons.push('Hay advertencias de coherencia en el modelo (fechas, solapes, etc.).');
    }

    if (n === 1 && customCount === 0 && peakConcurrent <= 1 && peakDaily < 20) {
        s -= 1.25;
        if (reasons.length === 0) {
            reasons.push('Poca dotación y demanda acotada: en general más simple de sostener.');
        }
    }

    const score = clampCoverScore(s);
    const uniq: string[] = [];
    for (const r of reasons) {
        if (!uniq.includes(r)) uniq.push(r);
    }
    const finalReasons = uniq.slice(0, 4);
    if (finalReasons.length === 0) {
        finalReasons.push('Complejidad acorde a la carga diaria y tipos de puesto modelados.');
    }

    return { score, label: coverComplexityLabel(score), reasons: finalReasons };
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
    const coverageRaw: CoverageDayPoint[] = [];

    for (const day of sample) {
        const th = totalCoverageHoursOnDay(srv, day);
        coverageRaw.push({ label: formatDayLabel(day), hs: Math.round(th * 10) / 10 });
        peakDaily = Math.max(peakDaily, th);
        peakConcurrent = Math.max(peakConcurrent, requiredConcurrentPaxForServiceDay(srv, day));
        const dow = day.getDay();
        if (dow >= 1 && dow <= 5) {
            weekdaySum += th;
            weekdayCount++;
        }
    }

    const coverageByDay = downsampleEvenly(coverageRaw, 30);

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

    const soldShiftAnalyses = buildNonStandardSoldShiftAnalyses(sample, positions);
    if (soldShiftAnalyses.length > 0) {
        issues.push('Hay bloques custom fuera de 8h/12h CCT: encarecen planificación y descansos (ver “Lo vendido vs conviene”).');
        if (!h24 && peakDaily < 36) {
            primaryReason += ' Ojo: lo vendido en hs de turno no siempre ayuda al esquema elegido.';
        }
    }

    const coverComplexity = buildCoverComplexityRating(positions, peakDaily, peakConcurrent, soldShiftAnalyses, issues);

    return {
        positionSummaries,
        peakDailyCoverageHs: Math.round(peakDaily * 10) / 10,
        avgWeekdayCoverageHs: Math.round(avgWeekday * 10) / 10,
        peakConcurrentPax: peakConcurrent,
        issues,
        soldShiftAnalyses,
        schemes,
        primaryScheme: primary,
        primaryReason,
        coverageByDay,
        coverComplexity,
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
        soldShiftAnalyses: [],
        coverageByDay: [],
        coverComplexity: {
            score: 0,
            label: 'Sin evaluar',
            reasons: ['Completá fechas y puestos del contrato para obtener una calificación.'],
        },
    };
}
