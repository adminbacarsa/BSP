import {
    computeDailyServiceSlots,
    resolveAutoPlanningBrain,
    type AutoPlanningBrainResult,
} from './autoPlanningBrain';
import type { V2AbsenceMap, V2EmployeeDef } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition } from './autoLabCaseCatalog';
import {
    calculateSlaHoursForVigencia,
    getServiceDaysInMonth,
} from './autoLabServicePeriod';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

export function getAutoLabDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getAutoLabDayLetter(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return DAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

export function buildDaysInMonth(year: number, month: number): Date[] {
    const days: Date[] = [];
    const last = new Date(year, month, 0).getDate();
    for (let d = 1; d <= last; d++) {
        days.push(new Date(year, month - 1, d));
    }
    return days;
}

export function buildSyntheticEmployees(count: number): V2EmployeeDef[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `lab-emp-${String(i + 1).padStart(2, '0')}`,
        nombre: `Guardia ${String(i + 1).padStart(2, '0')}`,
    }));
}

function positionActiveOnDay(pos: AutoLabCaseDefinition['positions'][number], dayLetter: string): boolean {
    const ad = pos.activeDays;
    if (!ad || ad.length === 0 || ad.length >= 7) return true;
    return ad.includes(dayLetter);
}

export function estimateSlaVendidas(
    positions: AutoLabCaseDefinition['positions'],
    daysInMonth: Date[],
): number {
    let hours = 0;
    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        const cov = String(pos.coverageType || '').toLowerCase();
        const is24 = cov === '24hs' || cov === '24' || cov === '24h';
        const bands = is24 ? 3 : (pos.shifts || []).length || 1;
        const posActiveDays = daysInMonth.filter((day) => {
            const letter = getAutoLabDayLetter(getAutoLabDateKey(day));
            return positionActiveOnDay(pos, letter);
        }).length;
        hours += qty * bands * posActiveDays * 8;
    }
    return Math.round(hours);
}

export function buildAbsencesForCase(
    caseDef: AutoLabCaseDefinition,
    daysInMonth: Date[],
    employees: V2EmployeeDef[],
): V2AbsenceMap {
    const absences: V2AbsenceMap = {};
    if (!caseDef.absences?.length) return absences;

    for (const a of caseDef.absences) {
        const emp = employees[a.empIndex];
        const day = daysInMonth[a.dayOfMonth - 1];
        if (!emp || !day) continue;
        const dateStr = getAutoLabDateKey(day);
        if (!absences[emp.id]) absences[emp.id] = new Map();
        absences[emp.id].set(dateStr, a.code);
    }
    return absences;
}

export interface AutoLabRunResult {
    caseId: string;
    year: number;
    month: number;
    brain: AutoPlanningBrainResult;
    employees: V2EmployeeDef[];
    positions: AutoLabCaseDefinition['positions'];
    slaVendidas: number;
    daysInMonth: Date[];
    fullMonthDays: Date[];
    slotsPerDay: number;
    peakConcurrent: number;
}

export function runAutoLabCase(
    caseDef: AutoLabCaseDefinition,
    year: number,
    month: number,
): AutoLabRunResult {
    const fullMonthDays = buildDaysInMonth(year, month);
    const hasVigencia = !!(caseDef.serviceStartDate && caseDef.serviceEndDate);
    const daysInMonth = hasVigencia
        ? getServiceDaysInMonth(
            year,
            month,
            caseDef.serviceStartDate!,
            caseDef.serviceEndDate!,
            caseDef.excludedDates,
        )
        : fullMonthDays;

    const employees = buildSyntheticEmployees(caseDef.employeeCount);
    const absences = buildAbsencesForCase(caseDef, fullMonthDays, employees);

    let slaVendidas: number;
    if (caseDef.slaVendidas != null) {
        slaVendidas = caseDef.slaVendidas;
    } else if (hasVigencia) {
        slaVendidas = calculateSlaHoursForVigencia(
            caseDef.positions,
            caseDef.serviceStartDate!,
            caseDef.serviceEndDate!,
            caseDef.excludedDates,
            year,
            month,
        );
    } else {
        slaVendidas = estimateSlaVendidas(caseDef.positions, daysInMonth);
    }

    const contingencyDaysManual = (caseDef.contingencyDays || [])
        .map((d) => {
            const day = daysInMonth[d - 1];
            return day ? getAutoLabDateKey(day) : '';
        })
        .filter(Boolean);

    const rotateShiftsOverride =
        caseDef.rotateShiftsOverride ??
        (caseDef.rotationMode === 'rotative'
            ? true
            : caseDef.rotationMode === 'fixed'
              ? false
              : undefined);

    const slots = computeDailyServiceSlots(caseDef.positions, '8');

    const brain = resolveAutoPlanningBrain({
        positions: caseDef.positions,
        employees,
        daysInMonth,
        empMonthlyInitial: Object.fromEntries(employees.map((e) => [e.id, 0])),
        absences,
        slaVendidas,
        budgetMode: 'cct',
        objectiveId: `auto-lab-${caseDef.id}`,
        getDayLetter: getAutoLabDayLetter,
        getDateKey: getAutoLabDateKey,
        contingencyDaysManual,
        rotateShiftsOverride,
        cycleOverride: caseDef.cycleOverride,
    });

    return {
        caseId: caseDef.id,
        year,
        month,
        brain,
        employees,
        positions: caseDef.positions,
        slaVendidas,
        daysInMonth,
        fullMonthDays,
        slotsPerDay: slots.slotsPerDay,
        peakConcurrent: slots.peakConcurrent,
    };
}

export function buildAutoLabExportJson(
    result: AutoLabRunResult,
    caseDef: AutoLabCaseDefinition,
): Record<string, unknown> {
    const { brain } = result;
    return {
        autoLabVersion: 1,
        exportedAt: new Date().toISOString(),
        case: {
            id: caseDef.id,
            order: caseDef.order,
            title: caseDef.title,
            subtitle: caseDef.subtitle,
        },
        period: {
            year: result.year,
            month: result.month,
            daysInMonth: result.daysInMonth.length,
            fullMonthDays: result.fullMonthDays.length,
        },
        vigencia: caseDef.serviceStartDate && caseDef.serviceEndDate
            ? {
                serviceStartDate: caseDef.serviceStartDate,
                serviceEndDate: caseDef.serviceEndDate,
                excludedDates: caseDef.excludedDates || [],
            }
            : undefined,
        synthetic: {
            positions: result.positions,
            employees: result.employees.map((e) => ({ id: e.id, nombre: e.nombre })),
            slaVendidas: result.slaVendidas,
            cycle: caseDef.cycle,
            rotationMode: caseDef.rotationMode,
            slotsPerDay: result.slotsPerDay,
            peakConcurrent: result.peakConcurrent,
        },
        brain: {
            pickedCycle: brain.pickedCycle,
            cycles: brain.cycles,
            rotateShifts: brain.rotateShifts,
            ajustarCrono: brain.ajustarCrono,
            strictSixTwo: brain.strictSixTwo,
            recommendedAlternative: brain.recommendedAlternative,
            staffing: brain.staffing,
            feasibility: {
                ok: brain.feasibility.ok,
                reasons: brain.feasibility.reasons,
                warnings: brain.feasibility.warnings,
                metrics: brain.feasibility.metrics,
            },
            modo12DaysAuto: brain.modo12DaysAuto,
            modo12DaysEngine: brain.modo12DaysEngine,
            absenceModo12Ok: brain.absenceModo12Ok,
            contingencyOk: brain.contingencyOk,
            warnings: brain.warnings,
            diagnosis: brain.diagnosis,
        },
    };
}
