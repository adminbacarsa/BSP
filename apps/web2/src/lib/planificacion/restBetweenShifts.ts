/**
 * Descansos entre turnos (SUVICO y convenios con campos opcionales).
 * - Mínimo entre turnos laborales: 10 h (configurable, `SUVICO_POLICY.REST.DAILY_MIN_HOURS`).
 * - Tras ≥48 h trabajadas en racha consecutiva (con descansos de 12 h entre medio):
 *   35 h desde el fin del último turno hasta el inicio del siguiente.
 * - El campo opcional `longRestAfterConsecutiveWorkDays` permite a otros convenios
 *   exigir el descanso largo también por días seguidos, pero SUVICO no lo usa.
 */
import { getDateKey } from './utils';
import { SUVICO_POLICY } from './suvicoPolicy';

const DEFAULT_MIN_REST = SUVICO_POLICY.REST.DAILY_MIN_HOURS;
const DEFAULT_STREAK_THRESHOLD = SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST;
const DEFAULT_LONG_REST = SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS;

/**
 * Códigos que ROMPEN la racha de trabajo consecutivo (francos reales y licencias).
 * RET (retén) no rompe ni suma: se saltea al contar días facturables consecutivos.
 */
const STREAK_BREAK_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const RET_CODE = 'RET';

const NIGHT_BANDS = new Set(['N', 'N12']);
const MORNING_BANDS = new Set(['M', 'D12']);
const EVENING_BANDS = new Set(['T']);

/** T → M/D12 al día siguiente: ~8h de descanso (< 12h mín.). */
export const forbiddenEveningToMorningWithoutBreak = (prevCode: string, nextCode: string): boolean => {
    const p = String(prevCode || '').toUpperCase();
    const n = String(nextCode || '').toUpperCase();
    return EVENING_BANDS.has(p) && MORNING_BANDS.has(n);
};

export const forbiddenMorningToNightWithoutBreak = (prevCode: string, nextCode: string): boolean => {
    const p = String(prevCode || '').toUpperCase();
    const n = String(nextCode || '').toUpperCase();
    return MORNING_BANDS.has(p) && NIGHT_BANDS.has(n);
};

/** N/N12 → M/D12 en días laborales consecutivos (sin F/FF/FP/FT entre medias). */
export const forbiddenNightToMorningWithoutBreak = (prevCode: string, nextCode: string): boolean => {
    const p = String(prevCode || '').toUpperCase();
    const n = String(nextCode || '').toUpperCase();
    return NIGHT_BANDS.has(p) && MORNING_BANDS.has(n);
};

/** N/N12 → cualquier banda distinta (T/M/D12…) sin franco real intermedio. */
export const forbiddenNightToNonNightWithoutBreak = (prevCode: string, nextCode: string): boolean => {
    const p = String(prevCode || '').toUpperCase();
    const n = String(nextCode || '').toUpperCase();
    return NIGHT_BANDS.has(p) && !!n && !NIGHT_BANDS.has(n);
};

/**
 * Hacia atrás desde el día anterior al propuesto: si aparece N/N12 antes de un
 * franco real (F/FF/FP/FT), un turno distinto de noche ese día estaría prohibido.
 * RET y días vacíos se saltan (no son descanso legal).
 */
export const nightBlocksNonNightWithoutFranco = (
    empId: string,
    targetDateStr: string,
    getShift: (eid: string, ds: string) => any | null,
): boolean => {
    let d = addDaysStr(targetDateStr, -1);
    for (let i = 0; i < 40; i++) {
        const sh = getShift(empId, d);
        if (!sh || sh.isDeleted) return false;
        const code = String(sh.code || sh.type || '').toUpperCase();
        if (STREAK_BREAK_CODES.has(code)) return false;
        if (isWorkShift(sh)) return NIGHT_BANDS.has(code);
        d = addDaysStr(d, -1);
    }
    return false;
};

/** @deprecated Usar nightBlocksNonNightWithoutFranco */
export const nightBlocksMorningWithoutFranco = nightBlocksNonNightWithoutFranco;

