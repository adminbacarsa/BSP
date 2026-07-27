/**
 * Validación de dotación explícita del planificador (planificacionDotacion / defaultPositionByEmp)
 * contra la estructura SLA. Desajuste = error del planificador; el motor no lo corrige en silencio.
 */

import type { V2EmployeeDef, V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { computePositionRequiredHeadcount } from './objectiveHeadcount';

export interface PlannerDotacionPositionRow {
    positionName: string;
    needed: number;
    assigned: number;
    delta: number;
    employeeIds: string[];
    status: 'ok' | 'over' | 'under';
}

export interface PlannerDotacionValidationReport {
    /** Hay planificacionDotacion / defaultPositionByEmp cargado. */
    explicitDotacion: boolean;
    ok: boolean;
    /** Guardias en legajos sin puesto asignado en dotación. */
    unassignedEmployeeIds: string[];
    /** Guardias asignados a un puesto que no existe en el SLA. */
    invalidPositionEmployeeIds: Array<{ empId: string; positionName: string }>;
    byPosition: PlannerDotacionPositionRow[];
    errors: string[];
    warnings: string[];
}

export function hasExplicitPlannerDotacion(
    defaultPositionByEmp?: Record<string, string>,
): boolean {
    return !!defaultPositionByEmp && Object.keys(defaultPositionByEmp).length > 0;
}

/**
 * Corrobora que la dotación del planificador coincide con el cupo estructural por puesto (ciclo 6+2, etc.).
 */
export function validatePlannerDotacionAgainstSla(params: {
    positions: V2PositionDef[];
    employees: V2EmployeeDef[];
    defaultPositionByEmp?: Record<string, string>;
    cycleKey?: string;
}): PlannerDotacionValidationReport {
    const { positions, employees, defaultPositionByEmp, cycleKey = '6+2' } = params;
    const explicitDotacion = hasExplicitPlannerDotacion(defaultPositionByEmp);

    const errors: string[] = [];
    const warnings: string[] = [];
    const unassignedEmployeeIds: string[] = [];
    const invalidPositionEmployeeIds: Array<{ empId: string; positionName: string }> = [];

    if (!explicitDotacion) {
        return {
            explicitDotacion: false,
            ok: true,
            unassignedEmployeeIds: employees.map((e) => e.id),
            invalidPositionEmployeeIds: [],
            byPosition: positions.map((pos) => ({
                positionName: pos.positionName,
                needed: computePositionRequiredHeadcount(pos, cycleKey),
                assigned: 0,
                delta: -computePositionRequiredHeadcount(pos, cycleKey),
                employeeIds: [],
                status: 'under' as const,
            })),
            errors,
            warnings: [
                'Sin dotación explícita por puesto — el motor reparte virtualmente. '
                + 'Asigná planificacionDotacion en legajos para validar contra el SLA.',
            ],
        };
    }

    const posNames = new Set(positions.map((p) => p.positionName));
    const assignedByPos: Record<string, string[]> = {};
    for (const pos of positions) assignedByPos[pos.positionName] = [];

    for (const emp of employees) {
        const posName = defaultPositionByEmp![emp.id];
        if (!posName) {
            unassignedEmployeeIds.push(emp.id);
            continue;
        }
        if (!posNames.has(posName)) {
            invalidPositionEmployeeIds.push({ empId: emp.id, positionName: posName });
            continue;
        }
        assignedByPos[posName].push(emp.id);
    }

    const byPosition: PlannerDotacionPositionRow[] = positions.map((pos) => {
        const needed = computePositionRequiredHeadcount(pos, cycleKey);
        const employeeIds = assignedByPos[pos.positionName] || [];
        const assigned = employeeIds.length;
        const delta = assigned - needed;
        let status: PlannerDotacionPositionRow['status'] = 'ok';
        if (delta > 0) status = 'over';
        else if (delta < 0) status = 'under';
        return { positionName: pos.positionName, needed, assigned, delta, employeeIds, status };
    });

    for (const row of byPosition) {
        if (row.status === 'over') {
            errors.push(
                `Puesto «${row.positionName}»: ${row.assigned} guardia(s) en dotación del planificador `
                + `pero el SLA/ciclo ${cycleKey} requiere ${row.needed} (+${row.delta} de más). `
                + `Corregí planificacionDotacion en legajos.`,
            );
        } else if (row.status === 'under') {
            errors.push(
                `Puesto «${row.positionName}»: faltan ${-row.delta} guardia(s) en dotación `
                + `(${row.assigned}/${row.needed} según ciclo ${cycleKey}).`,
            );
        }
    }

    if (unassignedEmployeeIds.length > 0) {
        warnings.push(
            `${unassignedEmployeeIds.length} guardia(s) del objetivo sin puesto en planificacionDotacion `
            + `(quedarán ociosos / RET si sobra dotación total).`,
        );
    }

    for (const inv of invalidPositionEmployeeIds) {
        errors.push(
            `Guardia asignado a puesto «${inv.positionName}» que no existe en el SLA del objetivo.`,
        );
    }

    const totalAssigned = Object.values(assignedByPos).reduce((s, g) => s + g.length, 0);
    const totalNeeded = byPosition.reduce((s, r) => s + r.needed, 0);
    if (totalAssigned > totalNeeded) {
        warnings.push(
            `Dotación total en legajos (${totalAssigned}) supera plantilla estructural (${totalNeeded}). `
            + `El excedente no debe recibir turnos facturables; queda en RET/Franco según ciclo CCT.`,
        );
    }

    return {
        explicitDotacion: true,
        ok: errors.length === 0,
        unassignedEmployeeIds,
        invalidPositionEmployeeIds,
        byPosition,
        errors,
        warnings,
    };
}

export function dotacionValidationSummaryEs(report: PlannerDotacionValidationReport): string {
    if (!report.explicitDotacion) return 'Sin dotación explícita por puesto.';
    if (report.ok) return 'Dotación del planificador coherente con el SLA.';
    return report.errors[0] || 'Dotación del planificador inconsistente con el SLA.';
}
