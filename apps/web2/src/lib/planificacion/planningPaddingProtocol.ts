/**
 * Protocolo COSP — guardias semi-reales para cerrar plantilla (lab-pad-*).
 *
 * Reglas (alineado con motor V2 y rosterHeadcountBalance):
 * - Solo completan déficit estructural vs plantilla SLA (pax/ciclo), no inflan por horas vendidas.
 * - ID `lab-pad-NN`; flag `planningPadding: true`; prioridad menor que legajos reales en matching.
 * - Si un real queda ocioso, desplaza al sintético del puesto; excedente → RET / Franco (no facturable).
 * - No persisten en Firestore: reemplazar por altas reales o volantes en operación.
 */

import { checkFeasibility, type V2AbsenceMap, type V2EmployeeDef, type V2PositionDef } from './autoScheduleEngineV2';
import {
    computeCustomObjectivePoolHeadcount,
    computeObjectiveRequiredHeadcount,
    estimatePeopleFromContractHours,
    isFullCustomObjectivePool,
    isLabPaddingEmpId,
} from './objectiveHeadcount';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { buildPlanningRunPlan24hs } from './planningRunPlan';

export const PLANNING_PADDING_ID_PREFIX = 'lab-pad-';

export type PlanningDotacionPaddingReport = {
    realLegajos: number;
    paddingLegajos: number;
    efectivos: number;
    added: V2EmployeeDef[];
};

export function countRealPlanningLegajos(employees: V2EmployeeDef[]): number {
    return employees.filter((e) => !isLabPaddingEmpId(e.id)).length;
}

export function buildPlanningPaddingEmployees(params: {
    startLabel: number;
    count: number;
    occupiedIds: Set<string>;
    objectiveId?: string;
}): V2EmployeeDef[] {
    const out: V2EmployeeDef[] = [];
    let n = params.startLabel;
    while (out.length < params.count) {
        const id = `${PLANNING_PADDING_ID_PREFIX}${String(n).padStart(2, '0')}`;
        n += 1;
        if (params.occupiedIds.has(id)) continue;
        params.occupiedIds.add(id);
        const seq = out.length + 1;
        out.push({
            id,
            nombre: `Ref. SLA ${String(seq).padStart(2, '0')} (completar dotación)`,
            planningPadding: true,
            preferredObjectiveId: params.objectiveId,
        });
    }
    return out;
}

/**
 * Completa la dotación con guardias semi-reales cuando falta plantilla estructural.
 */
export function padPlanningRosterForAutoSchedule(params: {
    positions: V2PositionDef[];
    employees: V2EmployeeDef[];
    daysInMonth: Date[];
    slaVendidas: number;
    absences: V2AbsenceMap;
    empMonthlyInitial: Record<string, number>;
    cycleKey?: string;
    getDateKey: (d: Date) => string;
    getDayLetter: (dateStr: string) => string;
    maxPad?: number;
    objectiveId?: string;
}): { employees: V2EmployeeDef[]; added: V2EmployeeDef[]; warnings: string[] } {
    const maxPad = params.maxPad ?? 24;
    const cycleKey = params.cycleKey ?? '6+2';
    const warnings: string[] = [];
    let roster = [...params.employees];
    const occupiedIds = new Set(roster.map((e) => e.id));
    const added: V2EmployeeDef[] = [];

    const empMonthlyInitialBase = { ...params.empMonthlyInitial };
    const preFeas = checkFeasibility({
        positions: params.positions,
        employees: roster,
        daysInMonth: params.daysInMonth,
        empMonthlyInitial: empMonthlyInitialBase,
        absences: params.absences,
        slaVendidas: params.slaVendidas,
        autoCycles: [cycleKey],
        objectiveId: params.objectiveId ?? 'roster-pad-check',
        getDateKey: params.getDateKey,
        getDayLetter: params.getDayLetter,
        budgetMode: 'cct',
        headcountByPax: true,
    });
    const m0 = preFeas.metrics;
    const structuralRow = m0.cycleComparison?.find((c) => c.cycleKey === cycleKey);
    const perPositionHeads = computeObjectiveRequiredHeadcount(params.positions, cycleKey);
    const realCount = params.employees.filter((e) => !isLabPaddingEmpId(e.id)).length;
    const paddingAlready = params.employees.filter((e) => isLabPaddingEmpId(e.id)).length;
    let structuralTarget = perPositionHeads;
    if (isFullCustomObjectivePool(params.positions)) {
        for (const ck of ['5+1', '6+2', '6+1', '4+2'] as const) {
            const need = computeCustomObjectivePoolHeadcount(params.positions, ck);
            if (realCount >= need) {
                structuralTarget = need;
                break;
            }
        }
    }
    const need = Math.max(0, structuralTarget - realCount - paddingAlready);

    if (need > 0) {
        const batch = buildPlanningPaddingEmployees({
            startLabel: roster.length + 1,
            count: Math.min(need, maxPad),
            occupiedIds,
            objectiveId: params.objectiveId,
        });
        if (batch.length > 0) {
            added.push(...batch);
            roster = [...roster, ...batch];
        }
    }

    if (added.length > 0 && added.length < maxPad) {
        const empMonthlyInitial: Record<string, number> = {};
        for (const emp of roster) {
            empMonthlyInitial[emp.id] = params.empMonthlyInitial[emp.id] ?? 0;
        }
        const structuralAfter = computeObjectiveRequiredHeadcount(params.positions, cycleKey);
        const peopleGap = Math.max(0, structuralAfter - realCount - added.length);
        if (peopleGap > 0) {
            const batch = buildPlanningPaddingEmployees({
                startLabel: roster.length + 1,
                count: Math.min(peopleGap, maxPad - added.length),
                occupiedIds,
                objectiveId: params.objectiveId,
            });
            added.push(...batch);
            roster = [...roster, ...batch];
        }
    }

    const hoursHeadcountHint = m0.peopleNeededByHoursEstimate ?? estimatePeopleFromContractHours(params.slaVendidas);
    if (
        roster.length >= structuralTarget
        && hoursHeadcountHint > structuralTarget
    ) {
        warnings.push(
            `Dotación estructural completa (${roster.length}/${structuralTarget} guardias: plantilla ${cycleKey}). `
            + `Las horas vendidas del SLA (~${hoursHeadcountHint} personas si se reparten a ~192h) no inflan la dotación: `
            + `se planifica por pax de puestos.`,
        );
    }

    if (added.length > 0) {
        warnings.push(
            `Protocolo semi-real: ${added.length} refuerzo(s) SLA (lab-pad) — ${realCount} legajos reales `
            + `→ ${roster.length} efectivos para plantilla ${structuralTarget} (${cycleKey}). `
            + 'Prioridad baja vs reales; excedente en RET/Franco. Reemplazar por altas en RRHH.',
        );
    }

    void structuralRow;

    return { employees: roster, added, warnings };
}