const HOURS_BY_CODE: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
    /** Encargada/Admin típico L–V (9 h); el SLA puede traer otras horas en la celda. */
    EN: 9,
    P: 8,
    /** RET = retén (stand-by, 0h facturables); sin esta entrada el fallback ?? 8 inflaba la racha. */
    RET: 0,
};

/** Defaults de reloj si la celda no trae start/end (protocolo 8+8+8 — alineado con fixedBandFloater). */
const END_DEF: Record<string, number> = { M: 15, T: 23, N: 7, D12: 19, N12: 7 };
const START_DEF: Record<string, number> = { M: 7, T: 15, N: 23, D12: 7, N12: 19 };

/** Horario HH:mm por código cuando la celda no trae `startTime` válido. */
export const DEFAULT_SHIFT_START: Record<string, string> = {
    M: '07:00', T: '15:00', N: '23:00', D12: '07:00', N12: '19:00', EN: '09:00',
};

export const resolveWorkShiftStartTime = (code: string, startTime?: string | null): string => {
    const c = String(code || '').toUpperCase();
    if (!startTime || startTime === '00:00') return DEFAULT_SHIFT_START[c] || '07:00';
    return startTime;
};

const fmtHm = (d: Date): string => {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
};

const fmtDateShort = (dateStr: string): string => {
    const [, month, day] = dateStr.split('-');
    return `${day}/${month}`;
};

/** Etiqueta legible: `08/07 M (07:00→15:00)` o con fin al día siguiente. */
export const describeShiftSchedule = (dateStr: string, sh: any): string => {
    const code = String(sh?.code || sh?.type || '?').toUpperCase();
    const se = getShiftStartEndAbs(dateStr, sh);
    if (!se) return `${fmtDateShort(dateStr)} ${code}`;
    const endDateKey = getDateKey(se.end);
    const overnight = endDateKey !== dateStr;
    const endPart = overnight
        ? `${fmtDateShort(endDateKey)} ${fmtHm(se.end)}`
        : fmtHm(se.end);
    return `${fmtDateShort(dateStr)} ${code} (${fmtHm(se.start)}→${endPart})`;
};

const parseHour = (t: any): number | null => {
    if (t == null || t === '' || t === '00:00') return null;
    if (typeof t === 'string') {
        const parts = t.split(':').map(Number);
        const h = parts[0], m = parts[1] ?? 0;
        if (Number.isNaN(h)) return null;
        return h + (m || 0) / 60;
    }
    return null;
};

const shiftHours = (sh: any): number => {
    const code = String(sh?.code || sh?.type || '').toUpperCase();
    const n = Number(sh?.hours);
    if (n > 0) return n;
    return HOURS_BY_CODE[code] ?? 8;
};

export const isWorkShift = (sh: any | null | undefined): boolean => {
    if (!sh || sh.isDeleted) return false;
    const code = String(sh.code || sh.type || '').toUpperCase();
    if (!code) return false;
    if (STREAK_BREAK_CODES.has(code)) return false;
    return shiftHours(sh) > 0;
};

export const addDaysStr = (dateStr: string, delta: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return getDateKey(dt);
};

const localDateTime = (dateStr: string, hourFloat: number): Date => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const h = Math.floor(hourFloat);
    const min = Math.round((hourFloat - h) * 60);
    return new Date(y, m - 1, d, h, min, 0, 0);
};

/** Inicio y fin absolutos (Date) del turno; el fin puede caer el día calendario siguiente (N, N12). */
export const getShiftStartEndAbs = (dateStr: string, sh: any): { start: Date; end: Date } | null => {
    if (!isWorkShift(sh)) return null;
    const code = String(sh.code || sh.type || '').toUpperCase();
    let startH = parseHour(sh.startTime);
    if (startH === null) startH = START_DEF[code] ?? 7;
    let endH = parseHour(sh.endTime);
    const hrs = shiftHours(sh);
    if (endH === null && hrs > 0) endH = (startH + hrs) % 24;
    if (endH === null) endH = END_DEF[code] ?? 15;
    const start = localDateTime(dateStr, startH);
    const overnight = endH < startH - 1e-6;
    const endDateStr = overnight ? addDaysStr(dateStr, 1) : dateStr;
    const end = localDateTime(endDateStr, endH);
    return { start, end };
};

const hoursBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 3600000;

/**
 * Horas y cantidad de DÍAS facturables consecutivos hacia atrás desde
 * `fromDateStr` (inclusive).
 *  - F / FF / FP / FT / licencias → rompen la racha.
 *  - RET (retén): transparente — no suma ni corta; se sigue leyendo hacia atrás.
 *  - Turno real (M/T/N/D12/N12/etc) → cuenta como día y suma sus horas.
 *  - Día vacío (sin asignación) → rompe la racha.
 */
export const workStreakStatsBackward = (
    empId: string,
    fromDateStr: string,
    getShift: (eid: string, ds: string) => any | null
): { hours: number; workDays: number } => {
    let hours = 0;
    let workDays = 0;
    let d = fromDateStr;
    for (let i = 0; i < 40; i++) {
        const sh = getShift(empId, d);
        if (!sh || sh.isDeleted) break;
        const code = String(sh.code || sh.type || '').toUpperCase();
        if (STREAK_BREAK_CODES.has(code)) break;
        if (code === RET_CODE) {
            d = addDaysStr(d, -1);
            continue;
        }
        const h = shiftHours(sh);
        if (h <= 0) break;
        hours += h;
        workDays += 1;
        d = addDaysStr(d, -1);
    }
    return { hours, workDays };
};

export const workStreakHoursBackward = (
    empId: string,
    fromDateStr: string,
    getShift: (eid: string, ds: string) => any | null
): number => workStreakStatsBackward(empId, fromDateStr, getShift).hours;

/**
 * Igual que `workStreakStatsBackward` pero contando hacia adelante,
 * empezando EXCLUSIVO desde `fromDateStr` (no lo incluye).
 */
export const workStreakStatsForward = (
    empId: string,
    fromDateStr: string,
    getShift: (eid: string, ds: string) => any | null
): { hours: number; workDays: number } => {
    let hours = 0;
    let workDays = 0;
    let d = addDaysStr(fromDateStr, 1);
    for (let i = 0; i < 40; i++) {
        const sh = getShift(empId, d);
        if (!sh || sh.isDeleted) break;
        const code = String(sh.code || sh.type || '').toUpperCase();
        if (STREAK_BREAK_CODES.has(code)) break;
        if (code === RET_CODE) {
            d = addDaysStr(d, 1);
            continue;
        }
        const h = shiftHours(sh);
        if (h <= 0) break;
        hours += h;
        workDays += 1;
        d = addDaysStr(d, 1);
    }
    return { hours, workDays };
};

const findPrevWorkBoundary = (
    empId: string,
    beforeDateStr: string,
    getShift: (eid: string, ds: string) => any | null
): { dateStr: string; shift: any; end: Date } | null => {
    let d = addDaysStr(beforeDateStr, -1);
    for (let i = 0; i < 40; i++) {
        const sh = getShift(empId, d);
        if (isWorkShift(sh)) {
            const se = getShiftStartEndAbs(d, sh!);
            if (!se) return null;
            return { dateStr: d, shift: sh, end: se.end };
        }
        d = addDaysStr(d, -1);
    }
    return null;
};

const findNextWorkBoundary = (
    empId: string,
    afterDateStr: string,
    getShift: (eid: string, ds: string) => any | null
): { dateStr: string; shift: any; start: Date } | null => {
    let d = addDaysStr(afterDateStr, 1);
    for (let i = 0; i < 40; i++) {
        const sh = getShift(empId, d);
        if (isWorkShift(sh)) {
            const se = getShiftStartEndAbs(d, sh!);
            if (!se) return null;
            return { dateStr: d, shift: sh, start: se.start };
        }
        d = addDaysStr(d, 1);
    }
    return null;
};

