/**
 * Rebalanceo post-generación por swaps (sin F→turno unilateral).
 * Solo cuando SLA/cobertura están cerrados pero el validador de forma marca desvío horario.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import { verifyScheduleCoverage, type CoverageVerificationReport } from './coverageVerification';
import {
    verifyScheduleForm,
    type ScheduleFormValidationReport,
} from './scheduleFormValidator';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const DEFAULT_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const WEEK_HARD_CAP = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;

const HIGH_THRESHOLD = 192;
const LOW_THRESHOLD = 168;

const REST_BASE: AgreementRestConfig = {
    minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
    longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
    minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
};

export interface FormRebalanceLogEntry {
    dateStr: string;
    fromEmpId: string;
    toEmpId: string;
    detail: string;
}

export interface FormRebalanceResult {
    assignments: V2Assignment[];
    formReport: ScheduleFormValidationReport;
    coverageReport: CoverageVerificationReport;
    stats: V2GenerateStats;
    swapsApplied: number;
    log: FormRebalanceLogEntry[];
    improved: boolean;
}

function isoWeekKey(dateStr: string): string {
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

function isWorkCell(a: V2Assignment): boolean {
    const c = String(a.code || '').toUpperCase();
    if ((a.hours ?? 0) <= 0) return false;
    return !FRANCO_CODES.has(c) && !ABSENCE_CODES.has(c) && c !== 'RET';
}

function isRestCell(a: V2Assignment): boolean {
    const c = String(a.code || '').toUpperCase();
    return c === 'RET' || a.isReten || FRANCO_CODES.has(c) || a.isFranco;
}

function billableHoursMap(assignments: V2Assignment[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of assignments) {
        if (!isWorkCell(a)) continue;
        const c = String(a.code || '').toUpperCase();
        const h = Number(a.hours) || SHIFT_HRS[c] || 8;
        m.set(a.empId, (m.get(a.empId) || 0) + h);
    }
    return m;
}

function makeGetShift(
    assignments: V2Assignment[],
    absences: V2EngineContext['absences'],
): (empId: string, dateStr: string) => { code: string; startTime: string; hours: number } | null {
    const idx = new Map<string, V2Assignment>();
    assignments.forEach(a => idx.set(`${a.empId}__${a.dateStr}`, a));
    return (empId, dateStr) => {
        const abs = absences[empId];
        if (abs?.has(dateStr)) {
            return { code: abs.get(dateStr)!, startTime: '00:00', hours: 0 };
        }
        const a = idx.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (!a.positionName) {
            if (FRANCO_CODES.has(c) || ABSENCE_CODES.has(c)) return { code: c, startTime: '00:00', hours: 0 };
            return { code: 'RET', startTime: '00:00', hours: 0 };
        }
        const nonWork = c === 'RET' || FRANCO_CODES.has(c);
        return {
            code: c,
            startTime: a.startTime || (nonWork ? '00:00' : DEFAULT_START[c] || '07:00'),
            hours: nonWork ? 0 : (Number(a.hours) || SHIFT_HRS[c] || 8),
        };
    };
}

function makeRestCfg(ctx: V2EngineContext): AgreementRestConfig {
    const { cL } = pickRepresentativeCycle(ctx.autoCycles || []);
    return { ...REST_BASE, maxConsecutiveWorkDays: cL };
}

function weekBillable(assignments: V2Assignment[], empId: string, weekKey: string): number {
    let sum = 0;
    for (const a of assignments) {
        if (a.empId !== empId || isoWeekKey(a.dateStr) !== weekKey) continue;
        if (!isWorkCell(a)) continue;
        const c = String(a.code || '').toUpperCase();
        sum += Number(a.hours) || SHIFT_HRS[c] || 8;
    }
    return sum;
}

function canTakeShift(
    empId: string,
    dateStr: string,
    code: string,
    positionName: string,
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): boolean {
    if (ctx.absences[empId]?.has(dateStr)) return false;
    const c = String(code || '').toUpperCase();
    const shiftHrs = SHIFT_HRS[c] || 8;
    const wk = isoWeekKey(dateStr);
    if (weekBillable(assignments, empId, wk) + shiftHrs > WEEK_HARD_CAP + 1e-6) return false;
    const start = DEFAULT_START[c] || '07:00';
    return checkRestBetweenShifts({
        empId,
        targetDateStr: dateStr,
        proposed: { code: c, startTime: start, hours: shiftHrs },
        getShift: makeGetShift(assignments, ctx.absences),
        cfg,
    }) === null;
}

function swapDayCells(a: V2Assignment, b: V2Assignment): void {
    const tmp = {
        positionName: a.positionName,
        code: a.code,
        name: a.name,
        hours: a.hours,
        startTime: a.startTime,
        endTime: a.endTime,
        isFranco: a.isFranco,
        isReten: a.isReten,
    };
    a.positionName = b.positionName;
    a.code = b.code;
    a.name = b.name;
    a.hours = b.hours;
    a.startTime = b.startTime;
    a.endTime = b.endTime;
    a.isFranco = b.isFranco;
    a.isReten = b.isReten;
    b.positionName = tmp.positionName;
    b.code = tmp.code;
    b.name = tmp.name;
    b.hours = tmp.hours;
    b.startTime = tmp.startTime;
    b.endTime = tmp.endTime;
    b.isFranco = tmp.isFranco;
    b.isReten = tmp.isReten;
}

function cloneAssignments(assignments: V2Assignment[]): V2Assignment[] {
    return assignments.map(a => ({ ...a }));
}

function recomputeStatsHours(stats: V2GenerateStats, assignments: V2Assignment[]): V2GenerateStats {
    const employeeMonthlyHours = { ...stats.employeeMonthlyHours };
    const hours = billableHoursMap(assignments);
    for (const empId of hours.keys()) {
        employeeMonthlyHours[empId] = hours.get(empId) || 0;
    }
    return { ...stats, employeeMonthlyHours };
}

function hasHourImbalance(form: ScheduleFormValidationReport): boolean {
    return form.metrics.over200Count > 0
        || form.metrics.over192Count > 0
        || form.metrics.under168Count > 0
        || form.metrics.hoursSpread > 24;
}

function trySwapWorkForRest(
    work: V2Assignment,
    rest: V2Assignment,
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): boolean {
    if (!isWorkCell(work) || !isRestCell(rest)) return false;
    if (work.empId === rest.empId || work.dateStr !== rest.dateStr) return false;

    const workCode = String(work.code || '').toUpperCase();
    const workPos = work.positionName || '';

    const trial = cloneAssignments(assignments);
    const tw = trial.find(a => a.empId === work.empId && a.dateStr === work.dateStr);
    const tr = trial.find(a => a.empId === rest.empId && a.dateStr === rest.dateStr);
    if (!tw || !tr) return false;

    swapDayCells(tw, tr);

    if (!canTakeShift(rest.empId, rest.dateStr, workCode, workPos, trial, ctx, cfg)) {
        return false;
    }

    const stillCovered = trial.some(a =>
        a.dateStr === work.dateStr
        && a.positionName === workPos
        && String(a.code || '').toUpperCase() === workCode
        && isWorkCell(a),
    );
    if (!stillCovered) return false;

    swapDayCells(work, rest);
    return true;
}

export function rebalanceScheduleForm(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
    coverageReport: CoverageVerificationReport,
    options?: { strictSixTwo?: boolean; rotateShifts?: boolean; maxSwaps?: number; cycleWorkDays?: Record<string, Set<string>> },
): FormRebalanceResult {
    const maxSwaps = options?.maxSwaps ?? 40;
    const cfg = makeRestCfg(ctx);
    let current = cloneAssignments(assignments);
    let currentStats = { ...stats, employeeMonthlyHours: { ...stats.employeeMonthlyHours } };
    let coverage = coverageReport;
    let form = verifyScheduleForm(ctx, current, currentStats, options);
    const log: FormRebalanceLogEntry[] = [];
    let swapsApplied = 0;

    if (coverage.coverage.uncoveredSlots > 0) {
        return { assignments: current, formReport: form, coverageReport: coverage, stats: currentStats, swapsApplied: 0, log, improved: false };
    }
    if (!hasHourImbalance(form)) {
        return { assignments: current, formReport: form, coverageReport: coverage, stats: currentStats, swapsApplied: 0, log, improved: false };
    }
    const isSixTwo = ctx.autoCycles.includes('6+2')
        || (() => { const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles); return cL === 6 && cF === 2; })();
    // Swaps trabajo↔F el mismo día desincronizan la fase 6+2 — no aplicar en esquema 6+2.
    if (options?.strictSixTwo === true || isSixTwo) {
        return { assignments: current, formReport: form, coverageReport: coverage, stats: currentStats, swapsApplied: 0, log, improved: false };
    }

    const initialForm = verifyScheduleForm(ctx, assignments, stats, options);
    const initialSpread = initialForm.metrics.hoursSpread;

    for (let round = 0; round < maxSwaps && hasHourImbalance(form); round++) {
        const hours = billableHoursMap(current);
        const sorted = [...ctx.employees].sort(
            (a, b) => (hours.get(b.id) || 0) - (hours.get(a.id) || 0),
        );
        let progressed = false;

        for (const donor of sorted) {
            const donorH = hours.get(donor.id) || 0;
            if (donorH < HIGH_THRESHOLD) break;

            for (const receiver of [...sorted].reverse()) {
                if (receiver.id === donor.id) continue;
                const receiverH = hours.get(receiver.id) || 0;
                if (receiverH > LOW_THRESHOLD && donorH - receiverH < 16) continue;

                for (const day of ctx.daysInMonth) {
                    const dateStr = ctx.getDateKey(day);
                    const workA = current.find(a => a.empId === donor.id && a.dateStr === dateStr);
                    const restB = current.find(a => a.empId === receiver.id && a.dateStr === dateStr);
                    if (!workA || !restB) continue;

                    const beforeSwap = cloneAssignments(current);
                    const beforeStats = { ...currentStats, employeeMonthlyHours: { ...currentStats.employeeMonthlyHours } };
                    if (!trySwapWorkForRest(workA, restB, current, ctx, cfg)) continue;

                    const workCode = String(workA.code || '').toUpperCase();
                    const trialStats = recomputeStatsHours(beforeStats, current);
                    const trialCoverage = verifyScheduleCoverage(ctx, current, trialStats);
                    const trialForm = verifyScheduleForm(ctx, current, trialStats, options);
                    if (trialCoverage.coverage.uncoveredSlots > 0) {
                        current = beforeSwap;
                        continue;
                    }

                    swapsApplied++;
                    log.push({
                        dateStr,
                        fromEmpId: donor.id,
                        toEmpId: receiver.id,
                        detail: `${donor.nombre || donor.id.slice(-4)} cede ${workCode} → ${receiver.nombre || receiver.id.slice(-4)} (F/RET)`,
                    });
                    currentStats = trialStats;
                    coverage = trialCoverage;
                    form = trialForm;
                    progressed = true;
                    break;
                }
                if (progressed) break;
            }
            if (progressed) break;
        }

        if (!progressed) break;
    }

    const improved = swapsApplied > 0 && (
        form.metrics.hoursSpread < initialSpread
        || form.metrics.over200Count < initialForm.metrics.over200Count
        || form.metrics.over192Count < initialForm.metrics.over192Count
        || form.metrics.under168Count < initialForm.metrics.under168Count
    );

    if (!improved && swapsApplied > 0) {
        return {
            assignments,
            formReport: initialForm,
            coverageReport: coverageReport,
            stats,
            swapsApplied: 0,
            log: [],
            improved: false,
        };
    }

    return {
        assignments: current,
        formReport: form,
        coverageReport: coverage,
        stats: currentStats,
        swapsApplied,
        log,
        improved,
    };
}
