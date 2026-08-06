import {
    computeDailyServiceSlots,
    computeDailyStaffingModel,
    resolveAutoPlanningBrain,
    type AutoPlanningBrainResult,
} from './autoPlanningBrain';
import {
    type V2AbsenceMap,
    type V2EmployeeDef,
} from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition } from './autoLabCaseCatalog';
import type { AutoLabScheduleOutcome } from './autoLabSchedule';
import { buildEmployeePositionMap } from './autoLabAssignmentIndex';
import {
    calculateSlaHoursForVigencia,
    getServiceDaysInMonth,
} from './autoLabServicePeriod';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { buildRosterSurplusReport, type RosterSurplusReport } from './rosterSurplus';
import { padPlanningRosterForAutoSchedule } from './planningPaddingProtocol';

export { padPlanningRosterForAutoSchedule } from './planningPaddingProtocol';

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
    fullMonthDays: Date[],
    employees: V2EmployeeDef[],
): V2AbsenceMap {
    const absences: V2AbsenceMap = {};

    if (caseDef.absencesByDate?.length) {
        for (const a of caseDef.absencesByDate) {
            if (!employees.some((e) => e.id === a.empId)) continue;
            if (!absences[a.empId]) absences[a.empId] = new Map();
            absences[a.empId].set(a.dateStr, a.code);
        }
    }

    if (caseDef.absences?.length) {
        for (const a of caseDef.absences) {
            const emp = employees[a.empIndex];
            const day = fullMonthDays[a.dayOfMonth - 1];
            if (!emp || !day) continue;
            const dateStr = getAutoLabDateKey(day);
            if (!absences[emp.id]) absences[emp.id] = new Map();
            absences[emp.id].set(dateStr, a.code);
        }
    }

    return absences;
}

export interface AutoLabRunResult {
    caseId: string;
    year: number;
    month: number;
    /** Objetivo Firestore / lab — debe alinear con preferredObjectiveId de guardias. */
    objectiveId: string;
    brain: AutoPlanningBrainResult;
    employees: V2EmployeeDef[];
    /** Guardias reales o sintéticos del caso, antes de completar dotación. */
    sourceEmployees: V2EmployeeDef[];
    /** Guardias agregados automáticamente para cerrar viabilidad. */
    paddedEmployees: V2EmployeeDef[];
    rosterWarnings: string[];
    /** Análisis de dotación en exceso (reales, plantilla, puesto). */
    rosterSurplus: RosterSurplusReport;
    positions: AutoLabCaseDefinition['positions'];
    absences: V2AbsenceMap;
    slaVendidas: number;
    daysInMonth: Date[];
    /** Días dentro de vigencia (incluye fechas excluidas del servicio). */
    calendarDaysInVigencia: Date[];
    /** Fechas sin servicio a nivel contrato. */
    serviceExcludedDates: string[];
    fullMonthDays: Date[];
    slotsPerDay: number;
    peakConcurrent: number;
}

export function runAutoLabCase(
    caseDef: AutoLabCaseDefinition,
    year: number,
    month: number,
    options?: {
        employees?: V2EmployeeDef[];
        objectiveIdForBrain?: string;
    },
): AutoLabRunResult {
    const fullMonthDays = buildDaysInMonth(year, month);
    const hasVigencia = !!(caseDef.serviceStartDate && caseDef.serviceEndDate);
    const serviceExcludedDates = caseDef.excludedDates?.length ? [...caseDef.excludedDates] : [];
    const calendarDaysInVigencia = hasVigencia
        ? getServiceDaysInMonth(
            year,
            month,
            caseDef.serviceStartDate!,
            caseDef.serviceEndDate!,
            undefined,
        )
        : fullMonthDays;
    const daysInMonth = hasVigencia
        ? getServiceDaysInMonth(
            year,
            month,
            caseDef.serviceStartDate!,
            caseDef.serviceEndDate!,
            caseDef.excludedDates,
        )
        : fullMonthDays;

    const sourceEmployees = options?.employees?.length
        ? options.employees
        : buildSyntheticEmployees(caseDef.employeeCount);
    const absences = buildAbsencesForCase(caseDef, fullMonthDays, sourceEmployees);

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

    const cycleKey = caseDef.cycleOverride
        ?? (() => {
            const k = buildObjectiveScheduleProfile(caseDef.positions).kind;
            if (k === 'custom_only') return '5+1';
            return caseDef.cycle ?? '6+2';
        })();
    const empMonthlyInitial = Object.fromEntries(sourceEmployees.map((e) => [e.id, 0]));
    const padResult = padPlanningRosterForAutoSchedule({
        positions: caseDef.positions,
        employees: sourceEmployees,
        daysInMonth,
        slaVendidas,
        absences,
        empMonthlyInitial,
        cycleKey,
        getDateKey: getAutoLabDateKey,
        getDayLetter: getAutoLabDayLetter,
        objectiveId: options?.objectiveIdForBrain ?? `auto-lab-${caseDef.id}`,
    });
    const employees = padResult.employees;
    const fullEmpMonthlyInitial = {
        ...empMonthlyInitial,
        ...Object.fromEntries(padResult.added.map((e) => [e.id, 0])),
    };

    const brain = resolveAutoPlanningBrain({
        positions: caseDef.positions,
        employees,
        daysInMonth,
        empMonthlyInitial: fullEmpMonthlyInitial,
        absences,
        slaVendidas,
        budgetMode: 'cct',
        objectiveId: options?.objectiveIdForBrain ?? `auto-lab-${caseDef.id}`,
        getDayLetter: getAutoLabDayLetter,
        getDateKey: getAutoLabDateKey,
        contingencyDaysManual,
        rotateShiftsOverride,
        cycleOverride: caseDef.cycleOverride,
        headcountByPax: true,
    });

    const rosterSurplus = buildRosterSurplusReport({
        positions: caseDef.positions,
        sourceEmployees,
        paddedEmployees: padResult.added,
        employees,
        feasibility: brain.feasibility,
        cycleKey: brain.pickedCycle,
        slaVendidas,
    });

    const objectiveId = options?.objectiveIdForBrain ?? `auto-lab-${caseDef.id}`;

    return {
        caseId: caseDef.id,
        year,
        month,
        objectiveId,
        brain,
        employees,
        sourceEmployees,
        paddedEmployees: padResult.added,
        rosterWarnings: padResult.warnings,
        rosterSurplus,
        positions: caseDef.positions,
        absences,
        slaVendidas,
        daysInMonth,
        calendarDaysInVigencia,
        serviceExcludedDates,
        fullMonthDays,
        slotsPerDay: slots.slotsPerDay,
        peakConcurrent: slots.peakConcurrent,
    };
}