export type AgreementRestConfig = {
    minRestBetweenShiftsHours?: number;
    longRestAfterWorkedHours?: number;
    minLongRestHours?: number;
    /** Si está definido (>0), tras esta cantidad de días seguidos con turno laboral también exige `minLongRestHours`. */
    longRestAfterConsecutiveWorkDays?: number;
    /**
     * BLOQUEO duro de ciclo: si está definido (>0), no se permite que la racha de
     * trabajo (incluyendo el turno propuesto) supere este número de días.
     * Pensado para usar `cL` del ciclo elegido (6+2 → 6, 4+2 → 4, etc.).
     */
    maxConsecutiveWorkDays?: number;
};

export const getAgreementRestConfig = (emp: any, agreements: any[]): AgreementRestConfig | null => {
    const name = String(emp?.laborAgreement || '').toLowerCase();
    const rule =
        agreements.find((a: any) => a.name === emp?.laborAgreement) ||
        agreements.find((a: any) => String(a?.name || '').toLowerCase() === 'general');
    const r: any = rule || {};
    const num = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };
    const custom: AgreementRestConfig = {};
    const a = num(r.minRestBetweenShiftsHours);
    const b = num(r.longRestAfterWorkedHours);
    const c = num(r.minLongRestHours);
    const d = num(r.longRestAfterConsecutiveWorkDays);
    if (a !== undefined) custom.minRestBetweenShiftsHours = a;
    if (b !== undefined) custom.longRestAfterWorkedHours = b;
    if (c !== undefined) custom.minLongRestHours = c;
    if (d !== undefined) custom.longRestAfterConsecutiveWorkDays = d;
    if (Object.keys(custom).length > 0) return custom;
    if (name.includes('suvico') || String(r?.name || '').toLowerCase().includes('suvico') || r.suvicoRestRules) {
        // CCT 422/05 SUVICO: 10h entre turnos; 35h cuando se acumularon 48h de trabajo
        // (con descansos entre medio). También por 6 días consecutivos de racha.
        return {
            minRestBetweenShiftsHours: DEFAULT_MIN_REST,
            longRestAfterWorkedHours: DEFAULT_STREAK_THRESHOLD,
            minLongRestHours: DEFAULT_LONG_REST,
            longRestAfterConsecutiveWorkDays: SUVICO_POLICY.REST.STREAK_SHIFTS_8H,
        };
    }
    return null;
};

export type RestCheckViolation = {
    message: string;
    proposedSchedule: string;
    neighborBefore?: string;
    neighborAfter?: string;
    gapHours?: number;
    requiredRestHours?: number;
};

export type RestCheckParams = {
    empId: string;
    targetDateStr: string;
    proposed: { code: string; startTime?: string; endTime?: string; hours?: number };
    /** Estado fusionado: debe reflejar pending + shiftsMap, y el turno propuesto en targetDateStr. */
    getShift: (eid: string, ds: string) => any | null;
    cfg: AgreementRestConfig;
};

/**
 * Devuelve detalle de advertencia o null si cumple.
 */
