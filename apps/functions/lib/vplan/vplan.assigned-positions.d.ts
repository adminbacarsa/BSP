import { type VplanPositionDef } from './vplan.positions';
import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function inferDefaultPositionFromTurnos(assignments: VplanExistingAssignment[]): Record<string, string>;
export declare function mergeDefaultPositionMaps(...layers: Array<Record<string, string> | undefined>): Record<string, string>;
export declare function mergeDefaultShiftMaps(...layers: Array<Record<string, string> | undefined>): Record<string, string>;
export declare function enforceAssigned24hsPositions(opts: {
    draft: VplanScheduleDraft;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function detectAssignedPositionViolations(draft: VplanScheduleDraft, defaultPositionByEmp: Record<string, string>, positions: VplanPositionDef[]): Array<{
    employeeId: string;
    dateStr: string;
    expectedPosition: string;
    actualPosition: string;
    code: string;
}>;
