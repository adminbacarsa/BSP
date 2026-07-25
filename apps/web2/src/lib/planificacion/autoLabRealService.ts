import { getDocs } from 'firebase/firestore';
import type { V2EmployeeDef, V2PositionDef } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition } from './autoLabCaseCatalog';
import type { PlanningCatalogObjective } from '@/hooks/useObjectivePlanningCatalog';
import type { ServiceSLA } from '@/services/slaService';
import {
    empresaScopedQuery,
    filterRowsByEmpresa,
    shouldScopeQueriesToEmpresa,
} from '@/lib/multiempresa';
import {
    buildPlanningPositionStructure,
    filterSlasForPlanningContext,
    pickSlaForPlanningMonth,
    planningMonthHasActiveSla,
    type PlanningPositionRow,
} from '@/lib/slaPlanningMatch';
import { calculateSlaHoursForVigencia } from './autoLabServicePeriod';
import { computeDailyStaffingModel } from './autoPlanningBrain';
import { fetchPlanningMonthAbsences, fetchPlanningMonthShifts } from './loadPlanningMonthShifts';
import type { PlanningAbsenceRecord } from './planningCoverageWisdom';

export const AUTO_LAB_REAL_CASE_ID = 'case-real-service';

export interface AutoLabRealServiceBundle {
    caseDef: AutoLabCaseDefinition;
    employees: V2EmployeeDef[];
    objectiveId: string;
    objectiveName: string;
    clientId: string;
    clientName: string;
    warnings: string[];
    employeeSource: 'dotacion' | 'turnos' | 'mixed';
    slaLabel: string;
    absencesRrhh: PlanningAbsenceRecord[];
}

function planningRowToV2Position(row: PlanningPositionRow): V2PositionDef {
    const cov = String(row.coverageType || '').toLowerCase();
    const is24 = cov === '24hs' || cov === '24' || cov === '24h';
    const shifts = (row.shifts || []).map((s) => ({
        code: String(s.code || '').toUpperCase(),
        name: String(s.name || s.code || ''),
        hours: Number(s.hours) || 8,
    }));
    return {
        positionName: row.positionName,
        qty: Math.max(1, Number(row.qty) || 1),
        coverageType: is24 ? '24hs' : 'custom',
        shifts: shifts.length > 0 ? shifts : [
            { code: 'M', name: 'Mañana', hours: 8 },
            { code: 'T', name: 'Tarde', hours: 8 },
            { code: 'N', name: 'Noche', hours: 8 },
        ],
        activeDays: row.activeDays?.length ? [...row.activeDays] : ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        excludedDates: row.excludedDates?.length ? [...row.excludedDates] : undefined,
    };
}

function employeeDisplayName(data: Record<string, unknown>, id: string): string {
    const parts = [
        data.nombre,
        data.name,
        data.apellidoNombre,
        data.displayName,
    ].map((v) => String(v || '').trim()).filter(Boolean);
    if (parts.length > 0) return parts[0];
    const legajo = String(data.legajo || '').trim();
    return legajo ? `Legajo ${legajo}` : id;
}

function isActiveEmployee(data: Record<string, unknown>): boolean {
    const st = String(data.status || '').toLowerCase();
    return st !== 'inactive' && st !== 'inactivo';
}

function employeeBelongsToObjective(
    data: Record<string, unknown>,
    objectiveId: string,
    rosterFromTurnos: Set<string>,
): boolean {
    const id = String(data.id || '');
    if (rosterFromTurnos.has(id)) return true;
    if (String(data.preferredObjectiveId || '') === objectiveId) return true;
    const dot = data.planificacionDotacion as Record<string, unknown> | undefined;
    if (dot && Object.prototype.hasOwnProperty.call(dot, objectiveId)) return true;
    return false;
}

