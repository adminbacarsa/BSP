import type { PositionAssignment, ServicePosition, ShiftVariant } from '@/services/slaService';

/** Tipo de cobertura en Servicios: administrativo, facturable, sin reemplazo. */
export const ENCARGADO_COVERAGE_TYPE = 'encargado';
export const ENCARGADO_SHIFT_CODE = 'ENC';
export const ENCARGADO_WEEKDAYS = ['L', 'M', 'X', 'J', 'V'] as const;
export const ENCARGADO_ALL_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export function sameEncargadoDaySet(
    days: string[] | undefined,
    expected: readonly string[],
): boolean {
    const a = [...(days || [])].map((d) => String(d).toUpperCase()).sort().join(',');
    const b = [...expected].map((d) => String(d).toUpperCase()).sort().join(',');
    return a === b;
}

export function formatEncargadoDaysLabel(days?: string[]): string {
    if (sameEncargadoDaySet(days, ENCARGADO_WEEKDAYS)) return 'L–V';
    if (!days?.length || sameEncargadoDaySet(days, ENCARGADO_ALL_DAYS)) return 'L–D';
    return days.join('·');
}

export function hoursBetweenHm(start: string, end: string): number {
    const [h1, m1] = (start || '00:00').slice(0, 5).split(':').map(Number);
    const [h2, m2] = (end || '00:00').slice(0, 5).split(':').map(Number);
    let s = (Number(h1) || 0) * 60 + (Number(m1) || 0);
    let e = (Number(h2) || 0) * 60 + (Number(m2) || 0);
    if (e <= s) e += 1440;
    return Math.round(((e - s) / 60) * 100) / 100;
}

export function isEncargadoCoverageType(coverageType?: string | null): boolean {
    return String(coverageType || '').toLowerCase().trim() === ENCARGADO_COVERAGE_TYPE;
}

export function isEncargadoPosition(pos: { coverageType?: string; code?: string } | null | undefined): boolean {
    if (!pos) return false;
    if (isEncargadoCoverageType(pos.coverageType)) return true;
    return String(pos.code || '').toUpperCase() === ENCARGADO_SHIFT_CODE;
}

export function findEncargadoPosition(positions: ServicePosition[] | undefined | null): ServicePosition | null {
    return (positions || []).find(isEncargadoPosition) ?? null;
}

export function buildEncargadoDefaultShift(opts?: { startTime?: string; endTime?: string }): ShiftVariant {
    const startTime = opts?.startTime || '10:00';
    const endTime = opts?.endTime || '18:00';
    return {
        code: ENCARGADO_SHIFT_CODE,
        name: 'Encargado',
        startTime,
        endTime,
        hours: hoursBetweenHm(startTime, endTime) || 8,
        isCustom: true,
    };
}

export function buildEncargadoPositionDraft(partial?: Partial<ServicePosition>): ServicePosition {
    return {
        id: '',
        name: 'Encargado',
        code: ENCARGADO_SHIFT_CODE,
        coverageType: ENCARGADO_COVERAGE_TYPE,
        quantity: 1,
        activeDays: [...ENCARGADO_WEEKDAYS],
        allowedShiftTypes: [buildEncargadoDefaultShift()],
        preferenciaGenero: 'INDISTINTO',
        ...partial,
        coverageType: ENCARGADO_COVERAGE_TYPE,
    };
}

function isEncargadoSlot(
    slot: { positionName?: string; shiftCodes?: string[] } | null | undefined,
    positionName?: string,
): boolean {
    if (!slot) return false;
    const codes = (slot.shiftCodes || []).map((c) => String(c || '').toUpperCase());
    if (codes.includes(ENCARGADO_SHIFT_CODE)) return true;
    const name = String(slot.positionName || '').trim();
    if (positionName && name === String(positionName).trim()) return true;
    return name.toLowerCase() === 'encargado';
}

/** Encargado al final: si hay otros puestos, el primario de cobertura no es ENC. */
export function upsertEncargadoAssignment(
    assignments: PositionAssignment[] | undefined,
    params: { employeeId: string; employeeName: string; positionName: string },
): PositionAssignment[] {
    const list = [...(assignments || [])];
    const empId = String(params.employeeId || '').trim();
    if (!empId) return list;
    const encSlot = {
        positionName: params.positionName,
        shiftCodes: [ENCARGADO_SHIFT_CODE],
    };
    const idx = list.findIndex((a) => a.employeeId === empId);
    if (idx < 0) {
        list.push({
            employeeId: empId,
            employeeName: params.employeeName,
            slots: [encSlot],
        });
        return list;
    }
    const prev = list[idx];
    const otherSlots = (prev.slots || []).filter((s) => !isEncargadoSlot(s, params.positionName));
    list[idx] = {
        ...prev,
        employeeName: params.employeeName || prev.employeeName,
        slots: [...otherSlots, encSlot],
    };
    return list;
}

