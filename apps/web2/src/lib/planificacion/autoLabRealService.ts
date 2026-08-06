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
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { normalizeCoverageTypeFromSla, summarizeObjectiveCoverage, type ObjectiveCoverageSummary } from './positionCoverageKind';
import { customCoverSimultaneousPax } from './customCoverCycle';
import { computeObjectiveRequiredHeadcount } from './objectiveHeadcount';
import { fetchPlanningMonthAbsences, fetchPlanningMonthShifts, previousCalendarMonth } from './loadPlanningMonthShifts';
import {
    buildShiftTrailByEmpFromCells,
    computePrevMonthCycleTrailing,
    defaultCalendarDateKey,
} from './prevMonthCycleTrailing';
import {
    DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
    fetchCoverageWisdomHistory,
} from './fetchPlanningCoverageWisdomHistory';
import { inferPlannerDotacionFromWisdom } from './planningCoverageWisdom';
import {
    validatePlannerDotacionAgainstSla,
    dotacionValidationSummaryEs,
} from './plannerDotacionValidator';
import type { PlanningCoverageWisdom } from './planningCoverageWisdom';
import { applySlaContractDotacion, assessSlaContractReadiness, buildPositionAssignmentsByEmp } from './slaContractPlanning';
import { cronogramSlaRuleWarnings, resolveCronogramPlanningRules } from './cronogramPlanningRules';
import {
    extractPoolCycleAnchorsFromRotations,
    resolvePoolCycleStartDate,
} from './poolCycleBootstrap';
import { computeObjectiveHeadcountBalance } from './rosterHeadcountBalance';

export const AUTO_LAB_REAL_CASE_ID = 'case-real-service';

function explicitCoverageTypeFromRow(raw: string | undefined): '24hs' | 'custom' | null {
    const cov = String(raw || '').toLowerCase().trim();
    if (cov === '24hs' || cov === '24' || cov === '24h') return '24hs';
    if (cov === 'custom') return 'custom';
    return null;
}

export type AutoLabSlaOptionalFeatureState = 'off' | 'active' | 'on_empty';

export interface AutoLabSlaContractSummary {
    coberturaDotacion: AutoLabSlaOptionalFeatureState;
    coberturaGuardiasConfigurados: number;
    condiciones: AutoLabSlaOptionalFeatureState;
    condicionesCount: number;
    rotaciones: AutoLabSlaOptionalFeatureState;
    rotacionesCount: number;
}

function resolveOptionalSlaFeature<T>(
    field: T[] | undefined,
): { state: AutoLabSlaOptionalFeatureState; count: number } {
    if (field === undefined) return { state: 'off', count: 0 };
    if (field.length === 0) return { state: 'on_empty', count: 0 };
    return { state: 'active', count: field.length };
}

function buildSlaContractSummary(srv: ServiceSLA): AutoLabSlaContractSummary {
    const coberturaGuardias = (srv.positionAssignments ?? []).filter((a) => (a.slots?.length ?? 0) > 0).length;
    let coberturaDotacion: AutoLabSlaOptionalFeatureState = 'off';
    if (srv.positionAssignments !== undefined) {
        coberturaDotacion = coberturaGuardias > 0 ? 'active' : 'on_empty';
    }
    const rules = resolveOptionalSlaFeature(srv.serviceRules);
    const rotations = resolveOptionalSlaFeature(srv.serviceRotations);
    return {
        coberturaDotacion,
        coberturaGuardiasConfigurados: coberturaGuardias,
        condiciones: rules.state,
        condicionesCount: rules.count,
        rotaciones: rotations.state,
        rotacionesCount: rotations.count,
    };
}

