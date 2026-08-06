import type { V2EngineContext } from './autoScheduleEngineV2';

function normalizePositionNameKey(name: string): string {
    return String(name || '').trim().toLowerCase();
}

const NON_WORK_CODES = new Set([
    'F', 'FF', 'FP', 'FT', 'RET', 'R',
    'V', 'L', 'E', 'A', 'PG', 'AA',
]);

export function hasPositionAssignmentPolicy(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
): boolean {
    const map = ctx.positionAssignmentsByEmp;
    return !!map && Object.keys(map).length > 0;
}

/**
 * Alineado con planificación manual (`isBulkCovBlocked`):
 * sin mapa SLA → sin restricción; legajo sin slots → sin restricción;
 * legajo con slots → solo puestos/bandas listados.
 */
export function empCanCoverPositionShift(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
    empId: string,
    positionName: string,
    shiftCode?: string,
): boolean {
    const map = ctx.positionAssignmentsByEmp;
    if (!map) return true;
    const slots = map[empId];
    if (!slots?.length) return true;
    const posKey = normalizePositionNameKey(positionName);
    const slot = slots.find((s) => normalizePositionNameKey(s.positionName) === posKey);
    if (!slot) return false;
    if (!shiftCode) return true;
    const code = String(shiftCode || '').toUpperCase();
    if (NON_WORK_CODES.has(code)) return true;
    if (!slot.shiftCodes?.length) return true;
    return slot.shiftCodes.map((c) => String(c).toUpperCase()).includes(code);
}

/** Puestos donde el legajo puede trabajar (vacío = ninguno explícito en slots). */
export function allowedPositionNamesForEmp(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
    empId: string,
): string[] | null {
    const map = ctx.positionAssignmentsByEmp;
    if (!map) return null;
    const slots = map[empId];
    if (!slots?.length) return null;
    return slots.map((s) => s.positionName);
}

export function empHasPositionAssignmentRestriction(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
    empId: string,
): boolean {
    const map = ctx.positionAssignmentsByEmp;
    return !!map?.[empId]?.length;
}

export interface PositionAssignmentViolation {
    empId: string;
    dateStr: string;
    positionName: string;
    code: string;
}

/** Celdas de trabajo que violan cobertura de dotación del SLA (post-cronograma). */
export function findPositionAssignmentViolations(
    ctx: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
    assignments: Array<{ empId: string; dateStr: string; positionName: string; code: string; hours?: number }>,
): PositionAssignmentViolation[] {
    if (!hasPositionAssignmentPolicy(ctx)) return [];
    const out: PositionAssignmentViolation[] = [];
    for (const a of assignments) {
        const hours = a.hours ?? 0;
        if (hours <= 0) continue;
        const pos = String(a.positionName || '').trim();
        if (!pos) continue;
        const code = String(a.code || '').toUpperCase();
        if (NON_WORK_CODES.has(code)) continue;
        if (!empCanCoverPositionShift(ctx, a.empId, pos, code)) {
            out.push({
                empId: a.empId,
                dateStr: a.dateStr,
                positionName: pos,
                code,
            });
        }
    }
    return out;
}