export function stripEncargadoAssignment(
    assignments: PositionAssignment[] | undefined,
    employeeId: string,
    positionName?: string,
): PositionAssignment[] | undefined {
    if (!assignments) return assignments;
    const empId = String(employeeId || '').trim();
    if (!empId) return assignments;
    return assignments
        .map((a) => {
            if (a.employeeId !== empId) return a;
            return {
                ...a,
                slots: (a.slots || []).filter((s) => !isEncargadoSlot(s, positionName)),
            };
        })
        .filter((a) => (a.slots || []).length > 0);
}

export function applyEncargadoEmployeeChoice(
    current: {
        encargadoEmployeeId?: string;
        encargadoEmployeeName?: string;
        positionAssignments?: PositionAssignment[];
        positions: ServicePosition[];
    },
    next: { employeeId: string; employeeName: string } | null,
): {
    encargadoEmployeeId: string;
    encargadoEmployeeName: string;
    positionAssignments?: PositionAssignment[];
} {
    const pos = findEncargadoPosition(current.positions);
    let assignments = current.positionAssignments;
    const prevId = String(current.encargadoEmployeeId || '').trim();
    if (prevId && pos) {
        assignments = stripEncargadoAssignment(assignments, prevId, pos.name);
    }
    if (!next || !pos) {
        return {
            encargadoEmployeeId: '',
            encargadoEmployeeName: '',
            positionAssignments: assignments,
        };
    }
    if (assignments !== undefined) {
        assignments = upsertEncargadoAssignment(assignments, {
            employeeId: next.employeeId,
            employeeName: next.employeeName,
            positionName: pos.name,
        });
    }
    return {
        encargadoEmployeeId: next.employeeId,
        encargadoEmployeeName: next.employeeName,
        positionAssignments: assignments,
    };
}

/** Inyecta el Encargado del SLA en cobertura para planificación, sin exigir “Activar cobertura”. */
export function mergeEncargadoIntoAssignments(sla: {
    positionAssignments?: PositionAssignment[];
    encargadoEmployeeId?: string;
    encargadoEmployeeName?: string;
    positions?: ServicePosition[] | unknown;
}): PositionAssignment[] | undefined {
    const empId = String(sla.encargadoEmployeeId || '').trim();
    const positions = Array.isArray(sla.positions) ? (sla.positions as ServicePosition[]) : undefined;
    const pos = findEncargadoPosition(positions);
    if (!empId || !pos) return sla.positionAssignments;
    return upsertEncargadoAssignment(sla.positionAssignments, {
        employeeId: empId,
        employeeName: String(sla.encargadoEmployeeName || '').trim() || empId,
        positionName: pos.name,
    });
}

export function isEncargadoDotacionEntry(
    entry: { positionName?: string; shiftCode?: string } | null | undefined,
    positionName?: string,
): boolean {
    if (!entry) return false;
    if (String(entry.shiftCode || '').toUpperCase() === ENCARGADO_SHIFT_CODE) return true;
    const name = String(entry.positionName || '').trim();
    if (positionName && name === String(positionName).trim()) return true;
    return name.toLowerCase() === 'encargado';
}

export function nextPlanificacionDotacionForEncargado(params: {
    current: Record<string, { positionName: string; shiftCode?: string }>;
    objectiveId: string;
    positionName: string;
    mode: 'set' | 'clear';
    dedicated: boolean;
}): Record<string, { positionName: string; shiftCode?: string }> {
    const next = { ...params.current };
    const objId = String(params.objectiveId || '').trim();
    if (!objId) return next;
    if (params.mode === 'clear') {
        if (isEncargadoDotacionEntry(next[objId], params.positionName)) {
            delete next[objId];
        }
        return next;
    }
    if (!params.dedicated) return next;
    const existing = next[objId];
    if (existing && !isEncargadoDotacionEntry(existing, params.positionName)) return next;
    next[objId] = { positionName: params.positionName, shiftCode: ENCARGADO_SHIFT_CODE };
    return next;
}

export function isDedicatedEncargadoAssignment(
    assignments: PositionAssignment[] | undefined,
    employeeId: string,
    positionName?: string,
): boolean {
    const empId = String(employeeId || '').trim();
    if (!empId) return true;
    const row = (assignments || []).find((a) => a.employeeId === empId);
    if (!row?.slots?.length) return true;
    const other = row.slots.filter((s) => !isEncargadoSlot(s, positionName));
    return other.length === 0;
}
