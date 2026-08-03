import type { V2EmployeeDef, V2FeasibilityReport, V2GenerateStats, V2PositionDef } from './autoScheduleEngineV2';
import { computeDailyStaffingModel } from './autoPlanningBrain';
import { computeObjectiveRequiredHeadcount, isFullCustomObjectivePool } from './objectiveHeadcount';
import { pickRetDesignee } from './absenceFrancoUtils';
import { buildSurplusEmployeePool } from './surplusAbsentSubstitution';
import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';

export interface RosterSurplusPositionExcess {
    positionName: string;
    assigned: number;
    needed: number;
    excess: number;
    employeeIds?: string[];
}

export interface RosterSurplusReport {
    sourceCount: number;
    paddedCount: number;
    totalCount: number;
    /** Suma de qty (cabezas en servicio simultáneo). */
    floorHeads: number;
    plantillaTotal: number;
    structuralPeakPeople: number;
    peopleNeededForTarget: number;
    peopleNeededFinal: number;
    surplusVsFloor: number;
    surplusVsPlantilla: number;
    surplusVsHoursNeed: number;
    excessByPosition: RosterSurplusPositionExcess[];
    idleEmployeeIds: string[];
    retDesigneeId?: string;
    retDesigneeNombre?: string;
    warnings: string[];
    hasSurplus: boolean;
}

function employeeName(employees: V2EmployeeDef[], id: string): string {
    return employees.find((e) => e.id === id)?.nombre ?? id;
}

function floorHeadsFromPositions(positions: V2PositionDef[]): number {
    return positions.reduce((s, p) => s + Math.max(1, Number(p.qty) || 1), 0);
}

export function buildRosterSurplusReport(params: {
    positions: V2PositionDef[];
    sourceEmployees: V2EmployeeDef[];
    paddedEmployees: V2EmployeeDef[];
    employees: V2EmployeeDef[];
    feasibility: V2FeasibilityReport;
    cycleKey: string;
    slaVendidas: number;
    stats?: V2GenerateStats;
    assignments?: V2Assignment[];
    ctx?: V2EngineContext;
}): RosterSurplusReport {
    const {
        positions,
        sourceEmployees,
        paddedEmployees,
        employees,
        feasibility,
        cycleKey,
        slaVendidas,
        stats,
        assignments,
        ctx,
    } = params;

    const m = feasibility.metrics;
    const staffing = computeDailyStaffingModel(positions, cycleKey, slaVendidas);
    const floorHeads = floorHeadsFromPositions(positions);
    const customPool = isFullCustomObjectivePool(positions);
    const perPositionHeads = computeObjectiveRequiredHeadcount(positions, cycleKey);
    const objectiveHeadcount = customPool
        ? perPositionHeads
        : Math.max(
            staffing.plantillaTotal,
            perPositionHeads,
            m.peopleNeededForStructure ?? 0,
            m.structuralPeakPeople ?? 0,
        );
    const peopleNeededFinal = objectiveHeadcount;

    const sourceCount = sourceEmployees.length;
    const paddedCount = paddedEmployees.length;
    const totalCount = employees.length;

    const surplusVsFloor = Math.max(0, sourceCount - floorHeads);
    const surplusVsPlantilla = Math.max(0, totalCount - objectiveHeadcount);
    const surplusVsHoursNeed = Math.max(0, totalCount - m.peopleNeededForTarget);
    const idleFromFeas = Math.max(0, m.peopleAvailable - objectiveHeadcount);

    const excessByPosition: RosterSurplusPositionExcess[] = (stats?.excessPositionEmployees ?? []).map((row) => ({
        ...row,
        employeeIds: stats?.positionGroups?.[row.positionName],
    }));

    const idleEmployeeIds = stats?.idleEmployeeIds?.length
        ? [...stats.idleEmployeeIds]
        : [];

    const retDesigneeId = stats && ctx
        ? pickRetDesignee(ctx, stats, assignments)
        : stats?.retDesignateEmpIds?.[0];

    const warnings: string[] = [];

    warnings.push(
        customPool
            ? `Objetivo custom pool: plantilla ${objectiveHeadcount} con ciclo ${cycleKey}; `
            + `dotación real ${sourceCount}, roster ${totalCount}.`
            : `Objetivo requiere ${objectiveHeadcount} guardia(s) estructural(es) `
            + `(rotación 24hs + custom según SLA); dotación real ${sourceCount}, roster planificado ${totalCount}.`,
    );

    if (surplusVsFloor > 0) {
        warnings.push(
            customPool
                ? `Dotación (${sourceCount}) supera el piso de qty simultáneos (${floorHeads}): `
                + `${surplusVsFloor} legajo(s) sin puesto titular fijo — asignar por Cobertura de dotación o RET.`
                : `Dotación en exceso (piso): ${sourceCount} guardia(s) asignado(s) al objetivo pero la estructura del SLA `
                + `solo requiere ${floorHeads} puesto(s) en simultáneo (suma de qty). Sobran ${surplusVsFloor} legajo(s) reales `
                + `que no tienen puesto fijo — el motor los mezcla en rotación 24hs o los deja en RET/Franco.`,
        );
    }

    if (surplusVsPlantilla > 0) {
        warnings.push(
            `Dotación en exceso: el objetivo necesita ${objectiveHeadcount} guardia(s) `
            + `y hay ${totalCount} (+${surplusVsPlantilla}). `
            + `El excedente (${surplusVsPlantilla}) queda en RET/Franco sin turnos facturables.`,
        );
    }

    const deficitVsPlantilla = Math.max(0, objectiveHeadcount - sourceCount);
    if (deficitVsPlantilla > 0 && paddedCount === 0) {
        warnings.push(
            `DÉFICIT DOTACIÓN: faltan ${deficitVsPlantilla} legajo(s) real(es) `
            + `(${sourceCount}/${objectiveHeadcount}). Agregá guardias al objetivo o dejá que el motor sume sintéticos RET.`,
        );
    }

    if (paddedCount > 0) {
        warnings.push(
            `Auto-completar dotación: ${paddedCount} guardia(s) sintético(s) agregado(s) `
            + `(RET/sin turno) para cubrir déficit estructural (${sourceCount} → ${totalCount} / ${objectiveHeadcount} requeridos).`,
        );
        if (sourceCount >= objectiveHeadcount) {
            warnings.push(
                `Nota: la dotación real (${sourceCount}) ya cubría la plantilla; revisá si el SLA vendido está inflado.`,
            );
        }
    }

    if (idleFromFeas > 0 && !stats) {
        warnings.push(
            `Capacidad ociosa estimada: ~${idleFromFeas} guardia(s) de más respecto a las ${peopleNeededFinal} `
            + `necesarias para ciclo ${cycleKey}. Quedarán en RET/Franco.`,
        );
    }

    for (const row of excessByPosition) {
        if (row.excess <= 0) continue;
        warnings.push(
            `Puesto «${row.positionName}»: ${row.assigned} guardias en el grupo pero el ciclo solo necesita `
            + `${row.needed} (+${row.excess} de más).`,
        );
    }

    if (stats && idleEmployeeIds.length > 0) {
        const names = idleEmployeeIds.map((id) => employeeName(employees, id)).join(', ');
        warnings.push(
            `${idleEmployeeIds.length} guardia(s) sobrante(s) en RET/Franco (sin turnos facturables): ${names}.`,
        );
    }

    const retIds = stats?.retDesignateEmpIds ?? (retDesigneeId ? [retDesigneeId] : []);
    if (retIds.length > 0) {
        const names = retIds.map((id) => employeeName(employees, id)).join(', ');
        warnings.push(
            `Pool RET stand-by (${retIds.length}): ${names}.`,
        );
    }

    const hasSurplus = surplusVsFloor > 0
        || surplusVsPlantilla > 0
        || surplusVsHoursNeed > 0
        || excessByPosition.some((r) => r.excess > 0)
        || idleEmployeeIds.length > 0
        || idleFromFeas > 0;

    return {
        sourceCount,
        paddedCount,
        totalCount,
        floorHeads,
        plantillaTotal: staffing.plantillaTotal,
        structuralPeakPeople: m.structuralPeakPeople ?? staffing.plantillaTotal,
        peopleNeededForTarget: m.peopleNeededForTarget,
        peopleNeededFinal,
        surplusVsFloor,
        surplusVsPlantilla,
        surplusVsHoursNeed,
        excessByPosition,
        idleEmployeeIds,
        retDesigneeId,
        retDesigneeNombre: retDesigneeId ? employeeName(employees, retDesigneeId) : undefined,
        warnings,
        hasSurplus,
    };
}

