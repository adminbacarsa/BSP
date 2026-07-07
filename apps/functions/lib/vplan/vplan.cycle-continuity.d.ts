import type { VplanExistingAssignment, VplanPlanningState } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
import type { CoverageGuardContext } from './vplan.coverage-guard';
export { CYCLE_24_MTN, CYCLE_12_DN } from './vplan.cycle-templates';
export declare function shiftEndMs(dateStr: string, band: 'M' | 'T' | 'N'): number;
export declare function shiftStartMs(dateStr: string, band: 'M' | 'T' | 'N'): number;
export declare function restHoursBetweenShiftAssignments(prevDate: string, prev: 'M' | 'T' | 'N', nextDate: string, next: 'M' | 'T' | 'N'): number;
export declare function restHoursBetweenBands(prev: 'M' | 'T' | 'N', next: 'M' | 'T' | 'N'): number;
export declare function workBand(code: string): 'M' | 'T' | 'N' | null;
export declare function isFrancoCode(code: string): boolean;
export declare function isIllegalBandTransition(prev: 'M' | 'T' | 'N', next: 'M' | 'T' | 'N', minRestHours?: number, dates?: {
    prevDate: string;
    nextDate: string;
}): boolean;
export declare function transitionIsLegal(prev: 'M' | 'T' | 'N', next: 'M' | 'T' | 'N', francosBetween: number, minRestHours?: number, dates?: {
    prevDate: string;
    nextDate: string;
}): boolean;
export declare function realignVplanDraftToCycle(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    openingSlotByEmp: Record<string, number>;
    prevPlanningState: VplanPlanningState;
    defaultShiftByEmp?: Record<string, string>;
    useTrailing?: boolean;
    cycle?: string;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function guardIllegalBandTransitions(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    openingSlotByEmp?: Record<string, number>;
    cycle?: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    monthFirstDate?: string;
    minRestHoursBetweenBands?: number;
    coverageGuard?: CoverageGuardContext & {
        protect: boolean;
    };
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function protectedCellKey(empId: string, dateStr: string): string;
export type OpeningContinuityOpts = {
    previousMonthAssignments: VplanExistingAssignment[];
    prevMonthLastDate: string;
    monthFirstDate: string;
    prevPlanningState: VplanPlanningState;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    cycle?: string;
    useTrailing: boolean;
    draftAssignments?: VplanAssignment[];
};
export declare function computeOpeningProtectedCells(opts: OpeningContinuityOpts): Set<string>;
export declare function computeOpeningRestProtectedCells(opts: OpeningContinuityOpts): Set<string>;
export declare function patchMonthOpeningContinuity(opts: {
    draft: VplanScheduleDraft;
    previousMonthAssignments: VplanExistingAssignment[];
    prevMonthLastDate: string;
    monthFirstDate: string;
    prevPlanningState: VplanPlanningState;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    cycle?: string;
    useTrailing: boolean;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function detectCrossMonthContinuityViolations(opts: {
    draft: VplanScheduleDraft;
    previousMonthAssignments: VplanExistingAssignment[];
    prevMonthLastDate: string;
    monthFirstDate: string;
    prevPlanningState: VplanPlanningState;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    cycle?: string;
}): Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    fromCode: string;
    toCode: string;
    expectedCode: string;
}>;
export declare function detectIllegalBandTransitions(draft: VplanScheduleDraft, dateStrs: string[], minRestHours?: number): Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    fromCode: string;
    toCode: string;
}>;
export declare function enforceIllegalBandRest(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    minRestHours?: number;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
