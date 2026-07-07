import type { VplanScheduleDraft } from './vplan.types';
export declare function detectFixedBandViolations(draft: VplanScheduleDraft, dateStrs: string[], defaultShiftByEmp: Record<string, string>, defaultPositionByEmp: Record<string, string>): Array<{
    employeeId: string;
    dateStr: string;
    expectedBand: string;
    actualCode: string;
    positionName: string;
}>;