export function enrichRosterSurplusWithSchedule(
    base: RosterSurplusReport,
    params: {
        employees: V2EmployeeDef[];
        stats: V2GenerateStats;
        assignments: V2Assignment[];
        ctx: V2EngineContext;
    },
): RosterSurplusReport {
    const { employees, stats, assignments, ctx } = params;
    const warnings = [...base.warnings];

    const excessByPosition: RosterSurplusPositionExcess[] = (stats.excessPositionEmployees ?? []).map((row) => ({
        ...row,
        employeeIds: stats.positionGroups?.[row.positionName],
    }));

    for (const row of excessByPosition) {
        if (row.excess <= 0) continue;
        const msg = `Puesto «${row.positionName}»: ${row.assigned} guardias en el grupo pero el ciclo solo necesita ${row.needed} (+${row.excess} de más).`;
        if (!warnings.includes(msg)) warnings.push(msg);
    }

    const idleEmployeeIds = stats.idleEmployeeIds?.length
        ? stats.idleEmployeeIds
        : buildSurplusEmployeePool(
            stats,
            employees.map((e) => e.id),
            ctx.positions,
            ctx.autoCycles?.[0] ?? '6+2',
            base.plantillaTotal,
            {
                defaultShiftByEmp: ctx.defaultShiftByEmp,
                defaultPositionByEmp: ctx.defaultPositionByEmp,
                absences: ctx.absences,
            },
        );
    if (idleEmployeeIds.length > 0) {
        const names = idleEmployeeIds.map((id) => employeeName(employees, id)).join(', ');
        const msg = `${idleEmployeeIds.length} guardia(s) sobrante(s) en RET/Franco (sin turnos facturables): ${names}.`;
        if (!warnings.some((w) => w.includes('sobrante(s) en RET/Franco'))) warnings.push(msg);
    }

    const retIds = stats.retDesignateEmpIds ?? [];
    const retDesigneeId = retIds[0] ?? pickRetDesignee(ctx, stats, assignments);
    const retDesigneeNombre = retDesigneeId ? employeeName(employees, retDesigneeId) : undefined;
    if (retIds.length > 0) {
        const names = retIds.map((id) => employeeName(employees, id)).join(', ');
        const msg = `Pool RET stand-by (${retIds.length}): ${names}.`;
        if (!warnings.some((w) => w.includes('Pool RET stand-by'))) warnings.push(msg);
    }

    const hasSurplus = base.hasSurplus
        || excessByPosition.some((r) => r.excess > 0)
        || idleEmployeeIds.length > 0;

    return {
        ...base,
        excessByPosition,
        idleEmployeeIds,
        retDesigneeId,
        retDesigneeNombre,
        warnings,
        hasSurplus,
    };
}
