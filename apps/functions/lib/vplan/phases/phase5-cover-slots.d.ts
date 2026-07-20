import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanExistingAssignment } from '../vplan.firestore';
import type { VplanPositionDef } from '../vplan.positions';
import type { VplanCoverageManifest, VplanDemandModel, VplanScheduleDraft, VplanSlotCoverageResult } from '../vplan.types';
export declare function runVplanSlotCoverage(opts: {
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    manifest: VplanCoverageManifest;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    cycle: string;
    dateStrList: string[];
    previousMonthAssignments?: VplanExistingAssignment[];
    slaVendidas: number;
    offerHours: number;
    employeeIds: string[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
    openingSlotByEmp?: Record<string, number>;
    defaultShiftByEmp?: Record<string, string>;
    useTrailing?: boolean;
    trailingEmployeeIds?: string[];
    excludeCustomCrossPool?: boolean;
    allowFrancoTrabajado?: boolean;
}): VplanSlotCoverageResult;
