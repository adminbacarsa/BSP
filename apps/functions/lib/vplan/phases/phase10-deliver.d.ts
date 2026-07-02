import type { VplanDeliverable, VplanScheduleDraft, VplanVerificationReport } from '../vplan.types';
import type { VplanExistingAssignment } from '../vplan.firestore';
export declare function buildVplanDeliverable(opts: {
    draft: VplanScheduleDraft;
    verification: VplanVerificationReport;
    existingAssignments: VplanExistingAssignment[];
    objectiveId: string;
    year: number;
    month: number;
    employeeNames?: Record<string, string>;
}): VplanDeliverable;
