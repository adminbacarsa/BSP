import { toast } from 'sonner';
import { computeServiceRuleChanges } from '@/lib/planificacion/planificacionServiceRuleChanges';
import { applyRotationsForMonth } from '@/lib/planificacion/slaRotationMonthPlanner';
import { checkRestBetweenShifts } from '@/lib/planificacion/restBetweenShifts';
import { planToastChangeApplied, planToastWarnMany } from '@/lib/planificacion/planToast';

export type ApplyPlanificacionToPendingParams = {
    config: any;
    selectedCell: {
        empId: string;
        dateStr: string;
    };
    displayedEmployees: any[];
    activePosition: string | null;
    pendingChanges: Record<string, any>;
    selectedGrupo: { objectiveIds: string[] } | null;
    grupoUnifiedMode: boolean;
    cellPlanningObjectiveId: string | null;
    resolveObjectiveForEmp: (empId: string) => string;
    activeSlaServiceRules: any[] | null | undefined;
    activeSlaServiceRotations: any[] | null | undefined;
    shiftsMap: Record<string, any>;
    dotacionBaseEmployees: any[];
    selectedObjective: string;
    currentDate: Date;
    positionStructure: any[];
    checkRestricciones: (
        emp: any,
        dateStr: string,
        positionName?: string | null,
        shiftCode?: string | null,
        objectiveIdOverride?: string | null,
        structureOverride?: any[],
    ) => { blocked: boolean; warnings: string[] };
    commitPendingChanges: (changes: Record<string, any>) => void;
    setSelectedCell: (value: null) => void;
    setActivePosition: (value: null) => void;
    setFrancoMode: (mode: string) => void;
    setPendingAssignment: (value: null) => void;
    setSwapConfig: (value: null) => void;
    setShowSwapModal: (value: boolean) => void;
};

export function applyPlanificacionToPending({
    config,
    selectedCell,
    displayedEmployees,
    activePosition,
    pendingChanges,
    selectedGrupo,
    grupoUnifiedMode,
    cellPlanningObjectiveId,
    resolveObjectiveForEmp,
    activeSlaServiceRules,
    activeSlaServiceRotations,
    shiftsMap,
    dotacionBaseEmployees,
    selectedObjective,
    currentDate,
    positionStructure,
    checkRestricciones,
    commitPendingChanges,
    setSelectedCell,
    setActivePosition,
    setFrancoMode,
    setPendingAssignment,
    setSwapConfig,
    setShowSwapModal,
}: ApplyPlanificacionToPendingParams): void {
    const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
    const emp = displayedEmployees.find((e: any) => e.id === selectedCell.empId);
    if (emp && config && !config.isDeleted) {
        const assignPos = config.positionName || activePosition || 'General';
        const { blocked, warnings } = checkRestricciones(emp, selectedCell.dateStr, assignPos, config.code);
        if (warnings.length > 0) planToastWarnMany(warnings, 8000);
        if (blocked) return;
    }
    const newChanges = { ...pendingChanges };
    newChanges[key] = {
        ...config,
        isTemp: true,
        _isAutoRotation: undefined,
        _isAutoCondition: undefined,
        isFranco: config.code === 'F' || config.code === 'FF' || config.isFranco,
        swapWith: config.swapWith || null,
        swapDate: config.swapDate || null,
        positionName: config.positionName || activePosition || 'General',
        objectiveId: config.objectiveId || (selectedGrupo && grupoUnifiedMode && cellPlanningObjectiveId) || resolveObjectiveForEmp(selectedCell.empId),
    };
    if (activeSlaServiceRules?.length) {
        const _ruleAdditions = computeServiceRuleChanges(
            selectedCell.dateStr, activeSlaServiceRules, newChanges,
            shiftsMap, dotacionBaseEmployees, selectedObjective,
            selectedCell.empId,
        );
        Object.assign(newChanges, _ruleAdditions);
    }
    if (activeSlaServiceRotations?.length) {
        const _rotAdditions = applyRotationsForMonth(
            activeSlaServiceRotations, newChanges, shiftsMap,
            currentDate.getFullYear(), currentDate.getMonth(),
            positionStructure,
        );
        Object.assign(newChanges, _rotAdditions);
        if (activeSlaServiceRules?.length) {
            const _rotFByEmp: Record<string, Set<string>> = {};
            for (const _rv of Object.values(_rotAdditions)) {
                if (_rv && !(_rv as any).isDeleted && ['F','FF','FP','FT'].includes((_rv as any).code)) {
                    const _re = (_rv as any).empId as string;
                    const _rd = (_rv as any).dateStr as string;
                    if (!_rotFByEmp[_re]) _rotFByEmp[_re] = new Set<string>();
                    _rotFByEmp[_re].add(_rd);
                }
            }
            for (const _rot3 of activeSlaServiceRotations) {
                if ((_rot3 as any).cycleMode !== 'cycle_rotation') continue;
                const _p3 = (_rot3 as any).periods?.[0];
                if (!_p3) continue;
                for (const _e3 of ((_p3.entries || []) as any[])) {
                    if (!_e3.employeeId) continue;
                    if (_rotFByEmp[_e3.employeeId]?.size) continue;
                    const _pfx = _e3.employeeId + '_';
                    for (const _smk of Object.keys(shiftsMap)) {
                        if (!_smk.startsWith(_pfx)) continue;
                        const _smv = shiftsMap[_smk];
                        if (!_smv || _smv.isDeleted) continue;
                        if (!['F','FF','FP','FT'].includes(String((_smv as any).code || (_smv as any).type || '').toUpperCase())) continue;
                        if (!_rotFByEmp[_e3.employeeId]) _rotFByEmp[_e3.employeeId] = new Set<string>();
                        _rotFByEmp[_e3.employeeId].add(_smk.slice(_pfx.length));
                    }
                }
            }
            for (const [_re2, _rdates] of Object.entries(_rotFByEmp)) {
                for (const _rfd of _rdates) {
                    if (_rfd === selectedCell?.dateStr && _re2 === selectedCell?.empId) continue;
                    const _rfc = computeServiceRuleChanges(_rfd, activeSlaServiceRules, newChanges, shiftsMap, dotacionBaseEmployees, selectedObjective, _re2);
                    Object.assign(newChanges, _rfc);
                }
            }
        }
    }
    commitPendingChanges(newChanges);
    const _rc = String(config.code || '').toUpperCase();
    const _nonWork = new Set(['F','FF','FP','FT','V','L','A','E','PG','AA','RET']);
    if (!config.isDeleted && !_nonWork.has(_rc)) {
        const _gs = (eid: string, ds: string) => { const k2 = `${eid}_${ds}`; const p2 = newChanges[k2]; if (p2) return p2.isDeleted ? null : p2; return shiftsMap[k2] || null; };
        const _v = checkRestBetweenShifts({ empId: selectedCell.empId, targetDateStr: selectedCell.dateStr, proposed: { code: _rc, startTime: config.startTime || undefined, hours: Number(config.hours) || undefined }, getShift: _gs, cfg: { minRestBetweenShiftsHours: 12, longRestAfterWorkedHours: 48, minLongRestHours: 35 } });
        if (_v) toast.warning(`⚠️ ${_v}`, { duration: 8000 });
    }
    setSelectedCell(null);
    setActivePosition(null);
    setFrancoMode('NONE');
    setPendingAssignment(null);
    setSwapConfig(null);
    setShowSwapModal(false);
    planToastChangeApplied();
}
