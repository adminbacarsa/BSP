import { type VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry } from './vplan.types';
export declare function resolveAssignmentBillableHours(a: VplanAssignment, opts?: {
    cycle?: string;
    positions?: VplanPositionDef[];
}): number;
export declare function countDraftBillableHours(assignments: VplanAssignment[], opts?: {
    cycle?: string;
    positions?: VplanPositionDef[];
}): number;
export declare function normalizeAssignmentBillableHours(assignments: VplanAssignment[], opts: {
    cycle?: string;
    positions?: VplanPositionDef[];
}): {
    assignments: VplanAssignment[];
    log: VplanFixerLogEntry[];
};