export const checkRestBetweenShiftsDetail = (p: RestCheckParams): RestCheckViolation | null => {
    const minRest = Number.isFinite(p.cfg.minRestBetweenShiftsHours!) ? p.cfg.minRestBetweenShiftsHours! : DEFAULT_MIN_REST;
    const thr = Number.isFinite(p.cfg.longRestAfterWorkedHours!) ? p.cfg.longRestAfterWorkedHours! : DEFAULT_STREAK_THRESHOLD;
    const longRest = Number.isFinite(p.cfg.minLongRestHours!) ? p.cfg.minLongRestHours! : DEFAULT_LONG_REST;
    const thrDaysRaw = p.cfg.longRestAfterConsecutiveWorkDays;
    const thrDays = Number.isFinite(thrDaysRaw!) && (thrDaysRaw as number) > 0 ? (thrDaysRaw as number) : undefined;

    const proposedShift = {
        code: p.proposed.code,
        startTime: resolveWorkShiftStartTime(p.proposed.code, p.proposed.startTime),
        endTime: p.proposed.endTime,
        hours: p.proposed.hours,
    };
    const seNew = getShiftStartEndAbs(p.targetDateStr, proposedShift);
    if (!seNew) return null;

    const proposedSchedule = describeShiftSchedule(p.targetDateStr, proposedShift);
    const newCode = String(p.proposed.code || '').toUpperCase();
    if (!NIGHT_BANDS.has(newCode) && nightBlocksNonNightWithoutFranco(p.empId, p.targetDateStr, p.getShift)) {
        return {
            message: 'Tras noche (N/N12) debe haber franco (F/FF/FP/FT) antes del siguiente turno (mín. 12h de descanso).',
            proposedSchedule,
        };
    }

    const prevCalDate = addDaysStr(p.targetDateStr, -1);
    const prevCal = p.getShift(p.empId, prevCalDate);
    if (prevCal && isWorkShift(prevCal)) {
        const prevCode = String(prevCal.code || prevCal.type || '').toUpperCase();
        if (forbiddenEveningToMorningWithoutBreak(prevCode, newCode)) {
            const prevSchedule = describeShiftSchedule(prevCalDate, prevCal);
            return {
                message: `T→M consecutivo prohibido: ${prevSchedule} → ${proposedSchedule} (mín. 12h entre tarde y mañana del día siguiente).`,
                proposedSchedule,
                neighborBefore: prevSchedule,
            };
        }
    }

    const prev = findPrevWorkBoundary(p.empId, p.targetDateStr, p.getShift);
    if (prev) {
        const streakBeforePrev = workStreakStatsBackward(p.empId, prev.dateStr, p.getShift);
        const needLong =
            streakBeforePrev.hours >= thr ||
            (thrDays !== undefined && streakBeforePrev.workDays >= thrDays);
        const need = needLong ? longRest : minRest;
        const gap = hoursBetween(prev.end, seNew.start);
        if (gap + 1e-6 < need) {
            const prevSchedule = describeShiftSchedule(prev.dateStr, prev.shift);
            return {
                message: `Convenio: descanso insuficiente respecto al turno anterior — ${prevSchedule} → ${proposedSchedule}: ${gap.toFixed(1)}h < ${need}h (racha previa ~${streakBeforePrev.hours}h / ${streakBeforePrev.workDays}d).`,
                proposedSchedule,
                neighborBefore: prevSchedule,
                gapHours: gap,
                requiredRestHours: need,
            };
        }
    }

    const next = findNextWorkBoundary(p.empId, p.targetDateStr, p.getShift);
    if (next) {
        const streakEndingAtProposed = workStreakStatsBackward(p.empId, p.targetDateStr, p.getShift);
        const needLongAfter =
            streakEndingAtProposed.hours >= thr ||
            (thrDays !== undefined && streakEndingAtProposed.workDays >= thrDays);
        const needAfter = needLongAfter ? longRest : minRest;
        const gap2 = hoursBetween(seNew.end, next.start);
        if (gap2 + 1e-6 < needAfter) {
            const nextSchedule = describeShiftSchedule(next.dateStr, next.shift);
            return {
                message: `Convenio: descanso insuficiente respecto al turno siguiente — ${proposedSchedule} → ${nextSchedule}: ${gap2.toFixed(1)}h < ${needAfter}h (racha que termina este día ~${streakEndingAtProposed.hours}h / ${streakEndingAtProposed.workDays}d).`,
                proposedSchedule,
                neighborAfter: nextSchedule,
                gapHours: gap2,
                requiredRestHours: needAfter,
            };
        }
    }

    const maxConsRaw = p.cfg.maxConsecutiveWorkDays;
    if (Number.isFinite(maxConsRaw!) && (maxConsRaw as number) > 0) {
        const maxCons = maxConsRaw as number;
        const backStreak = workStreakStatsBackward(p.empId, p.targetDateStr, p.getShift);
        const fwdStreak = workStreakStatsForward(p.empId, p.targetDateStr, p.getShift);
        const total = backStreak.workDays + fwdStreak.workDays;
        if (total > maxCons) {
            return {
                message: `Ciclo: ${total} días seguidos de trabajo (máximo permitido por el ciclo: ${maxCons}).`,
                proposedSchedule,
            };
        }
    }

    return null;
};

/**
 * Devuelve mensaje de advertencia o null si cumple.
 */
export const checkRestBetweenShifts = (p: RestCheckParams): string | null => {
    const detail = checkRestBetweenShiftsDetail(p);
    return detail?.message ?? null;
};
