/**
 * Evaluador de capacidad del guardia para decisiones de cobertura (cerebro + fixer).
 *
 * Capas:
 *  1. Turno único (≤12h) + descanso interjornada (mín. 10h operativo SUVICO).
 *  2. Racha: ≥48h facturables o ≥6 días (trabajo + RET potencial) → 35h hasta el próximo turno.
 *  3. Semana ISO: 48h normal · 56h extensión/contingencia · 60h techo operativo duro.
 *
 * RET = día comprometido sin horas; al evaluar cobertura se usa escenario pesimista si aplica.
 */

import type { V2AbsenceMap, V2Assignment } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import {
    checkRestBetweenShiftsDetail,
    type AgreementRestConfig,
    workStreakStatsBackward,
    workStreakStatsForward,
} from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const SHIFT_HRS: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9, MA: 9, ME: 12, PU: 12,
};
const DEFAULT_START: Record<string, string> = {
    M: '07:00', T: '15:00', N: '23:00', D12: '07:00', N12: '19:00', MA: '07:00', ME: '07:00',
};
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);

export type GuardCoverageTier =
    | 'free'
    | 'ret_available'
    | 'ret_risky'
    | 'blocked_rest'
    | 'blocked_weekly'
    | 'blocked_streak'
    | 'blocked_shift_hours'
    | 'franco_only';

export interface GuardCapacityConfig {
    minRestBetweenShiftsHours: number;
    longRestAfterWorkedHours: number;
    minLongRestHours: number;
    maxConsecutiveWorkDays: number;
    maxShiftHours: number;
    weeklyCapNormal: number;
    weeklyCapExtension: number;
    weeklyCapHard: number;
    /** Usar tope 56h en lugar de 48h (Modo 12 / contingencia). */
    allowWeeklyExtension: boolean;
}

export interface GuardCapacityVerdict {
    ok: boolean;
    tier: GuardCoverageTier;
    reasons: string[];
    weeklyHoursAfter: number;
    streakHoursBackward: number;
    streakDaysBackward: number;
    minRestRequired: number;
}

export type GuardCapacityRiskKind =
    | 'near_48h_streak'
    | 'near_weekly_cap'
    | 'insufficient_rest'
    | 'ret_activation_risk'
    | 'max_shift_exceeded'
    | 'max_consecutive_days';

export interface GuardCapacityRisk {
    empId: string;
    dateStr: string;
    code: string;
    kind: GuardCapacityRiskKind;
    message: string;
}

export function buildGuardCapacityConfig(
    autoCycles: string[] = [],
    options?: {
        modo12?: boolean;
        contingency?: boolean;
        authorizedWeekly60?: boolean;
    },
): GuardCapacityConfig {
    const { cL } = pickRepresentativeCycle(autoCycles);
    const allowWeeklyExtension = !!(options?.modo12 || options?.contingency);
    const weeklyHard = options?.authorizedWeekly60
        ? SUVICO_POLICY.ALERTS.MAX_WEEKLY_OPERATIONAL_HARD
        : SUVICO_POLICY.ALERTS.MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION;

    return {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
        maxConsecutiveWorkDays: cL,
        maxShiftHours: SUVICO_POLICY.REST.MAX_SINGLE_SHIFT_HOURS,
        weeklyCapNormal: SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT,
        weeklyCapExtension: SUVICO_POLICY.ALERTS.MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION,
        weeklyCapHard: weeklyHard,
        allowWeeklyExtension,
    };
}

export function guardCapacityConfigToRestCfg(cfg: GuardCapacityConfig): AgreementRestConfig {
    return {
        minRestBetweenShiftsHours: cfg.minRestBetweenShiftsHours,
        longRestAfterWorkedHours: cfg.longRestAfterWorkedHours,
        minLongRestHours: cfg.minLongRestHours,
        longRestAfterConsecutiveWorkDays: cfg.maxConsecutiveWorkDays,
        maxConsecutiveWorkDays: cfg.maxConsecutiveWorkDays,
    };
}

