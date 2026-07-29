import { getDocs } from 'firebase/firestore';
import type { V2EmployeeDef, V2PositionDef, V2ShiftDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition, is24hsRotationPosition } from './autoScheduleEngineV2';
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
    resolvePlanningMonthSlaHours,
    type PlanningPositionRow,
} from '@/lib/slaPlanningMatch';
import { customCoverSimultaneousPax } from './customCoverCycle';
import { computeObjectiveRequiredHeadcount } from './objectiveHeadcount';
import { fetchPlanningMonthAbsences, fetchPlanningMonthShifts } from './loadPlanningMonthShifts';
import {
    DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
    fetchCoverageWisdomHistory,
} from './fetchPlanningCoverageWisdomHistory';
import {
    validatePlannerDotacionAgainstSla,
    dotacionValidationSummaryEs,
} from './plannerDotacionValidator';
import type { PlanningCoverageWisdom } from './planningCoverageWisdom';
import { computeObjectiveHeadcountBalance } from './rosterHeadcountBalance';

export const AUTO_LAB_REAL_CASE_ID = 'case-real-service';

function buildPositionAssignmentsByEmp(
    assignments?: import('@/services/slaService').PositionAssignment[],
): Record<string, Array<{ positionName: string; shiftCodes: string[] }>> | undefined {
    if (!assignments?.length) return undefined;
    const result: Record<string, Array<{ positionName: string; shiftCodes: string[] }>> = {};
    for (const a of assignments) {
        if (a.slots?.length) result[a.employeeId] = a.slots;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

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
    coverageWisdom?: PlanningCoverageWisdom | null;
}

function planningRowToV2Position(row: PlanningPositionRow): V2PositionDef {
    const shifts: V2ShiftDef[] = (row.shifts || []).map((s) => {
        const mapped: V2ShiftDef = {
            code: String(s.code || '').toUpperCase(),
            name: String(s.name || s.code || ''),
            hours: Number(s.hours) || 8,
        };
        if (s.startTime) mapped.startTime = String(s.startTime);
        if (s.endTime) mapped.endTime = String(s.endTime);
        if (Array.isArray((s as any).blocks) && (s as any).blocks.length >= 2) {
            mapped.blocks = (s as any).blocks.map((b: any) => ({ startTime: String(b.startTime), endTime: String(b.endTime) }));
        }
        if (Array.isArray(s.days) && s.days.length > 0) mapped.days = [...s.days];
        if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
            mapped.specificDates = [...s.specificDates];
        }
        return mapped;
    });
    const provisional: V2PositionDef = {
        positionName: row.positionName,
        qty: Math.max(1, Number(row.qty) || 1),
        coverageType: String(row.coverageType || ''),
        shifts: shifts.length > 0 ? shifts : [
            { code: 'M', name: 'Mañana', hours: 8 },
            { code: 'T', name: 'Tarde', hours: 8 },
            { code: 'N', name: 'Noche', hours: 8 },
        ],
        activeDays: row.activeDays?.length ? [...row.activeDays] : ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        excludedDates: row.excludedDates?.length ? [...row.excludedDates] : undefined,
    };
    const is24 = is24hsRotationPosition(provisional);
    return {
        ...provisional,
        coverageType: is24 ? '24hs' : 'custom',
        activeDays: is24
            ? ['L', 'M', 'X', 'J', 'V', 'S', 'D']
            : provisional.activeDays,
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

    const defaultPositionByEmp: Record<string, string> = {};
    const defaultShiftByEmp: Record<string, string> = {};
    const dotacionIds = new Set<string>();
    const turnoOnlyIds = new Set<string>();
    const employees: V2EmployeeDef[] = [];

    for (const row of empRows) {
        if (!isActiveEmployee(row)) continue;
        if (!employeeBelongsToObjective(row, objective.objectiveId, rosterFromTurnos)) continue;
        employees.push({
            id: row.id,
            nombre: employeeDisplayName(row, row.id),
            preferredObjectiveId: String(row.preferredObjectiveId || objective.objectiveId),
            volante: Array.isArray(row.volante)
                ? (row.volante as string[]).map(String)
                : undefined,
        });
        const dot = row.planificacionDotacion as Record<
            string,
            { positionName?: string; shiftCode?: string }
        > | undefined;
        const cfg = dot?.[objective.objectiveId];
        if (cfg?.positionName) {
            defaultPositionByEmp[row.id] = String(cfg.positionName);
        }
        if (cfg?.shiftCode) {
            defaultShiftByEmp[row.id] = String(cfg.shiftCode).toUpperCase();
        }
        if (String(row.preferredObjectiveId || '') === objective.objectiveId
            || (row.planificacionDotacion && objective.objectiveId in (row.planificacionDotacion as object))) {
            dotacionIds.add(row.id);
        } else {
            turnoOnlyIds.add(row.id);
        }
    }

    for (const row of empRows) {
        if (!isActiveEmployee(row)) continue;
        const volanteList = Array.isArray(row.volante) ? (row.volante as string[]).map(String) : [];
        if (!volanteList.includes(objective.objectiveId)) continue;
        if (employees.some((e) => e.id === row.id)) continue;
        employees.push({
            id: row.id,
            nombre: employeeDisplayName(row, row.id),
            preferredObjectiveId: String(row.preferredObjectiveId || ''),
            volante: volanteList,
        });
        warnings.push(
            `Volante ${employeeDisplayName(row, row.id)} agregado para cobertura custom/RET en este objetivo.`,
        );
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

    const dotacionCount = Object.keys(defaultPositionByEmp).length;
    const dotacionValidation = validatePlannerDotacionAgainstSla({
        positions,
        employees,
        defaultPositionByEmp: dotacionCount > 0 ? defaultPositionByEmp : undefined,
        cycleKey: '6+2',
    });
    if (dotacionCount > 0) {
        warnings.push(`Dotación por puesto desde legajos: ${dotacionCount} guardia(s) con planificacionDotacion.`);
        warnings.push(dotacionValidationSummaryEs(dotacionValidation));
        warnings.push(...dotacionValidation.errors);
        warnings.push(...dotacionValidation.warnings);
    } else {
        warnings.push(
            'Sin planificacionDotacion en legajos — el motor reparte guardias por orden de puesto (Puesto 1 → Museo → …). '
            + 'Para igualar Planificación, asigná puesto en RRHH o en la grilla.',
        );
    }

    const structuralHeads = computeObjectiveRequiredHeadcount(positions, '6+2');
    const headcountBalance = computeObjectiveHeadcountBalance({
        positions,
        employees,
        cycleKey: '6+2',
    });
    warnings.push(...headcountBalance.messages);
    const simultaneousNeed = positions.reduce((s, p) => {
        if (isCustomCoverPosition(p)) return s + customCoverSimultaneousPax(p);
        return s + Math.max(1, Number(p.qty) || 1);
    }, 0);
    if (employees.length > structuralHeads) {
        warnings.push(
            `Dotación real (${employees.length}) supera los ${structuralHeads} guardias estructurales del objetivo `
            + `(rotación 24hs + custom según bandas/qty). Sobran ${employees.length - structuralHeads}; el excedente va a RET/Franco.`,
        );
    } else if (
        positions.some(isCustomCoverPosition)
        && employees.length > simultaneousNeed
    ) {
        warnings.push(
            `Dotación real (${employees.length}) supera los ${simultaneousNeed} puesto(s)/banda(s) en simultáneo del SLA custom `
            + `(+${employees.length - simultaneousNeed} legajo(s) de más). Revisá bandas (ej. M + M2) o quitá legajos del objetivo.`,
        );
    }

    const absencesRrhh = await fetchPlanningMonthAbsences({
        empresaId,
        year,
        month,
        rosterEmployeeIds: new Set(employees.map((e) => e.id)),
    });

    let coverageWisdom: PlanningCoverageWisdom | null = null;
    try {
        const empNames: Record<string, string> = {};
        employees.forEach((e) => { empNames[e.id] = e.nombre || e.id; });
        coverageWisdom = await fetchCoverageWisdomHistory({
            empresaId,
            objectiveId: objective.objectiveId,
            year,
            month,
            lookbackMonths: DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
            scopeEmpresa,
            migracionCompleta,
            employeeNames: empNames,
            rosterEmployeeIds: new Set(employees.map((e) => e.id)),
        });
        if (coverageWisdom.cellsAnalyzed > 0 || coverageWisdom.events.length > 0) {
            warnings.push(`Historial ${coverageWisdom.periodLabel}: ${coverageWisdom.summary}`);
        }
    } catch (wisdomErr) {
        warnings.push('Sin historial de coberturas (error al leer turnos previos).');
        console.warn('[autoLab] fetchCoverageWisdomHistory', wisdomErr);
    }

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

    let slaVendidas = 0;
    if (serviceStart && serviceEnd) {
        slaVendidas = resolvePlanningMonthSlaHours(srv, year, month - 1);
    }
    if (slaVendidas <= 0 && srv.totalMonthlyHours && srv.totalMonthlyHours > 0) {
        slaVendidas = Math.round(srv.totalMonthlyHours);
        warnings.push(
            `SLA vendidas: sin desglose para ${year}-${String(month).padStart(2, '0')}; se usa totalMonthlyHours (${slaVendidas} h).`,
        );
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
        rotateShiftsOverride: (() => {
            const has24 = positions.some(is24hsRotationPosition);
            if (!has24) return false;
            // Objetivo con 24hs: motor ciclo 24d (fixedBandFloater), no péndulo demand-driven.
            return false;
        })(),
        slaVendidas: slaVendidas > 0 ? slaVendidas : undefined,
        serviceStartDate: serviceStart || undefined,
        serviceEndDate: serviceEnd || undefined,
        excludedDates,
        defaultPositionByEmp: dotacionCount > 0 ? defaultPositionByEmp : undefined,
        defaultShiftByEmp: Object.keys(defaultShiftByEmp).length > 0 ? defaultShiftByEmp : undefined,
        absencesByDate: absencesByDate.length > 0 ? absencesByDate : undefined,
        coverageWisdom,
        positionAssignmentsByEmp: buildPositionAssignmentsByEmp(srv.positionAssignments),
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
        coverageWisdom,
    };
}
