import { isPosExcludedOnDate } from '@/lib/planificacion/planificacionDailyCoverage';
import { checkGeneroPuesto, getPreferenciaGeneroFromPositionStructure } from '@/lib/planificacion/genderPreference';
import { isPlanningWorkShiftCode, planningPositionExclusionLabel } from '@/lib/slaPlanningMatch';

export type EvaluatePlanificacionRestriccionesParams = {
    emp: any;
    dateStr: string;
    positionName?: string | null;
    shiftCode?: string | null;
    objectiveIdOverride?: string | null;
    structureOverride?: any[];
    selectedObjective: string;
    positionStructure: any[];
    getObjectiveName: (objectiveId: string) => string;
    activePosition: string | null;
    selectedCell: { currentShift?: { positionName?: string } } | null;
    selectedClient: string;
    displayedEmployees: any[];
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    resolveEffectiveShiftObjectiveId: (emp: any, shift: any, key: string) => string | null;
};

export function evaluatePlanificacionRestricciones({
    emp,
    dateStr,
    positionName,
    shiftCode,
    objectiveIdOverride,
    structureOverride,
    selectedObjective,
    positionStructure,
    getObjectiveName,
    activePosition,
    selectedCell,
    selectedClient,
    displayedEmployees,
    pendingChanges,
    shiftsMap,
    resolveEffectiveShiftObjectiveId,
}: EvaluatePlanificacionRestriccionesParams): { blocked: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const objId = objectiveIdOverride || selectedObjective;
    const struct = structureOverride || positionStructure;
    const currentObjName = getObjectiveName(objId);
    const posForGenero = positionName || activePosition || selectedCell?.currentShift?.positionName || null;
    const posCfg = struct.find((p: any) => p.positionName === posForGenero);
    if (posForGenero && isPosExcludedOnDate(posCfg, dateStr) && (shiftCode == null || isPlanningWorkShiftCode(shiftCode))) {
        warnings.push(`🚫 Puesto "${posForGenero}" excluido por SLA (${planningPositionExclusionLabel(dateStr)}) — sin servicio ese día`);
        return { blocked: true, warnings };
    }
    const prefGenero = getPreferenciaGeneroFromPositionStructure(struct, posForGenero);
    const generoCheck = checkGeneroPuesto(emp.genero, prefGenero);
    if (generoCheck.blocked && generoCheck.message) {
        const posLabel = posForGenero ? ` (${posForGenero})` : '';
        warnings.push(`🚫 ${emp.name}${posLabel}: ${generoCheck.message}`);
    }
    const objRestr = (emp.restriccionesObjetivo || []).find((r: any) =>
        r.objectiveId === objId || r.objectiveName === currentObjName,
    );
    if (objRestr) warnings.push(`🚫 ${emp.name} está EXCLUIDO de este objetivo${objRestr.reason ? ` (${objRestr.reason})` : ''}`);
    const clientRestr = (emp.restriccionesCliente || []).find((r: any) => r.clientId === selectedClient);
    if (clientRestr) warnings.push(`🚫 ${emp.name} está EXCLUIDO del cliente completo${clientRestr.reason ? ` (${clientRestr.reason})` : ''}`);
    const conflictIds = new Set((emp.conflictosEmpleados || []).map((c: any) => c.employeeId));
    if (conflictIds.size > 0) {
        displayedEmployees.forEach((other: any) => {
            if (other.id === emp.id) return;
            const otherKey = `${other.id}_${dateStr}`;
            const otherShift = pendingChanges[otherKey] || shiftsMap[otherKey];
            if (!otherShift || otherShift.isDeleted) return;
            const otherObjId = resolveEffectiveShiftObjectiveId(other, otherShift, otherKey);
            if (String(otherObjId || '') !== String(objId)) return;
            if (conflictIds.has(other.id)) {
                const conflict = (emp.conflictosEmpleados || []).find((c: any) => c.employeeId === other.id);
                warnings.push(`⚠️ Conflicto con ${other.name}${conflict?.reason ? ` (${conflict.reason})` : ''}`);
            }
            if ((other.conflictosEmpleados || []).some((c: any) => c.employeeId === emp.id)) {
                warnings.push(`⚠️ ${other.name} tiene conflicto registrado con ${emp.name}`);
            }
        });
    }
    return { blocked: !!(objRestr || clientRestr || generoCheck.blocked), warnings };
}

export function isPlanificacionBulkCovBlocked(
    empId: string,
    posName: string,
    code: string,
    activeSlaPositionAssignments: any[] | null | undefined,
): boolean {
    if (!activeSlaPositionAssignments?.length) return false;
    if (!isPlanningWorkShiftCode(code)) return false;
    const pa = activeSlaPositionAssignments.find((a: any) => a.employeeId === empId);
    if (!pa?.slots?.length) return false;
    const slot = pa.slots.find((s: any) => s.positionName === posName);
    if (!slot) return true;
    if (slot.shiftCodes.length === 0) return false;
    return !slot.shiftCodes.map((x: string) => x.toUpperCase()).includes(String(code || '').toUpperCase());
}