export function guardCapacityRulesSummary(cfg: GuardCapacityConfig): string {
    return [
        `Máx. ${cfg.maxShiftHours}h por turno`,
        `Mín. ${cfg.minRestBetweenShiftsHours}h entre turnos`,
        `Tras ${cfg.longRestAfterWorkedHours}h o ${cfg.maxConsecutiveWorkDays} días → ${cfg.minLongRestHours}h de descanso`,
        `Semana: ${cfg.weeklyCapNormal}h normal · ${cfg.weeklyCapExtension}h extensión · ${cfg.weeklyCapHard}h tope`,
        'RET disponible si la activación no viola las reglas anteriores',
    ].join(' · ');
}

export function isoWeekKeyFromDateStr(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const ft = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const wn = 1 + Math.round(
        ((t.getTime() - ft.getTime()) / 86400000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7,
    );
    return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

export function shiftHoursForCode(code: string, hours?: number): number {
    const c = String(code || '').toUpperCase();
    if (c === 'RET' || FRANCO_CODES.has(c) || ABSENCE_CODES.has(c)) return 0;
    const n = Number(hours);
    if (n > 0) return n;
    return SHIFT_HRS[c] ?? 8;
}

export function weeklyBillableHoursForEmp(
    assignments: V2Assignment[],
    empId: string,
    weekKey: string,
): number {
    let total = 0;
    for (const a of assignments) {
        if (a.empId !== empId) continue;
        if (isoWeekKeyFromDateStr(a.dateStr) !== weekKey) continue;
        total += shiftHoursForCode(a.code, a.hours);
    }
    return total;
}

export function makeAssignmentGetShift(
    assignments: V2Assignment[],
    absences: V2AbsenceMap,
): (empId: string, dateStr: string) => any | null {
    const idx = new Map<string, V2Assignment>();
    assignments.forEach((a) => idx.set(`${a.empId}__${a.dateStr}`, a));
    return (empId, dateStr) => {
        const absMap = absences[empId];
        if (absMap?.has(dateStr)) {
            return { code: absMap.get(dateStr), hours: 0, startTime: '00:00' };
        }
        const a = idx.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (!a.positionName) {
            if (FRANCO_CODES.has(c) || ABSENCE_CODES.has(c)) {
                return { code: c, startTime: '00:00', hours: 0 };
            }
            if (c === 'RET') return { code: 'RET', startTime: '00:00', hours: 0 };
            return null;
        }
        const isNonWork = c === 'RET' || FRANCO_CODES.has(c);
        return {
            code: c,
            startTime: a.startTime || (isNonWork ? '00:00' : DEFAULT_START[c] || '07:00'),
            hours: isNonWork ? 0 : (Number(a.hours) || SHIFT_HRS[c] || 8),
            endTime: (a as { endTime?: string }).endTime,
        };
    };
}

function weeklyCapForConfig(cfg: GuardCapacityConfig): number {
    return cfg.allowWeeklyExtension ? cfg.weeklyCapExtension : cfg.weeklyCapNormal;
}

function buildVerdict(
    ok: boolean,
    tier: GuardCoverageTier,
    reasons: string[],
    partial: Partial<GuardCapacityVerdict> = {},
): GuardCapacityVerdict {
    return {
        ok,
        tier,
        reasons,
        weeklyHoursAfter: partial.weeklyHoursAfter ?? 0,
        streakHoursBackward: partial.streakHoursBackward ?? 0,
        streakDaysBackward: partial.streakDaysBackward ?? 0,
        minRestRequired: partial.minRestRequired ?? 0,
    };
}

/**
 * ¿Puede el guardia tomar un turno facturable en `targetDateStr`?
 * Usar para cobertura interna, RET externo y extensión 12h.
 */
export function evaluateGuardCanTakeShift(params: {
    empId: string;
    targetDateStr: string;
    proposedCode: string;
    proposedHours?: number;
    proposedStartTime?: string;
    assignments: V2Assignment[];
    absences: V2AbsenceMap;
    cfg: GuardCapacityConfig;
    /** Excluir la celda existente del mismo día (reemplazo). */
    replaceExisting?: boolean;
}): GuardCapacityVerdict {
    const {
        empId,
        targetDateStr,
        proposedCode,
        assignments,
        absences,
        cfg,
        replaceExisting = true,
    } = params;
    const code = String(proposedCode || '').toUpperCase();
    const reasons: string[] = [];

    if (FRANCO_CODES.has(code)) {
        return buildVerdict(false, 'franco_only', ['Franco no es turno de cobertura automática']);
    }
    if (ABSENCE_CODES.has(code)) {
        return buildVerdict(false, 'blocked_rest', ['Licencia/ausencia no es cobertura']);
    }

    const shiftHrs = shiftHoursForCode(code, params.proposedHours);
    if (shiftHrs > cfg.maxShiftHours + 1e-6) {
        return buildVerdict(false, 'blocked_shift_hours', [
            `Turno ${shiftHrs}h supera máximo ${cfg.maxShiftHours}h/día`,
        ]);
    }
    if (shiftHrs <= 0) {
        return buildVerdict(false, 'blocked_rest', ['Código sin horas facturables']);
    }

    const filtered = replaceExisting
        ? assignments.filter((a) => !(a.empId === empId && a.dateStr === targetDateStr))
        : assignments;

    const weekKey = isoWeekKeyFromDateStr(targetDateStr);
    const weekUsed = weeklyBillableHoursForEmp(filtered, empId, weekKey);
    const weekAfter = weekUsed + shiftHrs;
    const weekCap = weeklyCapForConfig(cfg);

    if (weekAfter > cfg.weeklyCapHard + 1e-6) {
        return buildVerdict(false, 'blocked_weekly', [
            `Semana ${weekKey}: ${weekAfter}h > tope ${cfg.weeklyCapHard}h`,
        ], { weeklyHoursAfter: weekAfter });
    }
    if (weekAfter > weekCap + 1e-6) {
        return buildVerdict(false, 'blocked_weekly', [
            `Semana ${weekKey}: ${weekAfter}h > ${weekCap}h (${cfg.allowWeeklyExtension ? 'extensión' : 'normal'})`,
        ], { weeklyHoursAfter: weekAfter });
    }

    const getShift = makeAssignmentGetShift(filtered, absences);
    const streakBack = workStreakStatsBackward(empId, targetDateStr, getShift);
    const streakFwd = workStreakStatsForward(empId, targetDateStr, getShift);
    const totalDays = streakBack.workDays + 1 + streakFwd.workDays;

    if (totalDays > cfg.maxConsecutiveWorkDays) {
        return buildVerdict(false, 'blocked_streak', [
            `Racha proyectada ${totalDays} días > máx. ${cfg.maxConsecutiveWorkDays}`,
        ], {
            streakHoursBackward: streakBack.hours,
            streakDaysBackward: streakBack.workDays,
        });
    }

    const startResolved = params.proposedStartTime || DEFAULT_START[code] || '07:00';
    const restCfg = guardCapacityConfigToRestCfg(cfg);
    const restViolation = checkRestBetweenShiftsDetail({
        empId,
        targetDateStr,
        proposed: { code, startTime: startResolved, hours: shiftHrs },
        getShift,
        cfg: restCfg,
    });

    if (restViolation) {
        const needLong =
            streakBack.hours >= cfg.longRestAfterWorkedHours
            || streakBack.workDays >= cfg.maxConsecutiveWorkDays;
        return buildVerdict(false, 'blocked_rest', [restViolation.message], {
            weeklyHoursAfter: weekAfter,
            streakHoursBackward: streakBack.hours,
            streakDaysBackward: streakBack.workDays,
            minRestRequired: restViolation.requiredRestHours ?? (needLong ? cfg.minLongRestHours : cfg.minRestBetweenShiftsHours),
        });
    }

    const projectedHours = streakBack.hours + shiftHrs;
    let tier: GuardCoverageTier = 'free';
    if (projectedHours >= cfg.longRestAfterWorkedHours - 8) {
        tier = 'ret_risky';
        reasons.push(`Racha cercana a ${cfg.longRestAfterWorkedHours}h (${projectedHours}h tras asignar)`);
    }
    if (weekAfter >= weekCap - 8) {
        tier = 'ret_risky';
        reasons.push(`Semana cercana al tope (${weekAfter}h)`);
    }

    return buildVerdict(true, tier, reasons, {
        weeklyHoursAfter: weekAfter,
        streakHoursBackward: projectedHours,
        streakDaysBackward: streakBack.workDays + 1,
        minRestRequired: cfg.minRestBetweenShiftsHours,
    });
}

/**
 * Evalúa si un guardia en RET (o vacío) puede activarse para cubrir un hueco.
 */
export function evaluateRetAvailableForCoverage(params: {
    empId: string;
    targetDateStr: string;
    proposedCode: string;
    proposedHours?: number;
    assignments: V2Assignment[];
    absences: V2AbsenceMap;
    cfg: GuardCapacityConfig;
}): GuardCapacityVerdict {
    const existing = params.assignments.find(
        (a) => a.empId === params.empId && a.dateStr === params.targetDateStr,
    );
    const existingCode = String(existing?.code || '').toUpperCase();

    if (existingCode && FRANCO_CODES.has(existingCode)) {
        return buildVerdict(false, 'franco_only', [
            'Guardia en franco — solo FT manual (costo extra)',
        ]);
    }
    if (existingCode && ABSENCE_CODES.has(existingCode)) {
        return buildVerdict(false, 'blocked_rest', ['Guardia con licencia/ausencia']);
    }

    const verdict = evaluateGuardCanTakeShift({
        ...params,
        replaceExisting: true,
    });

    if (!verdict.ok) return verdict;

    if (existingCode === 'RET' || !existingCode) {
        const tier: GuardCoverageTier = verdict.tier === 'ret_risky' ? 'ret_risky' : 'ret_available';
        return {
            ...verdict,
            tier,
            reasons: [
                ...verdict.reasons,
                existingCode === 'RET' ? 'Activación RET → turno facturable' : 'Celda libre → asignación directa',
            ],
        };
    }

    if (shiftHoursForCode(existingCode, existing?.hours) > 0) {
        return buildVerdict(false, 'blocked_rest', ['Ya tiene turno facturable ese día']);
    }

    return verdict;
}

/** Ordena candidatos: libres primero, RET disponible, RET riesgoso al final. */
export function rankGuardCoverageCandidates(
    empIds: string[],
    targetDateStr: string,
    proposedCode: string,
    assignments: V2Assignment[],
    absences: V2AbsenceMap,
    cfg: GuardCapacityConfig,
): string[] {
    const scored = empIds.map((empId) => {
        const v = evaluateRetAvailableForCoverage({
            empId,
            targetDateStr,
            proposedCode,
            assignments,
            absences,
            cfg,
        });
        const tierScore: Record<GuardCoverageTier, number> = {
            free: 0,
            ret_available: 1,
            ret_risky: 2,
            blocked_rest: 9,
            blocked_weekly: 8,
            blocked_streak: 7,
            blocked_shift_hours: 6,
            franco_only: 10,
        };
        return { empId, ok: v.ok, score: v.ok ? tierScore[v.tier] : 99, weekly: v.weeklyHoursAfter };
    });
    return scored
        .filter((s) => s.ok)
        .sort((a, b) => a.score - b.score || a.weekly - b.weekly)
        .map((s) => s.empId);
}

/** Escanea grilla generada y devuelve alertas de capacidad (post-generación / cerebro). */
export function scanAssignmentsCapacityRisks(
    assignments: V2Assignment[],
    absences: V2AbsenceMap,
    employeeIds: string[],
    dateStrs: string[],
    cfg: GuardCapacityConfig,
): GuardCapacityRisk[] {
    const risks: GuardCapacityRisk[] = [];
    const getShift = makeAssignmentGetShift(assignments, absences);

    for (const empId of employeeIds) {
        for (const dateStr of dateStrs) {
            const a = assignments.find((x) => x.empId === empId && x.dateStr === dateStr);
            const code = String(a?.code || '').toUpperCase();
            const hrs = shiftHoursForCode(code, a?.hours);

            if (hrs > cfg.maxShiftHours) {
                risks.push({
                    empId, dateStr, code,
                    kind: 'max_shift_exceeded',
                    message: `${code} ${hrs}h > ${cfg.maxShiftHours}h`,
                });
            }

            if (hrs > 0) {
                const streak = workStreakStatsBackward(empId, dateStr, getShift);
                if (streak.hours >= cfg.longRestAfterWorkedHours - 0.5) {
                    risks.push({
                        empId, dateStr, code,
                        kind: 'near_48h_streak',
                        message: `Racha ${streak.hours}h / ${streak.workDays}d antes de ${dateStr}`,
                    });
                }
                if (streak.workDays >= cfg.maxConsecutiveWorkDays) {
                    risks.push({
                        empId, dateStr, code,
                        kind: 'max_consecutive_days',
                        message: `${streak.workDays} días consecutivos (máx. ${cfg.maxConsecutiveWorkDays})`,
                    });
                }

                const wk = isoWeekKeyFromDateStr(dateStr);
                const weekH = weeklyBillableHoursForEmp(assignments, empId, wk);
                const cap = weeklyCapForConfig(cfg);
                if (weekH > cap) {
                    risks.push({
                        empId, dateStr, code,
                        kind: 'near_weekly_cap',
                        message: `Semana ${wk}: ${weekH}h > ${cap}h`,
                    });
                }
            }

            if (code === 'RET') {
                const pessimistic = evaluateGuardCanTakeShift({
                    empId,
                    targetDateStr: dateStr,
                    proposedCode: 'M',
                    assignments,
                    absences,
                    cfg,
                    replaceExisting: true,
                });
                if (!pessimistic.ok) {
                    risks.push({
                        empId, dateStr, code: 'RET',
                        kind: 'ret_activation_risk',
                        message: `RET no activable a M: ${pessimistic.reasons[0] || 'bloqueado'}`,
                    });
                } else if (pessimistic.tier === 'ret_risky') {
                    risks.push({
                        empId, dateStr, code: 'RET',
                        kind: 'ret_activation_risk',
                        message: pessimistic.reasons[0] || 'Activación RET con racha/carga alta',
                    });
                }
            }
        }
    }

    return risks;
}

/** Construye secuencia sintética de celdas para tests (un empleado, fechas consecutivas). */
export function buildSyntheticSequenceAssignments(
    empId: string,
    startDateStr: string,
    codes: string[],
): V2Assignment[] {
    const out: V2Assignment[] = [];
    const [y, m, d] = startDateStr.split('-').map(Number);
    let cursor = new Date(y, m - 1, d);
    for (const raw of codes) {
        const code = String(raw).toUpperCase();
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        const hrs = shiftHoursForCode(code);
        const isRet = code === 'RET';
        const isFranco = FRANCO_CODES.has(code);
        out.push({
            empId,
            dateStr,
            positionName: (isRet || isFranco) ? '' : 'Puesto 1',
            code,
            name: code,
            hours: hrs,
            startTime: isRet || isFranco ? '00:00' : (DEFAULT_START[code] || '07:00'),
            ...(isFranco ? { isFranco: true } : {}),
            ...(isRet ? { isReten: true } : {}),
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}
