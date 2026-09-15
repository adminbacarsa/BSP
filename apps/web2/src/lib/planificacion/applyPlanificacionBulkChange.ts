import { toast } from 'sonner';
import {
    is24hCoverageType,
    isShortBandHours,
    resolveBandHours,
} from '@/lib/planificacion/planificacionBandHours';
import { isPosExcludedOnDate } from '@/lib/planificacion/planificacionDailyCoverage';
import { getDateKey, getDayLetter } from '@/lib/planificacion/utils';
import { isPosActiveOnDay } from '@/lib/planificacion/planificacionPositionEngine';
import {
    isPlanningShiftExcludedOnDate,
    isPlanningWorkShiftCode,
} from '@/lib/slaPlanningMatch';
import {
    countPositionClosedUnitsFromShifts,
    is24hsSinglePaxBandMixBlocked,
    PLANNING_NON_BILLABLE_CODES,
} from '@/lib/planificacion/positionCoverageUnits';
import { isEmployeeOnLeave } from '@/lib/planificacion/leaveCoverage';
import {
    shiftPlanningCodeUpper,
} from '@/lib/planificacion/planificacionPlanningShiftRules';
import { isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';
import { planToastBulk, planToastWarnMany } from '@/lib/planificacion/planToast';

export type ApplyPlanificacionBulkChangeParams = {
    shiftConfig: any;
    opts?: { onlyEmpId?: string };
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
    autoSelectedCyclesRef: { current: any[] | null };
    autoCycles: any[];
    activePosition: string | null;
    empDefaultPos: Record<string, string>;
    bulkEmpPositionFilter: Record<string, string>;
    bulkBarPosition: string | null;
    absencesMap: Record<string, any>;
    slaIdToObjId: Record<string, string>;
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
};

export function applyPlanificacionBulkChange({
    shiftConfig,
    opts,
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
    autoSelectedCyclesRef,
    autoCycles,
    activePosition,
    empDefaultPos,
    bulkEmpPositionFilter,
    bulkBarPosition,
    absencesMap,
    slaIdToObjId,
    resolveNativeObjectiveInGrupo,
    checkRestricciones,
    isBulkCovBlocked,
    commitPendingChanges,
}: ApplyPlanificacionBulkChangeParams): void {
    if (!allowPlanningMultiSelect) {
        toast.message('Cronograma publicado — activá modo Corregir para edición masiva.');
        return;
    }
    if (isServiceLocked) { toast.error(activeServiceStatusMsg || 'Bloqueado'); return; }
    if (!selection.start || !selection.end) return;
    const startDay = daysInMonth[Math.min(selection.start.c, selection.end.c)];
    if (isPlanningDateLocked(getDateKey(startDay))) {
        const c = String(shiftConfig?.code || '').toUpperCase();
        if (!['RET', 'ESC', 'F', 'FF', 'FP', 'FT'].includes(c)) {
            toast.warning('Periodo cerrado — solo podés asignar RET, ESC o Franco en masa.');
            return;
        }
    }
    const minR = Math.min(selection.start.r, selection.end.r);
    const maxR = Math.max(selection.start.r, selection.end.r);
    const minC = Math.min(selection.start.c, selection.end.c);
    const maxC = Math.max(selection.start.c, selection.end.c);

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

    if (shiftConfig !== null && selectedGrupo && grupoUnifiedMode) {
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            if (opts?.onlyEmpId && emp.id !== opts.onlyEmpId) continue;
            const extFallback = bulkEmpObjectiveOverrides[emp.id] || bulkTargetObjectiveId || selectedGrupo.objectiveIds[0] || null;
            if (!resolveNativeObjectiveInGrupo(emp) && !extFallback) {
                toast.error('Seleccioná el objetivo para colaboradores EXT en la barra de asignación.');
                return;
            }
        }
    }

    const newChanges = { ...pendingChanges };
    let count = 0;
    let francosReplaced = 0;
    let skippedExcluded = 0;
    let skippedCoverage = 0;
    let skippedExt = 0;

    const cyclesForBulk = autoSelectedCyclesRef.current?.length
        ? autoSelectedCyclesRef.current
        : autoCycles;

    const buildBulkHelpers = (empStructure: any[], covObjId: string) => {
        const fallbackPosLocal = activePosition || (empStructure[0]?.positionName) || 'General';

        const ownersForCode = (code: string) => {
            const upper = String(code || '').toUpperCase();
            return (empStructure || []).filter((p: any) =>
                (p.shifts || []).some((s: any) => String(s.code || '').toUpperCase() === upper),
            );
        };

        const resolveAssignPos = (emp: any, code: string, hintPos?: string | null) => {
            const upper = String(code || '').toUpperCase();
            if (upper === 'RET') return 'Retén';
            if (['F', 'FF', 'FP', 'FT'].includes(upper)) return 'General';
            const empPos = empDefaultPos[`${emp.id}___${covObjId}`] || null;
            const filterPos = bulkEmpPositionFilter[emp.id] || bulkBarPosition || null;
            if (upper === 'REF' || upper === 'ESC') {
                return hintPos || filterPos || empPos || fallbackPosLocal;
            }
            const owners = ownersForCode(upper);
            if (owners.length === 0) {
                return empPos || filterPos || hintPos || fallbackPosLocal;
            }
            if (empPos && owners.some((p: any) => p.positionName === empPos)) return empPos;
            if (filterPos && owners.some((p: any) => p.positionName === filterPos)) return filterPos;
            if (hintPos && owners.some((p: any) => p.positionName === hintPos)) return hintPos;
            if (activePosition && owners.some((p: any) => p.positionName === activePosition)) return activePosition;
            return owners[0].positionName;
        };

        const shiftDefFor = (posName: string, code: string) => {
            const upper = String(code || '').toUpperCase();
            const pos = (empStructure || []).find((p: any) => p.positionName === posName);
            return (pos?.shifts || []).find((s: any) => String(s.code || '').toUpperCase() === upper) || null;
        };

        const collectCodeCounts = (dateStr: string, posName: string, changes: Record<string, any>) => {
            const dominant = (empStructure || []).reduce(
                (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
                empStructure[0] || { qty: 1, positionName: 'General' },
            );
            const posShifts = ((empStructure || []).find((p: any) => p.positionName === posName)?.shifts || []) as any[];
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

        const isCoverageBlocked = (dateStr: string, posName: string, code: string, hours: number, changes: Record<string, any>) => {
            const upperEarly = String(code || '').toUpperCase();
            if (['RET', 'ESC', 'REF', 'RFZ'].includes(upperEarly)) return false;
            if (!isPlanningWorkShiftCode(code)) return false;
            const posCfg = (empStructure || []).find((p: any) => p.positionName === posName) || empStructure[0];
            if (!posCfg) return false;
            const dayLetter = getDayLetter(dateStr);
            if (!isPosActiveOnDay(posCfg, dayLetter, dateStr)) return true;
            if (isPosExcludedOnDate(posCfg, dateStr)) return true;
            const shiftRow = (posCfg.shifts || []).find((s: any) => String(s.code || '').toUpperCase() === String(code).toUpperCase());
            if (Array.isArray(shiftRow?.specificDates) && shiftRow.specificDates.length > 0 && !shiftRow.specificDates.includes(dateStr)) return true;
            if (Array.isArray(shiftRow?.days) && shiftRow.days.length > 0 && !shiftRow.days.includes(dayLetter)) return true;

            const pax = Math.max(1, Number(posCfg.qty) || 1);
            const { codeCounts, assigned } = collectCodeCounts(dateStr, posName, changes);
            const units = countPositionClosedUnitsFromShifts(
                posCfg,
                dayLetter,
                codeCounts,
                cyclesForBulk,
                true,
                dateStr,
            );
            if (units.required > 0 && units.closed >= units.required) return true;

            const upper = String(code || '').toUpperCase();
            const shiftCfgBlock = (posCfg.shifts as any[])?.find((s: any) => String(s.code || '').toUpperCase() === upper);
            const shiftPaxBlock = (shiftCfgBlock?.quantity != null && Number(shiftCfgBlock.quantity) > 0)
                ? Math.max(1, Math.floor(Number(shiftCfgBlock.quantity)))
                : pax;
            const paxLeft = (codeCounts[upper] || 0) >= shiftPaxBlock;
            if (paxLeft) return true;

            if (!is24hCoverageType(posCfg)) return false;

            const bandH = resolveBandHours(upper, { hours }, posCfg.shifts);
            if (is24hsSinglePaxBandMixBlocked(pax, upper, assigned, bandH)) return true;
            if (pax > 1) {
                const posShifts = posCfg.shifts || [];
                const shifts8h = posShifts.filter((s: any) => isShortBandHours(resolveBandHours(s.code, s, posShifts)));
                const shifts12h = posShifts.filter((s: any) => !isShortBandHours(resolveBandHours(s.code, s, posShifts)));
                const maxSlots = shifts8h.length * pax + shifts12h.length * pax;
                if (assigned.length >= maxSlots && maxSlots > 0) return true;
            }
            return false;
        };

        return { resolveAssignPos, shiftDefFor, isCoverageBlocked, empStructure };
    };

    for (let r = minR; r <= maxR; r++) {
        const emp = displayedEmployees[r];
        if (!emp) continue;
        if (opts?.onlyEmpId && emp.id !== opts.onlyEmpId) continue;
        for (let c = minC; c <= maxC; c++) {
            const day = daysInMonth[c];
            const key = `${emp.id}_${getDateKey(day)}`;
            const existing = shiftsMap[key];
            if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig && shiftConfig.code !== 'F') {
                francosReplaced++;
            }
        }
    }
    let markAsFT = false;
    if (francosReplaced > 0) {
        if (confirm(`⚠️ Estás sobrescribiendo ${francosReplaced} Francos.\n¿Deseas marcarlos como FT?`)) {
            markAsFT = true;
        }
    }

    const blockedEmps = new Set<string>();
    const helpersCache = new Map<string, ReturnType<typeof buildBulkHelpers>>();

    for (let r = minR; r <= maxR; r++) {
        const emp = displayedEmployees[r];
        if (!emp) continue;
        if (opts?.onlyEmpId && emp.id !== opts.onlyEmpId) continue;
        const covObjId = getEmpBulkObjective(emp);
        let rowHelpers: ReturnType<typeof buildBulkHelpers> | null = null;
        if (shiftConfig !== null) {
            if (!covObjId) { skippedExt++; continue; }
            rowHelpers = helpersCache.get(covObjId) || buildBulkHelpers(getStructureForObj(covObjId), covObjId);
            helpersCache.set(covObjId, rowHelpers);
        }

        for (let c = minC; c <= maxC; c++) {
            const day = daysInMonth[c];
            const dateStr = getDateKey(day);
            const key = `${emp.id}_${dateStr}`;
            const existing = shiftsMap[key];
            const pendingCell = newChanges[key] ?? pendingChanges[key];
            const effectiveExisting = pendingCell && !pendingCell.isDeleted ? pendingCell : existing;
            if (isShiftConsolidated(effectiveExisting)) continue;
            if (shiftConfig === null) {
                newChanges[key] = { isDeleted: true };
                count++;
                continue;
            }

            const { resolveAssignPos, shiftDefFor, isCoverageBlocked, empStructure } = rowHelpers!;
            const codeUpper = String(shiftConfig.code || '').toUpperCase();
            if (
                codeUpper === 'RET'
                && effectiveExisting
                && effectiveExisting.objectiveId != null
                && effectiveExisting.objectiveId !== ''
                && covObjId
                && String(effectiveExisting.objectiveId) !== String(covObjId)
                && shiftPlanningCodeUpper(effectiveExisting) !== 'RET'
            ) {
                continue;
            }
            const assignPos = resolveAssignPos(emp, codeUpper, shiftConfig.positionName || null);
            const posCfg = empStructure.find((p: any) => p.positionName === assignPos);
            if (isPosExcludedOnDate(posCfg, dateStr) && isPlanningWorkShiftCode(shiftConfig.code)) {
                skippedExcluded++;
                continue;
            }
            if (isPlanningShiftExcludedOnDate(posCfg, dateStr, shiftConfig.code)) {
                skippedExcluded++;
                continue;
            }
            const def = shiftDefFor(assignPos, codeUpper);
            const hours = resolveBandHours(codeUpper, def || shiftConfig, (posCfg?.shifts || []) as any[]);
            if (isCoverageBlocked(dateStr, assignPos, codeUpper, hours, newChanges)) {
                skippedCoverage++;
                continue;
            }
            const { blocked, warnings } = checkRestricciones(emp, dateStr, assignPos, shiftConfig.code, covObjId || undefined, empStructure);
            if (blocked) {
                blockedEmps.add(emp.name);
                continue;
            }
            if (warnings.length > 0) planToastWarnMany(warnings, 8000);
            if (isBulkCovBlocked(emp.id, assignPos, codeUpper)) { skippedCoverage++; continue; }
            let cellIsFT = false;
            if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') {
                cellIsFT = markAsFT;
            }
            newChanges[key] = {
                code: (codeUpper === 'REF' || codeUpper === 'ESC')
                    ? codeUpper
                    : (def?.code || shiftConfig.code),
                name: (codeUpper === 'REF' || codeUpper === 'ESC')
                    ? (shiftConfig.name || (codeUpper === 'ESC' ? 'Escuela' : 'Refuerzo'))
                    : (def?.name || shiftConfig.name),
                hours: (codeUpper === 'REF' || codeUpper === 'ESC')
                    ? (Number(shiftConfig.hours) > 0 ? Number(shiftConfig.hours) : hours)
                    : hours,
                startTime: (codeUpper === 'REF' || codeUpper === 'ESC')
                    ? (shiftConfig.startTime || def?.startTime || '07:00')
                    : (def?.startTime || shiftConfig.startTime),
                endTime: (codeUpper === 'REF' || codeUpper === 'ESC')
                    ? (shiftConfig.endTime || def?.endTime)
                    : (def?.endTime || shiftConfig.endTime),
                isTemp: true,
                oldObjectiveId: effectiveExisting?.objectiveId,
                isFrancoTrabajado: cellIsFT,
                positionName: assignPos,
                objectiveId: covObjId || undefined,
                ...(codeUpper === 'REF' || codeUpper === 'ESC'
                    ? {
                        deploymentBand: shiftConfig.deploymentBand || codeUpper,
                        deploymentRole: shiftConfig.deploymentRole || (codeUpper === 'ESC' ? 'TRAINING' : 'SURPLUS'),
                        surplusIntent: shiftConfig.surplusIntent || (codeUpper === 'ESC' ? 'FORMACION' : 'HORAS'),
                        countsForCoverage: false,
                        isRefuerzo: true,
                        isEscuela: codeUpper === 'ESC',
                        isReten: false,
                    }
                    : {}),
            };
            count++;
        }
    }
    if (blockedEmps.size > 0) toast.error(`🚫 Bloqueados (objetivo excluido): ${[...blockedEmps].join(', ')}`, { duration: 10000 });
    const bulkWarns: string[] = [];
    if (skippedExt > 0) bulkWarns.push(`${skippedExt} omitida(s): elegí objetivo EXT`);
    if (skippedExcluded > 0) bulkWarns.push(`${skippedExcluded} omitida(s): puesto excluido SLA`);
    if (skippedCoverage > 0) bulkWarns.push(`${skippedCoverage} omitida(s): cobertura completa`);
    planToastWarnMany(bulkWarns);
    commitPendingChanges(newChanges);
    if (count > 0) {
        const codeLabel = shiftConfig ? String(shiftConfig.code || '').toUpperCase() : 'BORRAR';
        const samplePos = shiftConfig
            ? (shiftConfig.positionName || '')
            : '';
        planToastBulk(shiftConfig
            ? `${count} celda(s) · ${codeLabel}${samplePos ? ` → ${samplePos}` : ''}`
            : `${count} celda(s) marcadas para borrar`);
    } else if (skippedCoverage > 0 || skippedExcluded > 0 || skippedExt > 0) {
        planToastBulk('Ninguna celda aplicada');
    }
}