export function applyPlanningDotacionPadding(params: {
    positions: V2PositionDef[];
    employees: V2EmployeeDef[];
    daysInMonth: Date[];
    slaVendidas: number;
    absences: V2AbsenceMap;
    empMonthlyInitial: Record<string, number>;
    getDateKey: (d: Date) => string;
    getDayLetter: (dateStr: string) => string;
    objectiveId?: string;
    cycleKey?: string;
    autoCycles?: string[];
    headcountByPax?: boolean;
}): {
    employees: V2EmployeeDef[];
    empMonthlyInitial: Record<string, number>;
    absences: V2AbsenceMap;
    report: PlanningDotacionPaddingReport;
    warnings: string[];
} {
    const realLegajos = countRealPlanningLegajos(params.employees);
    const existingPadding = params.employees.filter((e) => isLabPaddingEmpId(e.id)).length;
    const emptyReport = (efectivos = params.employees.length): PlanningDotacionPaddingReport => ({
        realLegajos,
        paddingLegajos: existingPadding,
        efectivos,
        added: [],
    });

    if (params.headcountByPax === false) {
        return {
            employees: params.employees,
            empMonthlyInitial: params.empMonthlyInitial,
            absences: params.absences,
            report: emptyReport(),
            warnings: [],
        };
    }

    const profile = buildObjectiveScheduleProfile(params.positions);
    const cycleKey = params.cycleKey
        ?? params.autoCycles?.[0]
        ?? profile.cyclePreference[0]
        ?? '6+2';

    let maxPad = 24;
    if (profile.kind === '24hs_only') {
        const planProbe = buildPlanningRunPlan24hs({
            positions: params.positions,
            employees: params.employees,
            daysInMonth: params.daysInMonth,
            empMonthlyInitial: params.empMonthlyInitial,
            absences: params.absences,
            slaVendidas: params.slaVendidas,
            autoCycles: params.autoCycles ?? [cycleKey],
            getDateKey: params.getDateKey,
            getDayLetter: params.getDayLetter,
            budgetMode: 'cct',
            objectiveId: params.objectiveId,
            headcountByPax: params.headcountByPax ?? true,
        });
        const mtnTarget = planProbe?.mtnStructuralHeadcount ?? 0;
        maxPad = Math.max(0, mtnTarget > 0 ? mtnTarget - realLegajos : 24);
    }

    const pad = padPlanningRosterForAutoSchedule({
        positions: params.positions,
        employees: params.employees,
        daysInMonth: params.daysInMonth,
        slaVendidas: params.slaVendidas,
        absences: params.absences,
        empMonthlyInitial: params.empMonthlyInitial,
        cycleKey,
        getDateKey: params.getDateKey,
        getDayLetter: params.getDayLetter,
        maxPad,
        objectiveId: params.objectiveId,
    });

    if (pad.added.length === 0) {
        return {
            employees: params.employees,
            empMonthlyInitial: params.empMonthlyInitial,
            absences: params.absences,
            report: emptyReport(),
            warnings: pad.warnings,
        };
    }

    const empMonthlyInitial = { ...params.empMonthlyInitial };
    const absences = { ...params.absences };
    for (const e of pad.added) {
        empMonthlyInitial[e.id] = 0;
        if (!absences[e.id]) absences[e.id] = new Map();
    }

    const employees = pad.employees.map((e) => ({
        ...e,
        preferredObjectiveId: params.objectiveId ?? e.preferredObjectiveId,
    }));

    return {
        employees,
        empMonthlyInitial,
        absences,
        report: {
            realLegajos,
            paddingLegajos: employees.filter((e) => isLabPaddingEmpId(e.id)).length,
            efectivos: employees.length,
            added: pad.added,
        },
        warnings: pad.warnings,
    };
}