export function buildAutoLabExportJson(
    result: AutoLabRunResult,
    caseDef: AutoLabCaseDefinition,
    scheduleOutcome?: AutoLabScheduleOutcome | null,
): Record<string, unknown> {
    const { brain } = result;
    const gen = scheduleOutcome?.generation;
    const positionGroups = gen?.stats.positionGroups;
    const empPositionMap = gen
        ? buildEmployeePositionMap(
            result.employees,
            gen.assignments,
            positionGroups,
            gen.stats.idleEmployeeIds,
        )
        : {};

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
            sourceEmployees: result.sourceEmployees.map((e) => ({ id: e.id, nombre: e.nombre })),
            paddedEmployees: result.paddedEmployees.map((e) => ({ id: e.id, nombre: e.nombre })),
            rosterWarnings: result.rosterWarnings,
            rosterSurplus: scheduleOutcome?.rosterSurplus ?? result.rosterSurplus,
            slaVendidas: result.slaVendidas,
            cycle: caseDef.cycle,
            rotationMode: caseDef.rotationMode,
            slotsPerDay: result.slotsPerDay,
            peakConcurrent: result.peakConcurrent,
            absences: Object.entries(result.absences).flatMap(([empId, byDate]) =>
                Array.from(byDate.entries()).map(([dateStr, code]) => ({ empId, dateStr, code })),
            ),
        },
        slaContract: caseDef.positionAssignmentsByEmp
            || (caseDef.serviceRules?.length ?? 0) > 0
            || (caseDef.serviceRotations?.length ?? 0) > 0
            || (scheduleOutcome?.positionAssignmentViolations?.length ?? 0) > 0
            || (scheduleOutcome?.cronogramValidationIssues?.length ?? 0) > 0
            ? {
                hasPositionAssignments: !!caseDef.positionAssignmentsByEmp,
                positionAssignmentEmpCount: Object.keys(caseDef.positionAssignmentsByEmp ?? {}).length,
                serviceRulesCount: caseDef.serviceRules?.length ?? 0,
                serviceRotationsCount: caseDef.serviceRotations?.length ?? 0,
                positionAssignmentViolationCount: scheduleOutcome?.positionAssignmentViolations?.length ?? 0,
                cronogramValidationIssueCount: scheduleOutcome?.cronogramValidationIssues?.length ?? 0,
            }
            : undefined,
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
        schedule: gen
            ? {
                pipeline: scheduleOutcome?.pipeline,
                planningGeneration: scheduleOutcome?.planningRoute
                    ? {
                        serviceKind: scheduleOutcome.planningRoute.serviceKind,
                        motorId: scheduleOutcome.planningRoute.motorId,
                        labelEs: scheduleOutcome.planningRoute.labelEs,
                        postProcessPipeline: scheduleOutcome.planningRoute.postProcessPipeline,
                        reasons: scheduleOutcome.planningRoute.reasons,
                    }
                    : undefined,
                totalBillableHours: gen.stats.totalBillableHours,
                uncoveredSlots: gen.stats.uncoveredSlots,
                scheduleClosureOk: scheduleOutcome?.scheduleClosure?.ok,
                scheduleClosureMessages: scheduleOutcome?.scheduleClosure?.messages ?? [],
                positionGroups,
                primaryShiftByEmp: gen.stats.primaryShiftByEmp,
                employeePositionMap: empPositionMap,
                externalRetEmployees: (scheduleOutcome?.externalRetEmployees ?? []).map((e) => ({
                    id: e.id,
                    nombre: e.nombre,
                })),
                externalRetActions: scheduleOutcome?.externalRetActions ?? [],
                assignmentsSample: gen.assignments.slice(0, 40).map((a) => ({
                    date: a.dateStr,
                    empId: a.empId,
                    positionName: a.positionName,
                    code: a.code,
                })),
            }
            : scheduleOutcome?.error
              ? { error: scheduleOutcome.error }
              : undefined,
    };
}
