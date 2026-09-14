import { toast } from 'sonner';
import {
    is24hCoverageType,
    resolveBandHours,
} from '@/lib/planificacion/planificacionBandHours';
import { isPosExcludedOnDate } from '@/lib/planificacion/planificacionDailyCoverage';
import { SHIFT_HOURS_LOOKUP } from '@/lib/planificacion/planificacionGridVisuals';
import { isPosActiveOnDay } from '@/lib/planificacion/planificacionPositionEngine';
import { getDateKey, getDayLetter } from '@/lib/planificacion/utils';
import { isPlanningWorkShiftCode } from '@/lib/slaPlanningMatch';
import {
    countPositionClosedUnitsFromShifts,
    is24hsSinglePaxBandMixBlocked,
    PLANNING_NON_BILLABLE_CODES,
} from '@/lib/planificacion/positionCoverageUnits';
import { isEmployeeOnLeave } from '@/lib/planificacion/leaveCoverage';
import { isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';
import { planToastBulk, planToastWarnMany } from '@/lib/planificacion/planToast';

export type ApplyPlanificacionBulkPositionFillParams = {
    posName: string;
    allowPlanningMultiSelect: boolean;
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selection: { start: { r: number; c: number } | null; end: { r: number; c: number } | null };
    daysInMonth: Date[];
    isPlanningDateLocked: (dateStr: string) => boolean;
    selectedGrupo: { objectiveIds: string[] } | null;
    grupoUnifiedMode: boolean;
    selectedObjective: string;
    bulkEmpObjectiveOverrides: Record<string, string>;
    bulkTargetObjectiveId: string | null;
    grupoSlaMap: Record<string, any[]>;
    positionStructure: any[];
    pendingChanges: Record<string, any>;
    displayedEmployees: any[];
    shiftsMap: Record<string, any>;
    empDefaultShift: Record<string, string>;
    absencesMap: Record<string, any>;
    slaIdToObjId: Record<string, string>;
    autoSelectedCyclesRef: { current: any[] | null };
    autoCycles: any[];
    resolveNativeObjectiveInGrupo: (emp: { preferredObjectiveId?: string }) => string | null;
    checkRestricciones: (
        emp: any,
        dateStr: string,
        positionName?: string | null,
        shiftCode?: string | null,
        objectiveIdOverride?: string | null,
        structureOverride?: any[],
    ) => { blocked: boolean; warnings: string[] };
    isBulkCovBlocked: (empId: string, posName: string, code: string) => boolean;
    commitPendingChanges: (changes: Record<string, any>) => void;
    applyBulkChange: (shiftConfig: any, opts?: { onlyEmpId?: string }) => void;
};

export function applyPlanificacionBulkPositionFill({
    posName,
    allowPlanningMultiSelect,
    isServiceLocked,
    activeServiceStatusMsg,
    selection,
    daysInMonth,
    isPlanningDateLocked,
    selectedGrupo,
    grupoUnifiedMode,
    selectedObjective,
    bulkEmpObjectiveOverrides,
    bulkTargetObjectiveId,
    grupoSlaMap,
    positionStructure,
    pendingChanges,
    displayedEmployees,
    shiftsMap,
    empDefaultShift,
    absencesMap,
    slaIdToObjId,
    autoSelectedCyclesRef,
    autoCycles,
    resolveNativeObjectiveInGrupo,
    checkRestricciones,
    isBulkCovBlocked,
    commitPendingChanges,
    applyBulkChange,
}: ApplyPlanificacionBulkPositionFillParams): void {
    if (!allowPlanningMultiSelect) {
        toast.message('Cronograma publicado — activá modo Corregir para edición masiva.');
        return;
    }
    if (isServiceLocked) { toast.error(activeServiceStatusMsg || 'Bloqueado'); return; }
    if (!selection.start || !selection.end) return;

    const getEmpBulkObjective = (emp: any): string | null => {
        if (!selectedGrupo || !grupoUnifiedMode) return selectedObjective;
        const native = resolveNativeObjectiveInGrupo(emp);
        if (native) return native;
        return bulkEmpObjectiveOverrides[emp.id] || bulkTargetObjectiveId || selectedGrupo.objectiveIds[0] || null;
    };

    const getStructureForObj = (objId: string) => {
        if (selectedGrupo && grupoUnifiedMode && grupoSlaMap[objId]?.length) return grupoSlaMap[objId];
        return positionStructure;
    };

    const minR = Math.min(selection.start.r, selection.end.r);
    const maxR = Math.max(selection.start.r, selection.end.r);
    const minC = Math.min(selection.start.c, selection.end.c);
    const maxC = Math.max(selection.start.c, selection.end.c);
    const startDay = daysInMonth[minC];
    if (isPlanningDateLocked(getDateKey(startDay))) {
        toast.warning('Periodo cerrado — no se puede completar puestos laborales en masa.');
        return;
    }

    if (selectedGrupo && grupoUnifiedMode) {
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            const extFallback = bulkEmpObjectiveOverrides[emp.id] || bulkTargetObjectiveId || selectedGrupo.objectiveIds[0] || null;
            if (!resolveNativeObjectiveInGrupo(emp) && !extFallback) {
                toast.error('Seleccioná el objetivo para colaboradores EXT en la barra de asignación.');
                return;
            }
        }
    }

    const hasPosInAnySla = selectedGrupo && grupoUnifiedMode
        ? selectedGrupo.objectiveIds.some(objId => (grupoSlaMap[objId] || []).some((p: any) => p.positionName === posName))
        : (positionStructure || []).some((p: any) => p.positionName === posName);
    if (!hasPosInAnySla) {
        toast.error(`El puesto "${posName}" no tiene turnos en el SLA`);
        return;
    }

    const pickShiftForEmp = (emp: any, posShifts: any[], covObjId: string) => {
        const pref = String(empDefaultShift[`${emp.id}___${covObjId}`] || '').toUpperCase();
        if (pref && posShifts.some((s: any) => String(s.code || '').toUpperCase() === pref)) {
            return posShifts.find((s: any) => String(s.code || '').toUpperCase() === pref);
        }
        for (const prefer of ['M', 'T', 'N', 'D12', 'N12', 'MA']) {
            const hit = posShifts.find((s: any) => String(s.code || '').toUpperCase() === prefer);
            if (hit) return hit;
        }
        return posShifts[0];
    };

    const byCode = new Map<string, { shift: any }>();
    for (let r = minR; r <= maxR; r++) {
        const emp = displayedEmployees[r];
        if (!emp) continue;
        const covObjId = getEmpBulkObjective(emp);
        if (!covObjId) continue;
        const empStructure = getStructureForObj(covObjId);
        const pos = empStructure.find((p: any) => p.positionName === posName);
        const posShifts = (pos?.shifts || []) as any[];
        if (!pos || posShifts.length === 0) continue;
        const sh = pickShiftForEmp(emp, posShifts, covObjId);
        if (!sh) continue;
        const ck = `${String(sh.code || '').toUpperCase()}__${covObjId}`;
        if (!byCode.has(ck)) byCode.set(ck, { shift: sh });
    }

    if (byCode.size === 1) {
        const only = [...byCode.values()][0];
        applyBulkChange({
            code: only.shift.code,
            name: only.shift.name,
            hours: only.shift.hours,
            startTime: only.shift.startTime,
            endTime: only.shift.endTime,
            positionName: posName,
        });
        return;
    }

    const newChanges = { ...pendingChanges };
    let count = 0;
    let skippedCoverage = 0;
    let skippedExcluded = 0;
    let skippedNoPos = 0;
    const cyclesForBulk = autoSelectedCyclesRef.current?.length
        ? autoSelectedCyclesRef.current
        : autoCycles;

    for (let r = minR; r <= maxR; r++) {
        const emp = displayedEmployees[r];
        if (!emp) continue;
        const covObjId = getEmpBulkObjective(emp);
        if (!covObjId) continue;
        const empStructure = getStructureForObj(covObjId);
        const pos = empStructure.find((p: any) => p.positionName === posName);
        const posShifts = (pos?.shifts || []) as any[];
        if (!pos || posShifts.length === 0) { skippedNoPos++; continue; }
        const sh = pickShiftForEmp(emp, posShifts, covObjId);
        if (!sh) continue;

        const dominant = (empStructure || []).reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            empStructure[0] || { qty: 1, positionName: 'General' },
        );

        const collectCodeCounts = (dateStr: string, changes: Record<string, any>) => {
            const codeCounts: Record<string, number> = {};
            const assigned: { code: string; hours: number }[] = [];
            displayedEmployees.forEach((e: any) => {
                const key = `${e.id}_${dateStr}`;
                const absence = absencesMap[key];
                if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || shiftsMap[key]?.code, absence })) return;
                const pending = changes[key];
                const shift = pending ? (pending.isDeleted ? null : pending) : shiftsMap[key];
                if (!shift) return;
                const explicitObj = pending?.objectiveId ?? shift.objectiveId;
                const effectiveObjId = explicitObj
                    ? String(explicitObj)
                    : (resolveNativeObjectiveInGrupo(e) || (e.preferredObjectiveId === covObjId || slaIdToObjId[e.preferredObjectiveId] === covObjId ? covObjId : null));
                if (String(effectiveObjId || '') !== String(covObjId)) return;
                const code = String(shift.code || '').toUpperCase();
                if (PLANNING_NON_BILLABLE_CODES.has(code)) return;
                const shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos !== posName) return;
                codeCounts[code] = (codeCounts[code] || 0) + 1;
                assigned.push({ code, hours: resolveBandHours(code, shift, posShifts) });
            });
            return { codeCounts, assigned };
        };

        const isBlocked = (dateStr: string, code: string, hours: number, changes: Record<string, any>) => {
            if (!isPlanningWorkShiftCode(code)) return false;
            const dayLetter = getDayLetter(dateStr);
            if (!isPosActiveOnDay(pos, dayLetter, dateStr)) return true;
            if (isPosExcludedOnDate(pos, dateStr)) return true;
            const pax = Math.max(1, Number(pos.qty) || 1);
            const { codeCounts, assigned } = collectCodeCounts(dateStr, changes);
            const units = countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cyclesForBulk, true, dateStr);
            if (units.required > 0 && units.closed >= units.required) return true;
            const upper = String(code).toUpperCase();
            if ((codeCounts[upper] || 0) >= pax) return true;
            if (!is24hCoverageType(pos)) return false;
            const bandH = resolveBandHours(upper, { hours }, pos.shifts);
            if (is24hsSinglePaxBandMixBlocked(pax, upper, assigned, bandH)) return true;
            return false;
        };

        for (let c = minC; c <= maxC; c++) {
            const dateStr = getDateKey(daysInMonth[c]);
            const key = `${emp.id}_${dateStr}`;
            const existing = shiftsMap[key];
            if (isShiftConsolidated(existing)) continue;
            if (isPosExcludedOnDate(pos, dateStr)) { skippedExcluded++; continue; }
            const hours = Number(sh.hours) || SHIFT_HOURS_LOOKUP[String(sh.code || '').toUpperCase()] || 8;
            if (isBlocked(dateStr, String(sh.code || ''), hours, newChanges)) { skippedCoverage++; continue; }
            const { blocked, warnings } = checkRestricciones(emp, dateStr, posName, sh.code, covObjId, empStructure);
            if (blocked) continue;
            if (warnings.length > 0) planToastWarnMany(warnings, 8000);
            if (isBulkCovBlocked(emp.id, posName, String(sh.code || ''))) { skippedCoverage++; continue; }
            newChanges[key] = {
                code: sh.code,
                name: sh.name,
                hours,
                startTime: sh.startTime,
                endTime: sh.endTime,
                isTemp: true,
                oldObjectiveId: existing?.objectiveId,
                positionName: posName,
                objectiveId: covObjId,
            };
            count++;
        }
    }
    commitPendingChanges(newChanges);
    planToastWarnMany([
        skippedNoPos > 0 ? `${skippedNoPos} omitida(s): puesto no existe en SLA` : '',
        skippedCoverage > 0 ? `${skippedCoverage} omitida(s): cobertura completa` : '',
        skippedExcluded > 0 ? `${skippedExcluded} omitida(s): día excluido` : '',
    ]);
    planToastBulk(count > 0 ? `${count} celda(s) · puesto ${posName}` : 'Ninguna celda aplicada');
}
