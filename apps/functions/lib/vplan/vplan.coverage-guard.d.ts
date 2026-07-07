import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanDemandModel, VplanScheduleDraft } from './vplan.types';
export interface CoverageGuardContext {
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrList: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
}
export declare function countMissingCoverageSlots(assignments: VplanAssignment[], draftMeta: Pick<VplanScheduleDraft, 'sourceEngine'>, guard: CoverageGuardContext): number;
export declare function buildCoverageGuard(opts: {
    protect: boolean;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrList: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
}): CoverageGuardContext & {
    protect: boolean;
};
export declare function wouldReduceCoverageByForcingFranco(opts: {
    assignments: VplanAssignment[];
    draftMeta: Pick<VplanScheduleDraft, 'sourceEngine'>;
    guard: CoverageGuardContext;
    empId: string;
    dateStr: string;
    proposedCode?: string;
}): boolean;
