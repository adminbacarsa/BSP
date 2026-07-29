/**
 * Planificador de cobertura ante V/L/E — ver `ABSENCE_COVERAGE_PRIORITY_STEPS` en planningCoveragePolicy.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { HARD_MAX_HOURS } from './autoScheduleEngineV2';
import type { AbsenceSplitAction } from './absenceSplitCoverage';
import { absenceRequiresCoverage } from './absenceFrancoUtils';
import { isExternalRetEmpId } from './externalRetCoverage';
import type { Modo8ExternalRetPlan } from './externalRetCoverage';
import { ABSENCE_COVERAGE_PRIORITY_SUMMARY, MODO12_ABSENCE_CODES } from './planningCoveragePolicy';
import { SUVICO_POLICY } from './suvicoPolicy';
import type { CoverageGap } from './coverageEngine';
import type { UncoveredSlot } from './coverageVerification';

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);

const WEEKLY_CAP_EXTENSION = SUVICO_POLICY.ALERTS.MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION;
const WEEKLY_CAP_SOFT = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;

export type AbsenceCoverageStrategyId =
    | 'modo8_plantilla'
    | 'modo8_ret_interno'
    | 'modo8_ret_externo'
    | 'internal_extension'
    | 'internal_extension_warn'
    | 'blocked_weekly_56'
    | 'blocked_monthly_200'
    | 'external_ret'
    | 'ft_last_resort'
    | 'franco_no_coverage'
    | 'uncovered';

const RET_THEN_FT_HINT =
    'RET = capacidad disponible (no hueco). Activar en banda 8h antes de contingencia D12/N12; último recurso FT manual.';

export interface AbsenceCoveragePlanDay {
    dateStr: string;
    absentEmpIds: string[];
    strategy: AbsenceCoverageStrategyId;
    coverers: Array<{ empId: string; code: string; hours: number }>;
    externalRetBands: string[];
    ftCandidates?: Array<{ empId: string; code: string }>;
    weeklyHoursByEmp: Record<string, number>;
    monthlyHoursByEmp: Record<string, number>;
    messages: string[];
}

export interface AbsenceCoveragePeriod {
    absentEmpId: string;
    absenceCode: string;
    startDate: string;
    endDate: string;
    dayCount: number;
    workDaysNeedingCover: number;
    strategySummary: AbsenceCoverageStrategyId;
    messages: string[];
}

export interface AbsenceCoveragePlan {
    days: AbsenceCoveragePlanDay[];
    periods: AbsenceCoveragePeriod[];
    summary: string;
    allInternal: boolean;
    needsExternalRet: boolean;
    needsFtLastResort: boolean;
}

function isoWeekKey(dateStr: string): string {
    const d = new Date(dateStr);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const ft = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const wn = 1 + Math.round(
        ((t.getTime() - ft.getTime()) / 86400000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7,
    );
    return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function billableHours(assignments: V2Assignment[], empId?: string): number {
    let total = 0;
    for (const a of assignments) {
        if (empId && a.empId !== empId) continue;
        const c = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(c) || !a.positionName) continue;
        total += Number(a.hours) || SHIFT_HRS[c] || 8;
    }
    return total;
}

function weeklyHoursByEmp(
    assignments: V2Assignment[],
    empId: string,
    weekKey?: string,
): number {
    let total = 0;
    for (const a of assignments) {
        if (a.empId !== empId) continue;
        if (weekKey && isoWeekKey(a.dateStr) !== weekKey) continue;
        const c = String(a.code || '').toUpperCase();
        if (!WORK_CODES.has(c) || !a.positionName) continue;
        total += Number(a.hours) || SHIFT_HRS[c] || 8;
    }
    return total;
}

function monthlyHoursByEmp(
    assignments: V2Assignment[],
    empId: string,
    stats?: V2GenerateStats,
): number {
    const fromStats = stats?.employeeCycleHours?.current?.[empId];
    if (fromStats != null && fromStats > 0) {
        const next = stats?.employeeCycleHours?.next?.[empId] || 0;
        return fromStats + next;
    }
    return billableHours(assignments, empId);
}

function coverersOnDay(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    excludeEmpIds: Set<string>,
): Array<{ empId: string; code: string; hours: number }> {
    return assignments
        .filter((a) => {
            if (a.dateStr !== dateStr) return false;
            if (excludeEmpIds.has(a.empId)) return false;
            if (positionName && a.positionName && a.positionName !== positionName) return false;
            const c = String(a.code || '').toUpperCase();
            return WORK_CODES.has(c);
        })
        .map((a) => ({
            empId: a.empId,
            code: String(a.code || '').toUpperCase(),
            hours: Number(a.hours) || SHIFT_HRS[String(a.code || '').toUpperCase()] || 8,
        }));
}

function bandsMissingOnDay(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    isModo12: boolean,
    pax: number,
): string[] {
    const needBands = isModo12 ? ['D12', 'N12'] : ['M', 'T', 'N'];
    const counts: Record<string, number> = {};

    for (const a of assignments) {
        if (a.dateStr !== dateStr) continue;
        if (positionName && a.positionName && a.positionName !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        let key = c;
        if (c === 'D12') key = 'D12';
        else if (c === 'N12') key = 'N12';
        if (!needBands.includes(key)) continue;
        counts[key] = (counts[key] || 0) + 1;
    }

    const missing: string[] = [];
    for (const b of needBands) {
        if (isModo12 && b === 'T') continue;
        const gap = Math.max(0, pax - (counts[b] || 0));
        for (let i = 0; i < gap; i++) missing.push(b);
    }
    return missing;
}

function countInternalRetOnDay(
    assignments: V2Assignment[],
    dateStr: string,
    excludeEmpIds: Set<string>,
): number {
    let n = 0;
    for (const a of assignments) {
        if (a.dateStr !== dateStr || excludeEmpIds.has(a.empId)) continue;
        if (isExternalRetEmpId(a.empId)) continue;
        const c = String(a.code || '').toUpperCase();
        if (c === 'RET' || (a.isReten && !a.positionName)) n++;
    }
    return n;
}

function classifyDayStrategy(
    coverers: Array<{ empId: string; code: string; hours: number }>,
    missingBands: string[],
    weeklyByEmp: Record<string, number>,
    monthlyByEmp: Record<string, number>,
    retStandbyCount = 0,
): { strategy: AbsenceCoverageStrategyId; messages: string[] } {
    const messages: string[] = [];

    if (missingBands.length > 0) {
        if (retStandbyCount > 0) {
            messages.push(
                `${retStandbyCount} guardia(s) en RET (capacidad disponible, no es hueco SLA).`,
                `Faltan bandas ${missingBands.join('+')} — activar RET antes de extensión 12h.`,
                RET_THEN_FT_HINT,
            );
        } else {
            messages.push(
                `Faltan bandas ${missingBands.join('+')}: probar RET externo en Modo 8 antes de contingencia D12/N12.`,
                RET_THEN_FT_HINT,
            );
        }
        return { strategy: 'external_ret', messages };
    }

    const hasExtension = coverers.some((c) => c.code === 'D12' || c.code === 'N12');
    const hasModo8Only = coverers.length > 0 && !hasExtension
        && coverers.every((c) => ['M', 'T', 'N'].includes(c.code));
    const hasExternal = coverers.some((c) => isExternalRetEmpId(c.empId));

    if (hasModo8Only && hasExternal) {
        messages.push('Modo 8: M+T+N con RET externo (8h). Sin contingencia D12/N12.');
        return { strategy: 'modo8_ret_externo', messages };
    }
    if (hasModo8Only && !hasExtension) {
        messages.push('Modo 8: cobertura M+T+N con bandas de 8h (sin extensión 12h).');
    } else if (hasExtension) {
        messages.push('Cobertura con extensión 12h (D12+N12) — contingencia.');
    }

    let blockedWeekly = false;
    let blockedMonthly = false;
    let warnWeekly = false;

    for (const c of coverers) {
        const wk = weeklyByEmp[c.empId] ?? 0;
        const mo = monthlyByEmp[c.empId] ?? 0;
        if (wk > WEEKLY_CAP_EXTENSION) {
            blockedWeekly = true;
            messages.push(
                `${c.empId}: semana ISO ${wk}h > ${WEEKLY_CAP_EXTENSION}h (tope con extensión).`,
            );
        } else if (wk > WEEKLY_CAP_SOFT) {
            warnWeekly = true;
            messages.push(
                `${c.empId}: semana ${wk}h > ${WEEKLY_CAP_SOFT}h (alerta; dentro del tope 56h).`,
            );
        }
        if (mo > HARD_MAX_HOURS) {
            blockedMonthly = true;
            messages.push(`${c.empId}: ${Math.round(mo)}h > ${HARD_MAX_HOURS}h CCT mensual.`);
        } else if (mo > SUVICO_POLICY.ALERTS.MONTHLY_BILLABLE_SOFT_WARN_HOURS && hasExtension) {
            messages.push(
                `${c.empId}: ${Math.round(mo)}h — acercándose al tope ${HARD_MAX_HOURS}h por extensiones 12h.`,
            );
        }
    }

    if (blockedMonthly) {
        return {
            strategy: 'blocked_monthly_200',
            messages: [...messages, `Extensión 12h superaría ${HARD_MAX_HOURS}h/mes.`, RET_THEN_FT_HINT],
        };
    }
    if (blockedWeekly) {
        return {
            strategy: 'blocked_weekly_56',
            messages: [...messages, `Extensión 12h superaría ${WEEKLY_CAP_EXTENSION}h/semana.`, RET_THEN_FT_HINT],
        };
    }
    if (warnWeekly) {
        return { strategy: 'internal_extension_warn', messages };
    }
    return {
        strategy: hasExtension ? 'internal_extension' : 'internal_extension_warn',
        messages,
    };
}

function isConsecutiveDate(prev: string, next: string): boolean {
    const [py, pm, pd] = prev.split('-').map(Number);
    const dt = new Date(py, pm - 1, pd + 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return key === next;
}

function makePeriod(
    empId: string,
    absenceCode: string,
    startDate: string,
    endDate: string,
    days: AbsenceCoveragePlanDay[],
): AbsenceCoveragePeriod {
    const blockDays = days.filter((d) =>
        d.absentEmpIds.includes(empId)
        && d.dateStr >= startDate
        && d.dateStr <= endDate,
    );
    const workDays = blockDays.filter((d) => d.strategy !== 'franco_no_coverage');
    const strategies = workDays.map((d) => d.strategy);
    let strategySummary: AbsenceCoverageStrategyId = 'internal_extension';
    if (strategies.some((s) => s === 'ft_last_resort')) {
        strategySummary = 'ft_last_resort';
    } else if (strategies.some((s) => s === 'external_ret' || s === 'uncovered')) {
        strategySummary = 'external_ret';
    } else if (strategies.some((s) => s === 'modo8_ret_externo' || s === 'modo8_ret_interno')) {
        strategySummary = 'modo8_ret_externo';
    } else if (strategies.some((s) => s === 'modo8_plantilla')) {
        strategySummary = 'modo8_plantilla';
    } else if (strategies.some((s) => s === 'blocked_monthly_200')) {
        strategySummary = 'blocked_monthly_200';
    } else if (strategies.some((s) => s === 'blocked_weekly_56')) {
        strategySummary = 'blocked_weekly_56';
    } else if (strategies.some((s) => s === 'internal_extension_warn')) {
        strategySummary = 'internal_extension_warn';
    }

    const messages: string[] = [];
    if (strategySummary === 'internal_extension') {
        messages.push(
            `Período cubrible con plantilla del objetivo (extensión 12h, ≤${WEEKLY_CAP_EXTENSION}h/sem, ≤${HARD_MAX_HOURS}h/mes).`,
        );
    } else if (strategySummary === 'ft_last_resort') {
        messages.push(
            'Último recurso: franco trabajado (FT) — costo doble CCT. Solo asignación manual.',
        );
    } else if (strategySummary === 'external_ret') {
        messages.push('Activar RET (interno u otro objetivo) en Modo 8 antes de contingencia 12h.');
    } else if (strategySummary === 'modo8_ret_externo' || strategySummary === 'modo8_plantilla') {
        messages.push('Cubierto en Modo 8 (M+T+N × 8h) — sin contingencia D12/N12.');
    } else if (strategySummary === 'blocked_monthly_200') {
        messages.push(`Extensión 12h choca con tope ${HARD_MAX_HOURS}h/mes. ${RET_THEN_FT_HINT}`);
    } else if (strategySummary === 'blocked_weekly_56') {
        messages.push(`Extensión 12h choca con tope ${WEEKLY_CAP_EXTENSION}h/semana. ${RET_THEN_FT_HINT}`);
    }

    return {
        absentEmpId: empId,
        absenceCode,
        startDate,
        endDate,
        dayCount: blockDays.length,
        workDaysNeedingCover: workDays.length,
        strategySummary,
        messages,
    };
}

function buildPeriods(
    days: AbsenceCoveragePlanDay[],
    absences: V2EngineContext['absences'],
): AbsenceCoveragePeriod[] {
    const periods: AbsenceCoveragePeriod[] = [];

    for (const [empId, dateMap] of Object.entries(absences)) {
        const sortedDates = [...dateMap.entries()]
            .filter(([, code]) => MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase()))
            .map(([dateStr]) => dateStr)
            .sort();
        if (sortedDates.length === 0) continue;

        let blockStart = sortedDates[0];
        let blockEnd = sortedDates[0];
        const blockCode = dateMap.get(sortedDates[0]) || 'V';

        for (let i = 1; i < sortedDates.length; i++) {
            const d = sortedDates[i];
            if (isConsecutiveDate(blockEnd, d) && dateMap.get(d) === blockCode) {
                blockEnd = d;
            } else {
                periods.push(makePeriod(empId, blockCode, blockStart, blockEnd, days));
                blockStart = d;
                blockEnd = d;
            }
        }
        periods.push(makePeriod(empId, blockCode, blockStart, blockEnd, days));
    }

    return periods;
}

export function planAbsenceCoverage(params: {
    ctx: V2EngineContext;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    modo12Days: string[];
    openingSlotByEmp?: Record<string, number>;
    splitActions?: AbsenceSplitAction[];
    coverageGaps?: CoverageGap[];
    uncovered?: UncoveredSlot[];
    modo8Plan?: Modo8ExternalRetPlan;
}): AbsenceCoveragePlan {
    const {
        ctx,
        assignments,
        stats,
        modo12Days,
        openingSlotByEmp,
        splitActions = [],
        coverageGaps = [],
        uncovered = [],
        modo8Plan,
    } = params;

    const modo12Set = new Set(modo12Days);
    const positionName = ctx.positions[0]?.positionName || '';
    const planDays: AbsenceCoveragePlanDay[] = [];

    const absenceDates = new Set<string>();
    for (const [, dateMap] of Object.entries(ctx.absences)) {
        for (const [dateStr, code] of dateMap.entries()) {
            if (MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) {
                absenceDates.add(dateStr);
            }
        }
    }

    for (const dateStr of [...absenceDates].sort()) {
        const absentEmpIds: string[] = [];
        for (const [empId, dateMap] of Object.entries(ctx.absences)) {
            const code = dateMap.get(dateStr);
            if (code && MODO12_ABSENCE_CODES.has(String(code).toUpperCase())) {
                absentEmpIds.push(empId);
            }
        }

        const workAbsents = absentEmpIds.filter((id) =>
            absenceRequiresCoverage(id, dateStr, openingSlotByEmp, ctx),
        );

        if (workAbsents.length === 0) {
            planDays.push({
                dateStr,
                absentEmpIds,
                strategy: 'franco_no_coverage',
                coverers: [],
                externalRetBands: [],
                weeklyHoursByEmp: {},
                monthlyHoursByEmp: {},
                messages: ['Ausencia en día de franco del ciclo — no hay brecha SLA.'],
            });
            continue;
        }

        const isModo12 = modo12Set.has(dateStr);
        const exclude = new Set(absentEmpIds);
        const coverers = coverersOnDay(assignments, dateStr, positionName, exclude);
        const pax = Math.max(1, Number(ctx.positions.find((p) => p.positionName === positionName)?.qty) || 1);
        const missingBands = bandsMissingOnDay(assignments, dateStr, positionName, isModo12, pax);

        const weekKey = isoWeekKey(dateStr);
        const weeklyByEmp: Record<string, number> = {};
        const monthlyByEmp: Record<string, number> = {};
        for (const c of coverers) {
            weeklyByEmp[c.empId] = weeklyHoursByEmp(assignments, c.empId, weekKey);
            monthlyByEmp[c.empId] = monthlyHoursByEmp(assignments, c.empId, stats);
        }

        const gapOnDay = isModo12
            ? []
            : coverageGaps.filter(
                (g) =>
                    g.dateStr === dateStr
                    && !g.coveredBy
                    && missingBands.includes(String(g.band || '').toUpperCase()),
            );
        const uncovOnDay = uncovered.filter(
            (u) =>
                u.dateStr === dateStr
                && missingBands.includes(String(u.shiftCode || '').toUpperCase()),
        );

        const retStandby = countInternalRetOnDay(assignments, dateStr, exclude);

        const modo8Day = modo8Plan?.modo8Days.find((d) => d.dateStr === dateStr);

        let { strategy, messages } = classifyDayStrategy(
            coverers,
            missingBands,
            weeklyByEmp,
            monthlyByEmp,
            retStandby,
        );

        if (modo8Day && missingBands.length === 0) {
            if (modo8Day.internalRetAssignments.length > 0 && modo8Day.bandsForExternal.length > 0) {
                strategy = 'modo8_ret_externo';
                messages = [
                    'Modo 8: RET interno + RET externo cubren M+T+N (8h). Sin contingencia D12/N12.',
                    ...messages,
                ];
            } else if (modo8Day.bandsForExternal.length > 0) {
                strategy = 'modo8_ret_externo';
                messages = [
                    `Modo 8: RET externo cubre ${modo8Day.bandsForExternal.join('+')} (8h). Sin contingencia.`,
                    ...messages,
                ];
            } else if (modo8Day.internalRetAssignments.length > 0) {
                strategy = 'modo8_ret_interno';
                messages = [
                    'Modo 8: RET interno activado — sobra capacidad en plantilla (no es hueco).',
                    ...messages,
                ];
            } else {
                strategy = 'modo8_plantilla';
                messages = ['Modo 8: plantilla del objetivo cierra M+T+N sin contingencia.', ...messages];
            }
        }

        const ftGap = gapOnDay.find((g) => g.coverageType === 'ft_required');
        const ftCandidates = ftGap?.ftCandidates || [];

        if (gapOnDay.length > 0 || uncovOnDay.length > 0) {
            if (ftCandidates.length > 0) {
                strategy = 'ft_last_resort';
                messages = [
                    ...messages,
                    'No alcanza extensión 12h ni RET en la plantilla del objetivo.',
                    `Último recurso: FT — ${ftCandidates.length} guardia(s) en franco disponible(s) (costo doble CCT).`,
                ];
            } else {
                strategy = 'external_ret';
                messages = [
                    ...messages,
                    'Hueco SLA sin cerrar con plantilla — asignar RET de otro objetivo.',
                    RET_THEN_FT_HINT,
                ];
            }
        } else if (
            strategy === 'blocked_weekly_56'
            || strategy === 'blocked_monthly_200'
            || strategy === 'external_ret'
        ) {
            messages = [...messages, RET_THEN_FT_HINT];
        }

        const splitOnDay = splitActions.filter((a) => a.dateStr === dateStr);
        if (splitOnDay.length > 0 && strategy === 'internal_extension') {
            messages.push(
                `Extensión aplicada: D12→${splitOnDay.map((s) => s.d12EmpId).join('/')}, N12→${splitOnDay.map((s) => s.n12EmpId).join('/')}.`,
            );
        }

        planDays.push({
            dateStr,
            absentEmpIds: workAbsents,
            strategy,
            coverers,
            externalRetBands: missingBands,
            ftCandidates: ftCandidates.length > 0 ? ftCandidates : undefined,
            weeklyHoursByEmp: weeklyByEmp,
            monthlyHoursByEmp: monthlyByEmp,
            messages,
        });
    }

    const periods = buildPeriods(planDays, ctx.absences);
    const needsExternalRet = planDays.some((d) =>
        d.strategy === 'external_ret'
        || d.strategy === 'blocked_weekly_56'
        || d.strategy === 'blocked_monthly_200'
        || d.strategy === 'uncovered',
    );
    const needsFtLastResort = planDays.some((d) => d.strategy === 'ft_last_resort');
    const allModo8 = planDays.length > 0 && planDays.every((d) =>
        d.strategy === 'modo8_plantilla'
        || d.strategy === 'modo8_ret_interno'
        || d.strategy === 'modo8_ret_externo'
        || d.strategy === 'franco_no_coverage',
    );
    const allInternal = planDays.length > 0 && planDays.every((d) =>
        d.strategy === 'internal_extension'
        || d.strategy === 'internal_extension_warn'
        || d.strategy === 'franco_no_coverage',
    );

    const workDays = planDays.filter((d) => d.strategy !== 'franco_no_coverage');
    const extDays = workDays.filter((d) =>
        d.strategy === 'internal_extension' || d.strategy === 'internal_extension_warn',
    ).length;
    const modo8Days = workDays.filter((d) =>
        d.strategy === 'modo8_plantilla'
        || d.strategy === 'modo8_ret_interno'
        || d.strategy === 'modo8_ret_externo',
    ).length;
    const retDays = workDays.filter((d) =>
        d.strategy === 'external_ret'
        || d.strategy === 'blocked_weekly_56'
        || d.strategy === 'blocked_monthly_200',
    ).length;
    const ftDays = workDays.filter((d) => d.strategy === 'ft_last_resort').length;
    const warnDays = workDays.filter((d) => d.strategy === 'internal_extension_warn').length;

    let summary: string;
    if (workDays.length === 0) {
        summary = 'Sin ausencias V/L/E que requieran cobertura en el período.';
    } else if (allModo8) {
        summary = `${modo8Days} día(s) cubiertos en Modo 8 (M+T+N × 8h). RET = capacidad disponible, sin contingencia D12/N12.`;
    } else if (allInternal && warnDays === 0) {
        summary = `${extDays} día(s) cubiertos con plantilla del objetivo (extensión 12h, ≤${WEEKLY_CAP_EXTENSION}h/sem, ≤${HARD_MAX_HOURS}h/mes).`;
    } else if (modo8Days > 0 && retDays === 0 && extDays === 0) {
        summary = `${modo8Days} día(s) cubiertos en Modo 8 (M+T+N × 8h, sin contingencia D12/N12).`;
    } else if (needsFtLastResort) {
        summary = `${extDays} día(s) con extensión interna; ${ftDays} día(s) requieren FT (último recurso, costo doble); ${retDays} día(s) probar RET antes.`;
    } else if (needsExternalRet) {
        summary = `${extDays} día(s) con extensión interna; ${retDays} día(s) requieren RET de otro objetivo (antes de FT).`;
    } else if (warnDays > 0) {
        summary = `${extDays} día(s) cubiertos con extensión interna; ${warnDays} con alerta de carga (>48h/sem o cercano a 200h/mes).`;
    } else {
        summary = `${workDays.length} día(s) con cobertura parcial — revisar avisos semanales/mensuales.`;
    }

    return {
        days: planDays,
        periods,
        summary,
        allInternal,
        needsExternalRet,
        needsFtLastResort,
    };
}

export const ABSENCE_COVERAGE_STRATEGY_LABELS: Record<AbsenceCoverageStrategyId, string> = {
    modo8_plantilla: 'Modo 8 — plantilla',
    modo8_ret_interno: 'Modo 8 — RET interno',
    modo8_ret_externo: 'Modo 8 — RET externo (8h)',
    internal_extension: 'Contingencia 12h (plantilla)',
    internal_extension_warn: 'Contingencia 12h (alerta carga)',
    blocked_weekly_56: 'Bloqueado: >56h/semana',
    blocked_monthly_200: 'Bloqueado: >200h/mes',
    external_ret: 'RET pendiente (antes de 12h)',
    ft_last_resort: 'FT último recurso (costo doble)',
    franco_no_coverage: 'Franco (sin brecha)',
    uncovered: 'Hueco sin cubrir',
};