function pushSlaContractWarnings(summary: AutoLabSlaContractSummary, warnings: string[]): void {
    if (summary.coberturaDotacion === 'off') {
        warnings.push(
            'Cobertura de dotación no activada en el SLA (Servicios → Activar cobertura). El motor no restringe puestos/bandas por legajo.',
        );
    } else if (summary.coberturaDotacion === 'on_empty') {
        warnings.push(
            'Cobertura de dotación activada pero sin guardias configurados — todos los legajos quedan sin restricción de puesto/banda.',
        );
    }
    if (summary.condiciones === 'on_empty') {
        warnings.push('Condiciones SLA activadas pero sin reglas cargadas.');
    }
    if (summary.rotaciones === 'on_empty') {
        warnings.push('Rotaciones SLA activadas pero sin ciclos cargados.');
    }
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
    slaContract: AutoLabSlaContractSummary;
    coverageSummary: ObjectiveCoverageSummary;
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
        coverageType: normalizeCoverageTypeFromSla(
            String(row.coverageType || ''),
            (row.shifts || []) as Array<{ code?: string }>,
        ),
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
        coverageType: explicitCoverageTypeFromRow(row.coverageType) ?? provisional.coverageType,
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
    const servicePartition = buildObjectiveScheduleProfile(positions);
    warnings.push(...servicePartition.labels);
    const positionAssignmentsByEmp = buildPositionAssignmentsByEmp(srv.positionAssignments);
    const coverageSummary = summarizeObjectiveCoverage(positions, { positionAssignmentsByEmp });
    warnings.push(...coverageSummary.warnings);
    if (coverageSummary.allCustomPool) {
        warnings.push(coverageSummary.motorLabel);
    } else if (coverageSummary.has24hsRotation) {
        warnings.push(coverageSummary.motorLabel);
    }
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

    if (srv.positionAssignments?.length) {
        warnings.push(
            `Cobertura de dotación (SLA): ${srv.positionAssignments.length} guardia(s) con puestos/bandas permitidos.`,
        );
    }
    const slaContract = buildSlaContractSummary(srv);
    pushSlaContractWarnings(slaContract, warnings);
    if (srv.serviceRules?.length) {
        warnings.push(`Condiciones SLA: ${srv.serviceRules.length} regla(s) activas en este contrato.`);
    }
    if (srv.serviceRotations?.length) {
        warnings.push(`Rotaciones SLA: ${srv.serviceRotations.length} ciclo(s) activos en este contrato.`);
    }

    if (employees.length < 2 && positions.some((p) => (p.qty || 1) > 1)) {
        warnings.push(`Solo ${employees.length} guardia(s) en dotación real; el motor puede agregar sintéticos para cerrar pax/horas.`);
    }

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
        const inferred = inferPlannerDotacionFromWisdom(
            coverageWisdom,
            employees.map((e) => e.id),
        );
        let fromHistory = 0;
        for (const [empId, posName] of Object.entries(inferred.defaultPositionByEmp)) {
            if (defaultPositionByEmp[empId]) continue;
            defaultPositionByEmp[empId] = posName;
            fromHistory += 1;
        }
        for (const [empId, band] of Object.entries(inferred.defaultShiftByEmp)) {
            if (defaultShiftByEmp[empId]) continue;
            defaultShiftByEmp[empId] = band;
        }
        if (fromHistory > 0) {
            warnings.push(
                `Dotación inferida desde cronogramas previos (${fromHistory} guardia(s); meses en historial de cobertura).`,
            );
        }
        if (coverageWisdom.cellsAnalyzed > 0 || coverageWisdom.events.length > 0) {
            warnings.push(`Historial ${coverageWisdom.periodLabel}: ${coverageWisdom.summary}`);
        }
    } catch (wisdomErr) {
        warnings.push('Sin historial de coberturas (error al leer turnos previos).');
        console.warn('[autoLab] fetchCoverageWisdomHistory', wisdomErr);
    }

    const monthDateStrs = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => {
        const d = i + 1;
        return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    });
    const slaReadiness = assessSlaContractReadiness({
        positionAssignments: srv.positionAssignments,
        serviceRules: srv.serviceRules,
        serviceRotations: srv.serviceRotations,
        dateStrs: monthDateStrs,
    });
    const cronoRules = resolveCronogramPlanningRules(positions);
    warnings.push(...cronogramSlaRuleWarnings(cronoRules, slaReadiness));

    const slaDot = applySlaContractDotacion({
        positionAssignments: srv.positionAssignments,
        defaultPositionByEmp,
        defaultShiftByEmp,
    });
    if (slaDot.fromSlaCobertura > 0 || slaDot.fromSlaShift > 0) {
        warnings.push(
            `Dotación desde Cobertura SLA: ${slaDot.fromSlaCobertura} puesto(s) y ${slaDot.fromSlaShift} banda(s) primarias.`,
        );
    }

    const dotacionCount = Object.keys(defaultPositionByEmp).length;
    const dotacionValidation = validatePlannerDotacionAgainstSla({
        positions,
        employees,
        defaultPositionByEmp: dotacionCount > 0 ? defaultPositionByEmp : undefined,
        cycleKey: '6+2',
    });
    if (dotacionCount > 0) {
        warnings.push(`Dotación por puesto (legajos y/o cronogramas previos): ${dotacionCount} guardia(s).`);
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

    let prevMonthTrailingWorkDays: Record<string, number> | undefined;
    let prevMonthTrailingRestDays: Record<string, number> | undefined;
    let prevMonthLastShiftByEmp: Record<string, string> | undefined;
    let prevMonthLastWorkBandBeforeRest: Record<string, string> | undefined;
    try {
        const { year: prevY, month: prevM } = previousCalendarMonth(year, month);
        const prevTrailCells = await fetchPlanningMonthShifts({
            empresaId,
            objectiveId: objective.objectiveId,
            year: prevY,
            month: prevM,
            scopeEmpresa,
            migracionCompleta,
        });
        const prevMonthEndDate = new Date(year, month - 1, 0);
        const prevTrailByEmp = buildShiftTrailByEmpFromCells(prevTrailCells, objective.objectiveId);
        const trailing = computePrevMonthCycleTrailing({
            employeeIds: employees.map((e) => e.id),
            prevTrailByEmp,
            prevMonthEndDate,
            getDateKey: defaultCalendarDateKey,
        });
        if (
            Object.keys(trailing.prevMonthTrailingWorkDays).length > 0
            || Object.keys(trailing.prevMonthTrailingRestDays).length > 0
        ) {
            prevMonthTrailingWorkDays = trailing.prevMonthTrailingWorkDays;
            prevMonthTrailingRestDays = trailing.prevMonthTrailingRestDays;
            prevMonthLastShiftByEmp = trailing.prevMonthLastShiftByEmp;
            prevMonthLastWorkBandBeforeRest = trailing.prevMonthLastWorkBandBeforeRest;
            warnings.push(
                `Ciclo: semilla desde ${prevM}/${prevY} publicado (${new Set([
                    ...Object.keys(trailing.prevMonthTrailingWorkDays),
                    ...Object.keys(trailing.prevMonthTrailingRestDays),
                ]).size} legajo(s) con racha al cierre).`,
            );
        }
    } catch {
        warnings.push('No se pudo leer turnos del mes anterior para semilla de ciclo — offsets distribuidos.');
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

    const monthFirstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const poolCycleStartDate = resolvePoolCycleStartDate(
        srv.serviceRotations,
        serviceStart || monthFirstDay,
        monthFirstDay,
    );
    const poolCycleAnchorByEmp = extractPoolCycleAnchorsFromRotations(srv.serviceRotations);

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
        rotationMode: positions.some(is24hsRotationPosition) ? 'rotative' : 'fixed',
        rotateShiftsOverride: false,
        slaVendidas: slaVendidas > 0 ? slaVendidas : undefined,
        serviceStartDate: serviceStart || undefined,
        serviceEndDate: serviceEnd || undefined,
        excludedDates,
        defaultPositionByEmp: dotacionCount > 0 ? defaultPositionByEmp : undefined,
        defaultShiftByEmp: Object.keys(defaultShiftByEmp).length > 0 ? defaultShiftByEmp : undefined,
        absencesByDate: absencesByDate.length > 0 ? absencesByDate : undefined,
        coverageWisdom,
        positionAssignmentsByEmp: buildPositionAssignmentsByEmp(srv.positionAssignments),
        serviceRules: srv.serviceRules?.length ? srv.serviceRules : undefined,
        serviceRotations: srv.serviceRotations?.length ? srv.serviceRotations : undefined,
        ...(prevMonthTrailingWorkDays || prevMonthTrailingRestDays
            ? {
                prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays,
                prevMonthLastShiftByEmp,
                prevMonthLastWorkBandBeforeRest,
            }
            : {}),
        poolCycleStartDate,
        ...(Object.keys(poolCycleAnchorByEmp).length > 0
            ? { poolCycleAnchorByEmp }
            : {}),
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
        slaContract,
        coverageSummary,
    };
}
