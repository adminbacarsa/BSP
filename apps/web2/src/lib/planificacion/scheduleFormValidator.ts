/**
 * Validador de forma del cronograma — calidad 6+2, equidad horaria, semanas ISO.
 * Complementa coverageVerification (slots + descansos CCT puntuales).
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import { normBand } from './rotativeBandGuard';
import { SUVICO_POLICY } from './suvicoPolicy';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };

const TARGET_HOURS_6X2 = 180;
const HOURS_WARN_LOW = 168;
const HOURS_WARN_HIGH = 192;
const HARD_MAX = SUVICO_POLICY.REST.MAX_MONTHLY_HARD;
const WEEKLY_CAP = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;

export type ScheduleFormIssueKind =
    | 'work_block'
    | 'franco_block'
    | 'hours_low'
    | 'hours_high'
    | 'hours_over200'
    | 'weekly_over48'
    | 'rotation_stuck';

export interface ScheduleFormIssue {
    empId: string;
    empName?: string;
    kind: ScheduleFormIssueKind;
    severity: 'error' | 'warn';
    message: string;
}

export interface ScheduleFormValidationReport {
    ok: boolean;
    warnings: boolean;
    summary: string;
    metrics: {
        employeesChecked: number;
        formCompliantCount: number;
        formCompliantPct: number;
        avgBillableHours: number;
        minBillableHours: number;
        maxBillableHours: number;
        hoursSpread: number;
        over200Count: number;
        over192Count: number;
        under168Count: number;
        weeklyOver48Count: number;
        workBlockIssues: number;
        francoBlockIssues: number;
        rotationStuckCount: number;
    };
    issues: ScheduleFormIssue[];
}

type DayKind = 'work' | 'franco' | 'skip';

function isoWeekKeyFromDateStr(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const weekNum = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function classifyDay(a: V2Assignment | undefined): DayKind {
    if (!a) return 'skip';
    const code = String(a.code || '').toUpperCase();
    if (ABSENCE_CODES.has(code)) return 'skip';
    if (code === 'RET' || a.isReten) return 'skip';
    if (FRANCO_CODES.has(code) || a.isFranco) {
        if ((a.hours ?? 0) > 0) return 'work';
        return 'franco';
    }
    if ((a.hours ?? 0) > 0 || WORK_BANDS.has(code)) return 'work';
    return 'skip';
}

function pendulumBand(code: string): string {
    const b = normBand(code);
    if (b === 'D12') return 'M';
    if (b === 'N12') return 'N';
    return b;
}

function analyzeWorkFrancoRuns(
    dayKinds: DayKind[],
    expectedWork: number,
    expectedFranco: number,
    prefixWork = 0,
    prefixRest = 0,
): { workIssues: number; francoIssues: number } {
    let workIssues = 0;
    let francoIssues = 0;
    let i = 0;

    if (prefixWork > 0 && dayKinds[0] === 'work') {
        let len = prefixWork;
        while (i < dayKinds.length && dayKinds[i] === 'work') {
            len++;
            i++;
        }
        if (len !== expectedWork && len !== expectedWork * 2) {
            if (len === expectedWork - 1 || len === expectedWork + 1) workIssues++;
            else if (len % expectedWork !== 0) workIssues += Math.min(2, Math.ceil(Math.abs(len - expectedWork) / expectedWork));
        }
    } else if (prefixRest > 0 && dayKinds[0] === 'franco') {
        let len = prefixRest;
        while (i < dayKinds.length && dayKinds[i] === 'franco') {
            len++;
            i++;
        }
        if (len !== expectedFranco && len !== expectedFranco * 2) {
            if (len === 1 && expectedFranco === 2) francoIssues++;
            else if (len > expectedFranco) francoIssues += len - expectedFranco;
            else francoIssues++;
        }
    } else {
        // Sin datos del mes anterior: el primer bloque puede ser un bloque parcial
        // que arranca del mes previo → no lo chequeamos (no tenemos contexto suficiente).
        if (i < dayKinds.length) {
            const firstKind = dayKinds[i];
            if (firstKind === 'work' || firstKind === 'franco') {
                while (i < dayKinds.length && dayKinds[i] === firstKind) i++;
            }
        }
    }

    while (i < dayKinds.length) {
        if (dayKinds[i] === 'work') {
            let len = 0;
            while (i < dayKinds.length && dayKinds[i] === 'work') {
                len++;
                i++;
            }
            // Último bloque del mes: puede ser parcial porque el ciclo continúa en el mes siguiente.
            const isLastBlock = i >= dayKinds.length;
            if (!isLastBlock && len !== expectedWork) {
                if (len === expectedWork - 1 || len === expectedWork + 1) workIssues++;
                else workIssues += 2;
            }
        } else if (dayKinds[i] === 'franco') {
            let len = 0;
            while (i < dayKinds.length && dayKinds[i] === 'franco') {
                len++;
                i++;
            }
            const isLastBlock = i >= dayKinds.length;
            if (!isLastBlock && len !== expectedFranco) {
                if (len === 1 && expectedFranco === 2) francoIssues++;
                else if (len > expectedFranco) francoIssues += len - expectedFranco;
                else francoIssues++;
            }
        } else {
            i++;
        }
    }
    return { workIssues, francoIssues };
}

export function verifyScheduleForm(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats?: V2GenerateStats,
    options?: { strictSixTwo?: boolean; rotateShifts?: boolean },
): ScheduleFormValidationReport {
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles);
    const expectedWork = cL;
    const expectedFranco = cF;
    const isSixTwo = ctx.autoCycles.includes('6+2') || (expectedWork === 6 && expectedFranco === 2);
    const rotate = options?.rotateShifts ?? ctx.rotateShifts !== false;
    const strict = options?.strictSixTwo === true;

    const issues: ScheduleFormIssue[] = [];
    const billableByEmp: Record<string, number> = {};
    const weeklyByEmp: Record<string, Record<string, number>> = {};

    for (const emp of ctx.employees) {
        const empId = emp.id;
        const empName = emp.nombre;
        const sortedDays = ctx.daysInMonth
            .map(d => ctx.getDateKey(d))
            .sort((a, b) => a.localeCompare(b));

        const dayKinds: DayKind[] = [];
        const workBands = new Set<string>();
        let billable = 0;

        for (const dateStr of sortedDays) {
            const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr);
            dayKinds.push(classifyDay(a));
            if (a && (a.hours ?? 0) > 0) {
                const code = String(a.code || '').toUpperCase();
                if (!FRANCO_CODES.has(code) && code !== 'RET') {
                    const hrs = Number(a.hours) || SHIFT_HRS[code] || 8;
                    billable += hrs;
                    const wk = isoWeekKeyFromDateStr(dateStr);
                    if (!weeklyByEmp[empId]) weeklyByEmp[empId] = {};
                    weeklyByEmp[empId][wk] = (weeklyByEmp[empId][wk] || 0) + hrs;
                    if (WORK_BANDS.has(code) || code === 'D12' || code === 'N12') {
                        workBands.add(pendulumBand(code));
                    }
                }
            }
        }

        if (stats?.employeeMonthlyHours?.[empId] != null) {
            billable = stats.employeeMonthlyHours[empId];
        }
        billableByEmp[empId] = billable;

        if (isSixTwo || strict) {
            const prefixWork = ctx.prevMonthTrailingWorkDays?.[empId] ?? 0;
            const prefixRest = ctx.prevMonthTrailingRestDays?.[empId] ?? 0;
            const { workIssues, francoIssues } = analyzeWorkFrancoRuns(
                dayKinds, expectedWork, expectedFranco, prefixWork, prefixRest,
            );
            if (workIssues > 0) {
                issues.push({
                    empId,
                    empName,
                    kind: 'work_block',
                    severity: workIssues >= 2 ? 'error' : 'warn',
                    message: `Bloques de trabajo ≠ ${expectedWork}d (patrón ${expectedWork}+${expectedFranco})`,
                });
            }
            if (francoIssues > 0) {
                issues.push({
                    empId,
                    empName,
                    kind: 'franco_block',
                    severity: francoIssues >= 2 ? 'error' : 'warn',
                    message: `Francos ≠ ${expectedFranco} consecutivos (${expectedWork}+${expectedFranco})`,
                });
            }
        }

        if (billable > HARD_MAX) {
            issues.push({
                empId,
                empName,
                kind: 'hours_over200',
                severity: 'error',
                message: `${Math.round(billable)}h supera tope CCT ${HARD_MAX}h`,
            });
        } else if (isSixTwo && billable > HOURS_WARN_HIGH) {
            issues.push({
                empId,
                empName,
                kind: 'hours_high',
                severity: billable >= HARD_MAX - 0.5 ? 'error' : 'warn',
                message: `${Math.round(billable)}h > ${HOURS_WARN_HIGH}h (objetivo ~${TARGET_HOURS_6X2}h en 6+2)`,
            });
        } else if (isSixTwo && billable > 0 && billable < HOURS_WARN_LOW) {
            issues.push({
                empId,
                empName,
                kind: 'hours_low',
                severity: 'warn',
                message: `${Math.round(billable)}h < ${HOURS_WARN_LOW}h (objetivo ~${TARGET_HOURS_6X2}h)`,
            });
        }

        if (rotate && isSixTwo) {
            const mtnBands = [...workBands].filter(b => b === 'M' || b === 'T' || b === 'N');
            const workDays = dayKinds.filter(k => k === 'work').length;
            if (workDays >= 12 && mtnBands.length === 1) {
                issues.push({
                    empId,
                    empName,
                    kind: 'rotation_stuck',
                    severity: 'warn',
                    message: `Banda fija todo el mes (${mtnBands[0]}) — sin rotación M/T/N visible`,
                });
            }
        }
    }

    if (stats?.suvicoWeekBillableOver48) {
        for (const w of stats.suvicoWeekBillableOver48) {
            if (w.hours <= WEEKLY_CAP) continue;
            const emp = ctx.employees.find(e => e.id === w.empId);
            issues.push({
                empId: w.empId,
                empName: emp?.nombre,
                kind: 'weekly_over48',
                severity: 'warn',
                message: `Semana ${w.weekKey}: ${w.hours}h > ${WEEKLY_CAP}h ISO`,
            });
        }
    } else {
        for (const emp of ctx.employees) {
            const weeks = weeklyByEmp[emp.id] || {};
            for (const [wk, hrs] of Object.entries(weeks)) {
                if (hrs > WEEKLY_CAP) {
                    issues.push({
                        empId: emp.id,
                        empName: emp.nombre,
                        kind: 'weekly_over48',
                        severity: 'warn',
                        message: `Semana ${wk}: ${Math.round(hrs * 10) / 10}h > ${WEEKLY_CAP}h ISO`,
                    });
                }
            }
        }
    }

    const hoursList = Object.values(billableByEmp).filter(h => h > 0);
    const minH = hoursList.length ? Math.min(...hoursList) : 0;
    const maxH = hoursList.length ? Math.max(...hoursList) : 0;
    const avgH = hoursList.length ? hoursList.reduce((s, h) => s + h, 0) / hoursList.length : 0;

    const errorEmpIds = new Set(issues.filter(i => i.severity === 'error').map(i => i.empId));
    const anyIssueEmpIds = new Set(issues.map(i => i.empId));
    const formCompliantCount = ctx.employees.filter(e => !anyIssueEmpIds.has(e.id)).length;

    const over200Count = issues.filter(i => i.kind === 'hours_over200').length;
    const over192Count = issues.filter(i => i.kind === 'hours_high').length;
    const under168Count = issues.filter(i => i.kind === 'hours_low').length;
    const weeklyOver48Count = issues.filter(i => i.kind === 'weekly_over48').length;
    const workBlockIssues = issues.filter(i => i.kind === 'work_block').length;
    const francoBlockIssues = issues.filter(i => i.kind === 'franco_block').length;
    const rotationStuckCount = issues.filter(i => i.kind === 'rotation_stuck').length;

    const hasErrors = errorEmpIds.size > 0;
    const hasWarns = issues.some(i => i.severity === 'warn');

    let summary: string;
    if (issues.length === 0) {
        summary = `Forma ${expectedWork}+${expectedFranco} OK en ${ctx.employees.length} guardias · promedio ${Math.round(avgH)}h`;
    } else if (hasErrors) {
        summary = `${errorEmpIds.size} guardia(s) con errores de forma · ${formCompliantCount}/${ctx.employees.length} sin observaciones`;
    } else {
        summary = `${issues.length} observación(es) de forma · ${formCompliantCount}/${ctx.employees.length} filas limpias`;
    }

    return {
        ok: !hasErrors && (!strict || issues.length === 0),
        warnings: hasWarns || (hasErrors && issues.length > errorEmpIds.size),
        summary,
        metrics: {
            employeesChecked: ctx.employees.length,
            formCompliantCount,
            formCompliantPct: ctx.employees.length > 0
                ? Math.round((formCompliantCount / ctx.employees.length) * 100)
                : 100,
            avgBillableHours: Math.round(avgH * 10) / 10,
            minBillableHours: Math.round(minH),
            maxBillableHours: Math.round(maxH),
            hoursSpread: Math.round(maxH - minH),
            over200Count,
            over192Count,
            under168Count,
            weeklyOver48Count,
            workBlockIssues,
            francoBlockIssues,
            rotationStuckCount,
        },
        issues,
    };
}
