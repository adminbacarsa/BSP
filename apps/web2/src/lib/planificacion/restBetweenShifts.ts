/**
 * Descansos entre turnos (SUVICO y convenios con campos opcionales).
 * - Mínimo entre turnos laborales: 12 h (configurable).
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
 * RET (retén) NO está aquí: no es un franco — el empleado sigue disponible/comprometido.
 * En workStreakStatsBackward/Forward los turnos RET se saltean sin contar ni cortar.
 */
const STREAK_BREAK_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

const HOURS_BY_CODE: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
    /** Encargada/Admin típico L–V (9 h); el SLA puede traer otras horas en la celda. */
    EN: 9,
    P: 8,
};

/** Defaults de reloj si la celda no trae start/end (protocolo 8+8+8 estándar). */
const END_DEF: Record<string, number> = { M: 14, T: 22, N: 6, D12: 19, N12: 7 };
const START_DEF: Record<string, number> = { M: 6, T: 14, N: 22, D12: 7, N12: 19 };

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
 * Horas y cantidad de DÍAS consecutivos de TRABAJO REAL hacia atrás desde
 * `fromDateStr` (inclusive).
 *  - F / FF / FP / FT / licencias → rompen la racha.
 *  - RET (retén): NO rompe la racha — se saltea y se sigue leyendo.
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
        const code = String(sh.code || '').toUpperCase();
        if (STREAK_BREAK_CODES.has(code)) break;
        const h = shiftHours(sh);
        if (h <= 0) {
            // 0h pero no franco real (ej. RET): transparente, seguir buscando
            d = addDaysStr(d, -1);
            continue;
        }
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
        const code = String(sh.code || '').toUpperCase();
        if (STREAK_BREAK_CODES.has(code)) break;
        const h = shiftHours(sh);
        if (h <= 0) {
            // 0h pero no franco real (ej. RET): transparente, seguir buscando
            d = addDaysStr(d, 1);
            continue;
        }
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
        // CCT 422/05 SUVICO: 12h entre turnos; 35h cuando se acumularon 48h de trabajo
        // (con descansos de 12h entre medio). El motor compara HORAS, no días.
        return {
            minRestBetweenShiftsHours: DEFAULT_MIN_REST,
            longRestAfterWorkedHours: DEFAULT_STREAK_THRESHOLD,
            minLongRestHours: DEFAULT_LONG_REST,
        };
    }
    return null;
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
 * Devuelve mensaje de advertencia o null si cumple.
 */
export const checkRestBetweenShifts = (p: RestCheckParams): string | null => {
    const minRest = Number.isFinite(p.cfg.minRestBetweenShiftsHours!) ? p.cfg.minRestBetweenShiftsHours! : DEFAULT_MIN_REST;
    const thr = Number.isFinite(p.cfg.longRestAfterWorkedHours!) ? p.cfg.longRestAfterWorkedHours! : DEFAULT_STREAK_THRESHOLD;
    const longRest = Number.isFinite(p.cfg.minLongRestHours!) ? p.cfg.minLongRestHours! : DEFAULT_LONG_REST;
    const thrDaysRaw = p.cfg.longRestAfterConsecutiveWorkDays;
    const thrDays = Number.isFinite(thrDaysRaw!) && (thrDaysRaw as number) > 0 ? (thrDaysRaw as number) : undefined;

    const proposedShift = {
        code: p.proposed.code,
        startTime: p.proposed.startTime,
        endTime: p.proposed.endTime,
        hours: p.proposed.hours,
    };
    const seNew = getShiftStartEndAbs(p.targetDateStr, proposedShift);
    if (!seNew) return null;

    const prev = findPrevWorkBoundary(p.empId, p.targetDateStr, p.getShift);
    if (prev) {
        const streakBeforePrev = workStreakStatsBackward(p.empId, prev.dateStr, p.getShift);
        const needLong =
            streakBeforePrev.hours >= thr ||
            (thrDays !== undefined && streakBeforePrev.workDays >= thrDays);
        const need = needLong ? longRest : minRest;
        const gap = hoursBetween(prev.end, seNew.start);
        if (gap + 1e-6 < need) {
            return `Convenio: descanso insuficiente respecto al turno anterior (${gap.toFixed(1)}h < ${need}h; racha previa ~${streakBeforePrev.hours}h / ${streakBeforePrev.workDays}d).`;
        }
    }

    const next = findNextWorkBoundary(p.empId, p.targetDateStr, p.getShift);
    if (next) {
        // Racha de trabajo que termina al cerrar el turno propuesto (incluye propuesto + días laborales consecutivos hacia atrás).
        const streakEndingAtProposed = workStreakStatsBackward(p.empId, p.targetDateStr, p.getShift);
        const needLongAfter =
            streakEndingAtProposed.hours >= thr ||
            (thrDays !== undefined && streakEndingAtProposed.workDays >= thrDays);
        const needAfter = needLongAfter ? longRest : minRest;
        const gap2 = hoursBetween(seNew.end, next.start);
        if (gap2 + 1e-6 < needAfter) {
            return `Convenio: descanso insuficiente respecto al turno siguiente (${gap2.toFixed(1)}h < ${needAfter}h; racha que termina este día ~${streakEndingAtProposed.hours}h / ${streakEndingAtProposed.workDays}d).`;
        }
    }

    // ── BLOQUEO DURO DEL CICLO ────────────────────────────────────────────
    // La racha TOTAL = días trabajados antes del propuesto (inclusive) + días
    // laborales consecutivos DESPUÉS del propuesto. Hay que contar ambos lados
    // porque el balance-swap o el emergency pass pueden insertar un turno entre
    // dos bloques de trabajo, creando 7 días corridos sin que la check backward
    // (unilateral) lo detecte.
    const maxConsRaw = p.cfg.maxConsecutiveWorkDays;
    if (Number.isFinite(maxConsRaw!) && (maxConsRaw as number) > 0) {
        const maxCons = maxConsRaw as number;
        const backStreak = workStreakStatsBackward(p.empId, p.targetDateStr, p.getShift);
        const fwdStreak  = workStreakStatsForward(p.empId, p.targetDateStr, p.getShift);
        const total = backStreak.workDays + fwdStreak.workDays;
        if (total > maxCons) {
            return `Ciclo: ${total} días seguidos de trabajo (máximo permitido por el ciclo: ${maxCons}).`;
        }
    }

    return null;
};
