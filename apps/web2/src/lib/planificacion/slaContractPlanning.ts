/**
 * Contrato SLA operativo para planificación automática:
 * - Cobertura de dotación (`positionAssignments`): quién puede qué puesto/banda.
 * - Condiciones (`serviceRules`): IF→THEN por día (post-proceso + exclusiones de demanda).
 * - Rotaciones (`serviceRotations`): puesto/banda esperados por fecha (prioridad sobre péndulo motor).
 *
 * Sin leer estos tres bloques, un objetivo custom (Shopping) no puede replicar el cronograma manual.
 */

import type { PositionAssignment, ServiceRotation, ServiceRule } from '@/services/slaService';
import { getRotationEntriesForDate } from './rotationUtils';
import { applyRotationsForMonth, rotationAdditionsToSlaRotationByDate } from './slaRotationMonthPlanner';
import { empCanCoverPositionShift } from './positionAssignmentPolicy';
import type { V2EngineContext } from './autoScheduleEngineV2';

export interface SlaRotationCell {
    positionName: string;
    shiftCode: string;
}

export type SlaRotationByDate = Record<string, Record<string, SlaRotationCell>>;

export interface ApplySlaDotacionResult {
    fromSlaCobertura: number;
    fromSlaShift: number;
}

export function buildPositionAssignmentsByEmp(
    positionAssignments?: PositionAssignment[] | null,
): Record<string, Array<{ positionName: string; shiftCodes: string[] }>> | undefined {
    if (!positionAssignments?.length) return undefined;
    const result: Record<string, Array<{ positionName: string; shiftCodes: string[] }>> = {};
    for (const row of positionAssignments) {
        const empId = String(row.employeeId || '').trim();
        if (!empId) continue;
        // Vacío = «Sin restricciones» en Servicios (cualquier puesto/banda del SLA).
        result[empId] = row.slots?.length
            ? row.slots.map((s) => ({
                positionName: String(s.positionName || '').trim(),
                shiftCodes: (s.shiftCodes ?? []).map((c) => String(c).toUpperCase()),
            }))
            : [];
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizePositionNameKey(name: string): string {
    return String(name || '').trim().toLowerCase();
}

export function slotsAllowPosition(
    slots: Array<{ positionName: string; shiftCodes: string[] }> | undefined,
    positionName: string,
): boolean {
    if (!slots?.length) return true;
    const key = normalizePositionNameKey(positionName);
    return slots.some((s) => normalizePositionNameKey(s.positionName) === key);
}

function primaryFromSlots(slots: PositionAssignment['slots']): { positionName: string; shiftCode?: string } | null {
    const slot = slots?.find((s) => String(s.positionName || '').trim());
    if (!slot) return null;
    const positionName = String(slot.positionName).trim();
    const shiftCode = slot.shiftCodes?.length
        ? String(slot.shiftCodes[0]).toUpperCase()
        : undefined;
    return { positionName, shiftCode };
}

/**
 * Completa defaultPositionByEmp / defaultShiftByEmp desde Servicios → Cobertura de dotación.
 * No pisa entradas ya definidas (RRHH, grilla publicada, wisdom previo).
 */
export function applySlaContractDotacion(params: {
    positionAssignments?: PositionAssignment[] | null;
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
}): ApplySlaDotacionResult {
    const { positionAssignments, defaultPositionByEmp, defaultShiftByEmp } = params;
    let fromSlaCobertura = 0;
    let fromSlaShift = 0;
    if (!positionAssignments?.length) {
        return { fromSlaCobertura, fromSlaShift };
    }
    for (const row of positionAssignments) {
        const empId = row.employeeId;
        if (!empId || !row.slots?.length) continue;
        const primary = primaryFromSlots(row.slots);
        if (!primary) continue;
        if (!defaultPositionByEmp[empId]) {
            defaultPositionByEmp[empId] = primary.positionName;
            fromSlaCobertura += 1;
        }
        if (primary.shiftCode && !defaultShiftByEmp[empId]) {
            defaultShiftByEmp[empId] = primary.shiftCode;
            fromSlaShift += 1;
        }
    }
    return { fromSlaCobertura, fromSlaShift };
}

/**
 * Puesto fijo en roster: grilla planificador o un solo slot SLA (ej. Galli/Miranda solo Control).
 * Multi-slot (Varas) o sin restricciones (Pozas) no bloquean el roster a un puesto.
 */
export function resolveRosterLockedPositions(params: {
    plannerGridPositionByEmp?: Record<string, string>;
    positionAssignmentsByEmp?: Record<string, Array<{ positionName: string; shiftCodes: string[] }>>;
}): Record<string, string> {
    const locked: Record<string, string> = {};
    for (const [empId, pos] of Object.entries(params.plannerGridPositionByEmp ?? {})) {
        const p = String(pos || '').trim();
        if (p) locked[empId] = p;
    }
    for (const [empId, slots] of Object.entries(params.positionAssignmentsByEmp ?? {})) {
        if (locked[empId]) continue;
        if (slots.length === 1 && slots[0].positionName) {
            locked[empId] = slots[0].positionName;
        }
    }
    return locked;
}
export function buildSlaRotationByDate(
    rotations: ServiceRotation[] | undefined | null,
    dateStrs: string[],
    positionStructure?: unknown[],
): SlaRotationByDate | undefined {
    if (!rotations?.length || dateStrs.length === 0) return undefined;
    const first = dateStrs[0];
    const [y, m] = first.split('-').map(Number);
    const additions = applyRotationsForMonth(rotations, {}, {}, y, m - 1, positionStructure);
    const fromPlanner = rotationAdditionsToSlaRotationByDate(additions, dateStrs);
    if (fromPlanner) return fromPlanner;
    const out: SlaRotationByDate = {};
    for (const dateStr of dateStrs) {
        for (const rotation of rotations) {
            const entries = getRotationEntriesForDate(rotation, dateStr);
            if (!entries.length) continue;
            if (!out[dateStr]) out[dateStr] = {};
            for (const entry of entries) {
                const empId = entry.employeeId;
                if (!empId) continue;
                out[dateStr][empId] = {
                    positionName: String(entry.positionName || '').trim(),
                    shiftCode: String(entry.shiftCode || '').toUpperCase(),
                };
            }
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** Códigos de trabajo excluidos por reglas EXCLUDE en un día (antes de asignar). */
export function buildSlaExcludedSlotsByDate(
    rules: ServiceRule[] | undefined | null,
    dateStrs: string[],
    assignmentsPreviewByDate?: Map<string, Array<{ empId: string; code: string }>>,
): Record<string, Set<string>> | undefined {
    if (!rules?.length) return undefined;
    const excluded: Record<string, Set<string>> = {};
    for (const dateStr of dateStrs) {
        const dayAsgn = assignmentsPreviewByDate?.get(dateStr) ?? [];
        for (const rule of rules) {
            if (!rule.triggers.length) continue;
            const fires = rule.triggers.every((t) => {
                const empA = dayAsgn.find((a) => a.empId === t.employeeId);
                const codes = t.shiftCodes?.length
                    ? t.shiftCodes.map((c) => String(c).toUpperCase())
                    : [String(t.shiftCode || '').toUpperCase()];
                return empA != null && codes.includes(String(empA.code || '').toUpperCase());
            });
            if (!fires) continue;
            for (const action of rule.actions) {
                if (action.type !== 'EXCLUDE' || !action.positionName || !action.shiftCode) continue;
                const key = `${action.positionName}||${String(action.shiftCode).toUpperCase()}`;
                if (!excluded[dateStr]) excluded[dateStr] = new Set();
                excluded[dateStr].add(key);
            }
        }
    }
    return Object.keys(excluded).length > 0 ? excluded : undefined;
}

export function slaRotationExpectedShift(
    ctx: Pick<V2EngineContext, 'slaRotationByDate'>,
    empId: string,
    dateStr: string,
    positionName: string,
): string | null {
    const cell = ctx.slaRotationByDate?.[dateStr]?.[empId];
    if (!cell) return null;
    const want = String(positionName || '').trim().toLowerCase();
    const got = String(cell.positionName || '').trim().toLowerCase();
    if (want && got && want !== got) return null;
    const code = String(cell.shiftCode || '').toUpperCase();
    return code || null;
}

export function empMayJoinPositionRoster(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
    empId: string,
    positionName: string,
): boolean {
    return empCanCoverPositionShift(ctx, empId, positionName);
}

export interface SlaContractReadiness {
    hasCobertura: boolean;
    coberturaEmpCount: number;
    hasCondiciones: boolean;
    hasRotaciones: boolean;
    rotationDayCount: number;
    hints: string[];
}

export function assessSlaContractReadiness(params: {
    positionAssignments?: PositionAssignment[] | null;
    serviceRules?: ServiceRule[] | null;
    serviceRotations?: ServiceRotation[] | null;
    dateStrs: string[];
}): SlaContractReadiness {
    const hints: string[] = [];
    const coberturaEmpCount = (params.positionAssignments ?? []).filter((a) => (a.slots?.length ?? 0) > 0).length;
    const hasCobertura = coberturaEmpCount > 0;
    const hasCondiciones = (params.serviceRules?.length ?? 0) > 0;
    const hasRotaciones = (params.serviceRotations?.length ?? 0) > 0;
    const rotMap = buildSlaRotationByDate(params.serviceRotations, params.dateStrs);
    const rotationDayCount = rotMap ? Object.keys(rotMap).length : 0;

    if (!hasCobertura) {
        hints.push('Sin cobertura de dotación en SLA: el motor reparte puestos sin restricción por legajo.');
    }
    if (!hasRotaciones) {
        hints.push('Sin rotaciones SLA: bandas fijas salen de defaultShiftByEmp o del motor genérico.');
    }
    if (!hasCondiciones) {
        hints.push('Sin condiciones SLA: no hay reglas IF→THEN por día.');
    }
    if (hasRotaciones && rotationDayCount === 0) {
        hints.push('Rotaciones cargadas pero ningún período aplica en el mes — revisá referencia/semanas.');
    }

    return {
        hasCobertura,
        coberturaEmpCount,
        hasCondiciones,
        hasRotaciones,
        rotationDayCount,
        hints,
    };
}