export async function loadAutoLabRealServiceBundle(params: {
    empresaId: string;
    objective: PlanningCatalogObjective;
    year: number;
    month: number;
    slas: ServiceSLA[];
    clients: Array<{ id: string; name: string; objetivos?: Array<{ id?: string; name?: string }> }>;
    migracionCompleta?: boolean;
}): Promise<AutoLabRealServiceBundle> {
    const { empresaId, objective, year, month, slas, clients, migracionCompleta = true } = params;
    const warnings: string[] = [];

    const matching = filterSlasForPlanningContext(
        slas,
        objective.clientId,
        objective.objectiveId,
        clients,
    );
    const { vigente, hasExactMatch, fallback } = pickSlaForPlanningMonth(matching, year, month - 1);
    const monthHasSla = planningMonthHasActiveSla(matching, year, month - 1);
    const srv = vigente ?? fallback;

    if (!srv) {
        throw new Error(`Sin contrato SLA vigente para ${objective.objectiveName} en ${month}/${year}.`);
    }

    const { structure } = buildPlanningPositionStructure(srv, { monthHasSla, hasExactMatch });
    if (structure.length === 0) {
        warnings.push('El SLA no tiene puestos configurados — se usa estructura mínima M/T/N.');
        structure.push({
            positionName: 'General',
            shifts: [
                { code: 'M', hours: 8 },
                { code: 'T', hours: 8 },
                { code: 'N', hours: 8 },
            ],
            qty: 1,
            activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
            coverageType: '24hs',
        });
    }

    const positions = structure.map(planningRowToV2Position);
    const serviceStart = String(srv.startDate || '').slice(0, 10);
    const serviceEnd = String(srv.endDate || '').slice(0, 10);
    const excludedDates = Array.isArray(srv.excludedDates) ? [...srv.excludedDates] : undefined;

    const turnoCells = await fetchPlanningMonthShifts({
        empresaId,
        objectiveId: objective.objectiveId,
        year,
        month,
    });
    const rosterFromTurnos = new Set(turnoCells.map((c) => c.employeeId));

    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
    const empSnap = await getDocs(empresaScopedQuery('empleados', empresaId, scopeEmpresa));
    const empRows = filterRowsByEmpresa(
        empSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        empresaId,
        scopeEmpresa,
        migracionCompleta,
    );

    const dotacionIds = new Set<string>();
    const turnoOnlyIds = new Set<string>();
    const employees: V2EmployeeDef[] = [];

    for (const row of empRows) {
        if (!isActiveEmployee(row)) continue;
        if (!employeeBelongsToObjective(row, objective.objectiveId, rosterFromTurnos)) continue;
        employees.push({
            id: row.id,
            nombre: employeeDisplayName(row, row.id),
        });
        if (String(row.preferredObjectiveId || '') === objective.objectiveId
            || (row.planificacionDotacion && objective.objectiveId in (row.planificacionDotacion as object))) {
            dotacionIds.add(row.id);
        } else {
            turnoOnlyIds.add(row.id);
        }
    }

    let employeeSource: AutoLabRealServiceBundle['employeeSource'] = 'dotacion';
    if (employees.length === 0) {
        throw new Error(
            `Sin guardias para ${objective.objectiveName}. Asigná preferredObjectiveId en legajos o generá turnos en Planificación.`,
        );
    }
    if (dotacionIds.size === 0 && turnoOnlyIds.size > 0) {
        employeeSource = 'turnos';
        warnings.push('Dotación inferida solo desde turnos del mes (sin preferredObjectiveId en legajos).');
    } else if (dotacionIds.size > 0 && turnoOnlyIds.size > 0) {
        employeeSource = 'mixed';
    }

    if (employees.length < 2 && positions.some((p) => (p.qty || 1) > 1)) {
        warnings.push(`Solo ${employees.length} guardia(s) en dotación real; el motor puede agregar sintéticos para cerrar pax/horas.`);
    }

    const floorHeads = positions.reduce((s, p) => s + Math.max(1, Number(p.qty) || 1), 0);
    const structuralHeads = computeDailyStaffingModel(positions, '6+2', 0).plantillaTotal;
    if (employees.length > structuralHeads) {
        warnings.push(
            `Dotación real (${employees.length}) supera los ${structuralHeads} guardias estructurales del objetivo `
            + `(rotación 24hs + custom según qty). Sobran ${employees.length - structuralHeads}; el excedente va a RET/Franco.`,
        );
    } else if (employees.length > floorHeads) {
        warnings.push(
            `Dotación real (${employees.length}) supera los ${floorHeads} puesto(s) en simultáneo del SLA `
            + `(+${employees.length - floorHeads} legajo(s) de más). El motor los mezclará en rotación o RET/Franco; `
            + `conviene sacarlos del objetivo si no son necesarios.`,
        );
    }

    const absencesRrhh = await fetchPlanningMonthAbsences({
        empresaId,
        year,
        month,
        rosterEmployeeIds: new Set(employees.map((e) => e.id)),
    });

    const absencesByDate = absencesRrhh.map((a) => ({
        empId: a.employeeId,
        dateStr: a.dateStr,
        code: a.code,
    }));

    const absenceInTurnos = turnoCells.filter((c) =>
        ['V', 'L', 'E', 'A', 'PG', 'AA'].includes(String(c.code || '').toUpperCase()),
    ).length;
    if (absenceInTurnos > 0 && absencesByDate.length === 0) {
        warnings.push(`${absenceInTurnos} celda(s) con código de ausencia en turnos — el motor las usará si están en absencesByDate al armar el caso.`);
    }

    let slaVendidas: number;
    if (srv.totalMonthlyHours && srv.totalMonthlyHours > 0) {
        slaVendidas = Math.round(srv.totalMonthlyHours);
    } else if (serviceStart && serviceEnd) {
        slaVendidas = calculateSlaHoursForVigencia(
            positions,
            serviceStart,
            serviceEnd,
            excludedDates,
            year,
            month,
        );
    } else {
        slaVendidas = 0;
    }

    const caseDef: AutoLabCaseDefinition = {
        id: AUTO_LAB_REAL_CASE_ID,
        order: 6,
        title: objective.objectiveName,
        subtitle: `${objective.clientName} · SLA real`,
        description:
            `Servicio real cargado desde Firestore. SLA ${serviceStart || '?'} → ${serviceEnd || '?'}. `
            + `${employees.length} guardia(s), ${positions.length} puesto(s). El motor resuelve igual que casos 1–5 (sin escribir en Firestore).`,
        expectations: [
            'Estructura de puestos y pax desde servicios_sla vigente.',
            'Dotación desde legajos (preferredObjectiveId) + turnos del mes.',
            'Ausencias desde colección ausencias del período.',
            'Comparar grilla generada vs Planificación real para mejorar el motor.',
        ],
        coverageNotes: 'Cobertura post-proceso con RET externo, híbrido pax2 y sabiduría histórica (panel inferior).',
        positions,
        employeeCount: employees.length,
        cycle: '6+2',
        rotationMode: 'rotative',
        rotateShiftsOverride: true,
        slaVendidas: slaVendidas > 0 ? slaVendidas : undefined,
        serviceStartDate: serviceStart || undefined,
        serviceEndDate: serviceEnd || undefined,
        excludedDates,
        absencesByDate: absencesByDate.length > 0 ? absencesByDate : undefined,
    };

    return {
        caseDef,
        employees,
        objectiveId: objective.objectiveId,
        objectiveName: objective.objectiveName,
        clientId: objective.clientId,
        clientName: objective.clientName,
        warnings,
        employeeSource,
        slaLabel: `${serviceStart} → ${serviceEnd}`,
        absencesRrhh,
    };
}
